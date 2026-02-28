/**
 * Worker de sincronização de anúncios ML.
 * Roda em background (setImmediate). Usa createServiceClient() para acessar banco.
 *
 * Contempla os dois modelos do Mercado Livre:
 * - Clássico: item com array variations (has_variations = true); preço/atacado por item ou por variação.
 * - User Product (MLBU): cada item_id é uma "variação" do produto; user_product_id, family_id, family_name
 *   preenchidos; sem array variations (has_variations = false). Atualização de preço/atacado por item_id.
 */
import type { MLItemDetail, MLVariationDetail } from "./client";
import { fetchAllItemIds, fetchItemDetail, fetchVariationDetail, getItemPrices, runWithConcurrency } from "./client";
import { getValidAccessToken } from "./refresh";
import { createServiceClient } from "@/lib/supabase/service";
import {
  updateJob,
  addJobLog,
  type JobStatus,
} from "@/lib/jobs";

const CONCURRENCY = 5;

function mapItemToRow(accountId: string, item: MLItemDetail) {
  // User Product (MLBU): item não tem array variations; cada item_id é uma "variação". Clássico: has_variations = variations?.length > 0.
  const hasVariations = Array.isArray(item.variations) && item.variations.length > 0;
  return {
    account_id: accountId,
    item_id: item.id,
    title: item.title ?? null,
    status: item.status ?? null,
    permalink: item.permalink ?? null,
    thumbnail: item.thumbnail ?? null,
    category_id: item.category_id ?? null,
    listing_type_id: item.listing_type_id ?? null,
    site_id: item.site_id ?? null,
    price: item.price ?? null,
    currency_id: item.currency_id ?? null,
    available_quantity: item.available_quantity ?? null,
    sold_quantity: item.sold_quantity ?? null,
    condition: item.condition ?? null,
    shipping_json: item.shipping != null ? (item.shipping as object) : null,
    seller_custom_field: item.seller_custom_field ?? null,
    has_variations: hasVariations,
    user_product_id: item.user_product_id ?? null,
    family_id: item.family_id ?? null,
    family_name: item.family_name ?? null,
    raw_json: item as unknown as object,
    updated_at: new Date().toISOString(),
  };
}

/** Extrai tiers de preço por quantidade (atacado) da resposta GET /items/{id}/prices (show-all-prices). */
function buildWholesaleTiers(
  pricesResponse: { prices?: Array<{ amount?: number; conditions?: { min_purchase_unit?: number } }> } | null
): Array<{ min_purchase_unit: number; amount: number }> {
  if (!pricesResponse?.prices?.length) return [];
  const tiers = pricesResponse.prices
    .filter((p) => p.conditions?.min_purchase_unit != null && p.amount != null)
    .map((p) => ({
      min_purchase_unit: Number(p.conditions!.min_purchase_unit),
      amount: Number(p.amount),
    }))
    .sort((a, b) => a.min_purchase_unit - b.min_purchase_unit);
  return tiers;
}

function mapVariationToRow(
  accountId: string,
  itemId: string,
  v: MLVariationDetail
) {
  // Extrair SKU do array attributes (onde fica SELLER_SKU nas variações)
  let skuFromAttributes: string | null = null;
  if (Array.isArray(v.attributes)) {
    const skuAttr = v.attributes.find((a) => a.id === "SELLER_SKU");
    if (skuAttr?.value_name) {
      skuFromAttributes = skuAttr.value_name;
    }
  }
  
  return {
    account_id: accountId,
    item_id: itemId,
    variation_id: v.id,
    seller_custom_field: v.seller_custom_field ?? skuFromAttributes ?? null,
    attributes_json: Array.isArray(v.attribute_combinations) ? v.attribute_combinations : null,
    price: v.price ?? null,
    available_quantity: v.available_quantity ?? null,
    raw_json: v as unknown as object,
    updated_at: new Date().toISOString(),
  };
}

export async function runSyncJob(jobId: string, accountId: string): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  try {
    const { data: accountData } = await supabase
      .from("ml_accounts")
      .select("ml_user_id")
      .eq("id", accountId)
      .single();
    const account = accountData as { ml_user_id: number } | null;
    if (!account) {
      await updateJob(supabase, jobId, { status: "failed", ended_at: now });
      await addJobLog(supabase, jobId, { status: "error", message: "Conta não encontrada" });
      return;
    }

    const { data: tokenData } = await supabase
      .from("ml_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("account_id", accountId)
      .single();
    const tokenRow = tokenData as { access_token: string; refresh_token: string; expires_at: string } | null;
    if (!tokenRow) {
      await updateJob(supabase, jobId, { status: "failed", ended_at: now });
      await addJobLog(supabase, jobId, { status: "error", message: "Token não encontrado" });
      return;
    }

    const accessToken = await getValidAccessToken(
      accountId,
      tokenRow.access_token,
      tokenRow.refresh_token,
      tokenRow.expires_at,
      supabase
    );
    if (!accessToken) {
      await updateJob(supabase, jobId, { status: "failed", ended_at: now });
      await addJobLog(supabase, jobId, { status: "error", message: "Falha ao obter access token" });
      return;
    }

    const mlUserId = String(account.ml_user_id);
    let itemIds: string[];
    try {
      itemIds = await fetchAllItemIds(mlUserId, accessToken, (offset, total) => {
        console.log(`[sync ${jobId}] items/search progress: ${offset}/${total}`);
      });
    } catch (e) {
      console.error("[sync]", e);
      await updateJob(supabase, jobId, { status: "failed", ended_at: now });
      await addJobLog(supabase, jobId, {
        status: "error",
        message: e instanceof Error ? e.message : "Erro ao listar anúncios",
        response_json: e instanceof Error ? { stack: e.stack } : undefined,
      });
      return;
    }

    const total = itemIds.length;
    await updateJob(supabase, jobId, {
      total,
      status: "running",
      started_at: now,
    });

    let processed = 0;
    let ok = 0;
    let errors = 0;

    await runWithConcurrency(itemIds, CONCURRENCY, async (itemId) => {
      try {
        const item = await fetchItemDetail(itemId, accessToken);
        const row = mapItemToRow(accountId, item);
        const { error: itemErr } = await (supabase as any).from("ml_items").upsert(row, {
          onConflict: "account_id,item_id",
        });
        if (itemErr) {
          throw itemErr;
        }

        const pricesResponse = await getItemPrices(itemId, accessToken, { showAllPrices: true });
        const wholesaleTiers = buildWholesaleTiers(pricesResponse);
        await (supabase as any)
          .from("ml_items")
          .update({ wholesale_prices_json: wholesaleTiers })
          .eq("account_id", accountId)
          .eq("item_id", itemId);

        if (Array.isArray(item.variations) && item.variations.length > 0) {
          for (const v of item.variations) {
            // Buscar detalhes completos da variação (inclui attributes com SELLER_SKU)
            let variationDetail: MLVariationDetail;
            try {
              variationDetail = await fetchVariationDetail(item.id, v.id, accessToken);
            } catch {
              // Se falhar, usar os dados básicos da variação do item
              variationDetail = v as MLVariationDetail;
            }
            const vRow = mapVariationToRow(accountId, item.id, variationDetail);
            await (supabase as any).from("ml_variations").upsert(vRow, {
              onConflict: "account_id,item_id,variation_id",
            });
          }
        }

        processed++;
        ok++;
        await updateJob(supabase, jobId, { processed, ok, errors });
        await addJobLog(supabase, jobId, { item_id: itemId, status: "ok" });
        return;
      } catch (e) {
        processed++;
        errors++;
        const message = e instanceof Error ? e.message : String(e);
        await updateJob(supabase, jobId, { processed, ok, errors });
        await addJobLog(supabase, jobId, {
          item_id: itemId,
          status: "error",
          message,
          response_json: e instanceof Error ? { name: e.name } : undefined,
        });
        console.error(`[sync ${jobId}] item ${itemId}:`, e);
      }
    });

    const finalStatus: JobStatus = errors === 0 ? "success" : total === errors ? "failed" : "partial";
    await updateJob(supabase, jobId, {
      status: finalStatus,
      ended_at: new Date().toISOString(),
    });
    console.log(`[sync ${jobId}] finished: ${finalStatus}, ok=${ok}, errors=${errors}`);
  } catch (e) {
    console.error("[sync]", e);
    await updateJob(supabase, jobId, {
      status: "failed",
      ended_at: new Date().toISOString(),
    });
    await addJobLog(supabase, jobId, {
      status: "error",
      message: e instanceof Error ? e.message : "Erro inesperado",
    });
  }
}

/** Sincroniza um único item por MLB (ex.: MLB123456789). Retorna erro ou sucesso. */
export async function syncSingleItem(
  accountId: string,
  itemId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createServiceClient();
  const itemIdClean = String(itemId).trim().toUpperCase();
  if (!itemIdClean.startsWith("MLB")) {
    return { ok: false, error: "ID deve começar com MLB (ex.: MLB123456789)" };
  }

  const { data: tokenData } = await supabase
    .from("ml_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("account_id", accountId)
    .single();
  const tokenRow = tokenData as { access_token: string; refresh_token: string; expires_at: string } | null;
  if (!tokenRow) {
    return { ok: false, error: "Token não encontrado" };
  }

  const accessToken = await getValidAccessToken(
    accountId,
    tokenRow.access_token,
    tokenRow.refresh_token,
    tokenRow.expires_at,
    supabase
  );
  if (!accessToken) {
    return { ok: false, error: "Falha ao obter access token" };
  }

  try {
    const item = await fetchItemDetail(itemIdClean, accessToken);
    const row = mapItemToRow(accountId, item);
    const { error: itemErr } = await (supabase as any).from("ml_items").upsert(row, {
      onConflict: "account_id,item_id",
    });
    if (itemErr) throw itemErr;

    const pricesResponse = await getItemPrices(itemIdClean, accessToken, { showAllPrices: true });
    const wholesaleTiers = buildWholesaleTiers(pricesResponse);
    await (supabase as any)
      .from("ml_items")
      .update({ wholesale_prices_json: wholesaleTiers })
      .eq("account_id", accountId)
      .eq("item_id", itemIdClean);

    if (Array.isArray(item.variations) && item.variations.length > 0) {
      for (const v of item.variations) {
        // Buscar detalhes completos da variação (inclui attributes com SELLER_SKU)
        let variationDetail: MLVariationDetail;
        try {
          variationDetail = await fetchVariationDetail(item.id, v.id, accessToken);
        } catch {
          // Se falhar, usar os dados básicos da variação do item
          variationDetail = v as MLVariationDetail;
        }
        const vRow = mapVariationToRow(accountId, item.id, variationDetail);
        await (supabase as any).from("ml_variations").upsert(vRow, {
          onConflict: "account_id,item_id,variation_id",
        });
      }
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
