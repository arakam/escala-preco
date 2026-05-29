/**
 * Worker de sincronização de anúncios ML.
 * Roda em background após o POST (setImmediate na rota). Usa createServiceClient() para acessar banco.
 *
 * Contempla os dois modelos do Mercado Livre:
 * - Clássico: item com array variations (has_variations = true); preço/atacado por item ou por variação.
 * - User Product (MLBU): cada item_id é uma "variação" do produto; user_product_id, family_id, family_name
 *   preenchidos; sem array variations (has_variations = false). Atualização de preço/atacado por item_id.
 */
import type { MLItemDetail, MLVariationDetail } from "./client";
import {
  fetchAllItemIds,
  fetchItemDetail,
  fetchVariationDetail,
  getItemPrices,
  getItemSalePrice,
  getSalePriceAmount,
  getStandardPriceAmount,
  runWithConcurrency,
} from "./client";
import { extractItemDimensions, extractVariationDimensions } from "./item-dimensions";
import {
  collectFulfillmentInventoryIds,
  fetchFulfillmentStockFields,
  FulfillmentStockCache,
  getFulfillmentStockTtlMs,
  itemHasFulfillmentStockSource,
  normalizeMlInventoryId,
  persistVariationFulfillmentStocks,
  resolveFulfillmentFieldsFast,
  resolveListingAvailableQuantity,
  shouldRefreshFulfillmentStock,
  type StoredFulfillmentRow,
} from "./fulfillment-stock";
import { getLatestValidAccessToken, getValidAccessToken } from "./refresh";
import { syncHeartbeatMs, syncLog, syncLogVerbose } from "./sync-log";
import { createServiceClient } from "@/lib/supabase/service";
import { upsertCategoryFeeReferenceFromSample } from "@/lib/pricing/ml-category-fee-reference";
import { isMlPlaceholderSku } from "@/lib/products/ml-sku";
import {
  getJobStatus,
  isActiveJobStatus,
  updateJob,
  addJobLog,
  type JobStatus,
} from "@/lib/jobs";

/**
 * Quantos anúncios processar em paralelo. O ML costuma retornar 429 com 2–3+.
 * Padrão: 1 (mais lento, menos bloqueio). Defina ML_SYNC_CONCURRENCY=2 no .env se o limite da conta permitir.
 */
function getMlSyncConcurrency(): number {
  const raw = process.env.ML_SYNC_CONCURRENCY;
  if (raw === undefined || raw === "") return 1;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1 && n <= 15) return Math.floor(n);
  return 1;
}

const CONCURRENCY = getMlSyncConcurrency();

function variationHasAnyPackageAttribute(v: { attributes?: Array<{ id?: string }> } | null | undefined) {
  const attrs = v?.attributes;
  if (!Array.isArray(attrs) || attrs.length === 0) return false;
  // IDs que o `extractVariationDimensions` consegue converter para dimensões/peso.
  const ids = new Set([
    "PACKAGE_HEIGHT",
    "HEIGHT",
    "SELLER_PACKAGE_HEIGHT",
    "PACKAGE_WIDTH",
    "WIDTH",
    "SELLER_PACKAGE_WIDTH",
    "PACKAGE_LENGTH",
    "LENGTH",
    "SELLER_PACKAGE_LENGTH",
    "PACKAGE_DEPTH",
    "DEPTH",
    "PACKAGE_WEIGHT",
    "WEIGHT",
    "SELLER_PACKAGE_WEIGHT",
    "PRODUCT_WEIGHT",
  ]);
  return attrs.some((a) => a?.id && ids.has(a.id));
}

function variationLooksLikeWeHaveSku(v: MLVariationDetail): boolean {
  const sellerFieldRaw = v.seller_custom_field?.trim() || null;
  if (sellerFieldRaw && !isMlPlaceholderSku(sellerFieldRaw)) return true;

  const skuAttrValue = Array.isArray(v.attributes)
    ? v.attributes.find((a) => a.id === "SELLER_SKU")?.value_name ?? null
    : null;
  if (skuAttrValue && !isMlPlaceholderSku(String(skuAttrValue))) return true;

  return false;
}

function variationNeedsExtraDetail(v: MLVariationDetail): boolean {
  // Se atributos não vieram no /items/{id} (include_attributes=all), precisamos buscar a variação completa.
  if (!Array.isArray(v.attributes) || v.attributes.length === 0) return true;

  // Se não conseguimos montar SKU (SELLER_SKU ou seller_custom_field), buscarmos a variação completa.
  if (!variationLooksLikeWeHaveSku(v)) return true;

  // Se existem atributos de pacote, mas não conseguimos extrair dimensões/peso,
  // pode ser que falte value_struct na resposta do item. Faz fallback para não perder medidas.
  if (variationHasAnyPackageAttribute(v)) {
    const dims = extractVariationDimensions(v);
    if (
      dims.weight_kg == null ||
      dims.height_cm == null ||
      dims.width_cm == null ||
      dims.length_cm == null
    ) {
      return true;
    }
  }

  return false;
}

function looksLikeMlAuthError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /\b401\b|invalid_token|Invalid access token|not authorized|Unauthorized/i.test(m);
}

function mapItemToRow(accountId: string, item: MLItemDetail) {
  // User Product (MLBU): item não tem array variations; cada item_id é uma "variação". Clássico: has_variations = variations?.length > 0.
  const hasVariations = Array.isArray(item.variations) && item.variations.length > 0;
  const dims = extractItemDimensions(item);
  const now = new Date().toISOString();
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
    sale_price: null as number | null,
    currency_id: item.currency_id ?? null,
    available_quantity: item.available_quantity ?? null,
    sold_quantity: item.sold_quantity ?? null,
    health: item.health != null && !Number.isNaN(Number(item.health)) ? Number(item.health) : null,
    tags_json: Array.isArray(item.tags)
      ? item.tags.filter((t): t is string => typeof t === "string")
      : null,
    condition: item.condition ?? null,
    shipping_json: item.shipping != null ? (item.shipping as object) : null,
    seller_custom_field:
      item.seller_custom_field?.trim() && !isMlPlaceholderSku(item.seller_custom_field)
        ? item.seller_custom_field.trim()
        : null,
    has_variations: hasVariations,
    inventory_id: normalizeMlInventoryId(item.inventory_id),
    user_product_id: item.user_product_id ?? null,
    family_id: item.family_id ?? null,
    family_name: item.family_name ?? null,
    weight_kg: dims.weight_kg,
    height_cm: dims.height_cm,
    width_cm: dims.width_cm,
    length_cm: dims.length_cm,
    raw_json: item as unknown as object,
    synced_at: now,
    updated_at: now,
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

async function upsertItemVariations(
  supabase: ReturnType<typeof createServiceClient>,
  accountId: string,
  item: MLItemDetail,
  token: string
): Promise<MLVariationDetail[]> {
  const details: MLVariationDetail[] = [];
  if (!Array.isArray(item.variations) || item.variations.length === 0) return details;

  for (const v of item.variations) {
    let variationDetail: MLVariationDetail;
    try {
      if (variationNeedsExtraDetail(v as MLVariationDetail)) {
        variationDetail = await fetchVariationDetail(item.id, v.id, token);
      } else {
        variationDetail = v as MLVariationDetail;
      }
    } catch {
      variationDetail = v as MLVariationDetail;
    }
    details.push(variationDetail);
    const vRow = mapVariationToRow(accountId, item.id, variationDetail);
    const { error: vErr } = await (supabase as any).from("ml_variations").upsert(vRow, {
      onConflict: "account_id,item_id,variation_id",
    });
    if (vErr) throw vErr;
  }
  return details;
}

function mapVariationToRow(
  accountId: string,
  itemId: string,
  v: MLVariationDetail
) {
  let skuFromAttributes: string | null = null;
  if (Array.isArray(v.attributes)) {
    const skuAttr = v.attributes.find((a) => a.id === "SELLER_SKU");
    if (skuAttr?.value_name && !isMlPlaceholderSku(skuAttr.value_name)) {
      skuFromAttributes = skuAttr.value_name;
    }
  }
  const sellerFieldRaw = v.seller_custom_field?.trim() || null;
  const sellerCustomField =
    sellerFieldRaw && !isMlPlaceholderSku(sellerFieldRaw)
      ? sellerFieldRaw
      : skuFromAttributes;

  return {
    account_id: accountId,
    item_id: itemId,
    variation_id: v.id,
    inventory_id: normalizeMlInventoryId(v.inventory_id),
    seller_custom_field: sellerCustomField,
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
    syncLog(jobId, "job iniciado (sync_items)", { accountId });
    const { data: accountData } = await supabase
      .from("ml_accounts")
      .select("ml_user_id, site_id")
      .eq("id", accountId)
      .single();
    const account = accountData as { ml_user_id: number; site_id: string | null } | null;
    if (!account) {
      syncLog(jobId, "abortar: conta ML não encontrada no banco", { accountId });
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
      syncLog(jobId, "abortar: ml_tokens ausente para a conta", { accountId });
      await updateJob(supabase, jobId, { status: "failed", ended_at: now });
      await addJobLog(supabase, jobId, { status: "error", message: "Token não encontrado" });
      return;
    }

    const initialToken = await getValidAccessToken(
      accountId,
      tokenRow.access_token,
      tokenRow.refresh_token,
      tokenRow.expires_at,
      supabase
    );
    if (!initialToken) {
      syncLog(jobId, "abortar: getValidAccessToken retornou vazio (refresh/env?)");
      await updateJob(supabase, jobId, { status: "failed", ended_at: now });
      await addJobLog(supabase, jobId, { status: "error", message: "Falha ao obter access token" });
      return;
    }
    let accessToken: string = initialToken;
    syncLog(jobId, "token ML obtido; iniciando listagem de IDs", { mlUserId: account.ml_user_id });

    const mlUserId = String(account.ml_user_id);
    let itemIds: string[];
    try {
      itemIds = await fetchAllItemIds(mlUserId, accessToken, (offset, total) => {
        syncLog(jobId, "items/search (scan)", { offset, total });
      });
    } catch (e) {
      syncLog(jobId, "falha ao listar IDs no Mercado Livre", {
        err: e instanceof Error ? e.message : String(e),
      });
      console.error(`[sync:${jobId}] listagem`, e);
      await updateJob(supabase, jobId, { status: "failed", ended_at: now });
      await addJobLog(supabase, jobId, {
        status: "error",
        message: e instanceof Error ? e.message : "Erro ao listar anúncios",
        response_json: e instanceof Error ? { stack: e.stack } : undefined,
      });
      return;
    }

    const total = itemIds.length;
    syncLog(jobId, "listagem concluída; iniciando detalhamento por anúncio", {
      total,
      concurrency: CONCURRENCY,
      /** Fila única de HTTP ao ML no client (padrão ligado; ML_HTTP_SERIAL=0 desliga) */
      mlHttpSerialized:
        process.env.ML_HTTP_SERIAL !== "0" && process.env.ML_HTTP_SERIAL !== "false",
      verbose: syncLogVerbose(),
      heartbeatMs: syncHeartbeatMs(),
    });
    const progressHeartbeat = () => new Date().toISOString();
    await updateJob(supabase, jobId, { total, started_at: progressHeartbeat() });

    let processed = 0;
    let ok = 0;
    let errors = 0;
    let lastJobStatusCheck = 0;
    let jobStillActive = true;

    const assertJobStillActive = async (): Promise<boolean> => {
      if (Date.now() - lastJobStatusCheck < 2000) return jobStillActive;
      lastJobStatusCheck = Date.now();
      const status = await getJobStatus(supabase, jobId);
      jobStillActive = status != null && isActiveJobStatus(status);
      if (!jobStillActive) {
        syncLog(jobId, "abortar: job cancelado ou finalizado no banco", { status });
      }
      return jobStillActive;
    };

    let lastProactiveTokenCheck = Date.now();
    const siteIdFallback = (account.site_id ?? "MLB").trim() || "MLB";
    const categoryFeeKeysSynced = new Set<string>();
    const fulfillmentStockCache = new FulfillmentStockCache();
    type FulfillmentRefreshEntry = {
      itemId: string;
      item: MLItemDetail;
      variationDetails: MLVariationDetail[];
    };
    const fulfillmentRefreshQueue: FulfillmentRefreshEntry[] = [];

    const syncOneItem = async (itemId: string, token: string): Promise<void> => {
      if (syncLogVerbose()) {
        syncLog(jobId, "ML GET item + prices + variações", { itemId });
      }
      // include_attributes=all ajuda a trazer attributes dentro das variações, reduzindo chamadas extras.
      const item = await fetchItemDetail(itemId, token, { includeAttributesAll: true });
      const pricesResponse = await getItemPrices(itemId, token, { showAllPrices: true });
      const standardPrice = getStandardPriceAmount(pricesResponse);
      const salePriceResponse = await getItemSalePrice(itemId, token);
      const salePrice = getSalePriceAmount(salePriceResponse);
      const variationDetails = await upsertItemVariations(supabase, accountId, item, token);
      const baseRow = mapItemToRow(accountId, item);
      const fastFulfillment = resolveFulfillmentFieldsFast(item, variationDetails);
      const inventoryIds = collectFulfillmentInventoryIds(item, variationDetails);

      const { data: existingFulfillmentRow } = await supabase
        .from("ml_items")
        .select("fulfillment_stock, fulfillment_synced_at, inventory_id, user_product_id")
        .eq("account_id", accountId)
        .eq("item_id", itemId)
        .maybeSingle();
      const existingFulfillment = existingFulfillmentRow as StoredFulfillmentRow | null;

      let fulfillmentStock: number | null = null;
      let fulfillmentSyncedAt: string | null = null;

      if (fastFulfillment.is_fulfillment) {
        const needsRefresh = shouldRefreshFulfillmentStock({
          inventoryIds,
          userProductId: item.user_product_id,
          primaryInventoryId: fastFulfillment.inventory_id,
          existing: existingFulfillment,
        });
        if (needsRefresh && itemHasFulfillmentStockSource(item, inventoryIds)) {
          fulfillmentRefreshQueue.push({ itemId, item, variationDetails });
          if (
            existingFulfillment?.fulfillment_stock != null &&
            Number.isFinite(Number(existingFulfillment.fulfillment_stock))
          ) {
            fulfillmentStock = Math.floor(Number(existingFulfillment.fulfillment_stock));
            fulfillmentSyncedAt = existingFulfillment.fulfillment_synced_at ?? null;
          }
        } else if (
          existingFulfillment?.fulfillment_stock != null &&
          Number.isFinite(Number(existingFulfillment.fulfillment_stock))
        ) {
          fulfillmentStock = Math.floor(Number(existingFulfillment.fulfillment_stock));
          fulfillmentSyncedAt = existingFulfillment.fulfillment_synced_at ?? null;
        }
      }

      const row = {
        ...baseRow,
        price: standardPrice ?? baseRow.price,
        sale_price: salePrice,
        is_fulfillment: fastFulfillment.is_fulfillment,
        inventory_id: fastFulfillment.inventory_id ?? baseRow.inventory_id,
        fulfillment_stock: fulfillmentStock,
        fulfillment_synced_at: fulfillmentSyncedAt,
      };
      const { error: itemErr } = await (supabase as any).from("ml_items").upsert(row, {
        onConflict: "account_id,item_id",
      });
      if (itemErr) {
        throw itemErr;
      }

      const siteId = ((item.site_id as string | undefined) ?? siteIdFallback).trim() || siteIdFallback;
      const samplePrice = Number(row.price) || standardPrice || 0;
      const cat = row.category_id as string | null | undefined;
      const lt = row.listing_type_id as string | null | undefined;
      if (cat && lt && samplePrice > 0) {
        const feeKey = `${siteId}\0${cat}\0${lt}`;
        if (!categoryFeeKeysSynced.has(feeKey)) {
          categoryFeeKeysSynced.add(feeKey);
          await upsertCategoryFeeReferenceFromSample({
            supabase,
            siteId,
            categoryId: cat,
            listingTypeId: lt,
            samplePrice,
            accessToken: token,
          });
        }
      }

      const wholesaleTiers = buildWholesaleTiers(pricesResponse);
      await (supabase as any)
        .from("ml_items")
        .update({ wholesale_prices_json: wholesaleTiers })
        .eq("account_id", accountId)
        .eq("item_id", itemId);

    };

    const heartbeatMs = syncHeartbeatMs();
    const heartbeat =
      heartbeatMs > 0
        ? setInterval(() => {
            syncLog(jobId, "heartbeat (ainda processando)", {
              processed,
              ok,
              errors,
              total,
              restantes: total - processed,
            });
          }, heartbeatMs)
        : null;

    try {
      await runWithConcurrency(itemIds, CONCURRENCY, async (itemId) => {
        if (!(await assertJobStillActive())) return;

        const itemT0 = Date.now();
        try {
          if (Date.now() - lastProactiveTokenCheck > 8 * 60 * 1000) {
            lastProactiveTokenCheck = Date.now();
            syncLog(jobId, "checagem periódica do token ML (8 min)");
            const t = await getLatestValidAccessToken(accountId, supabase);
            if (t) {
              if (t !== accessToken) {
                syncLog(jobId, "access_token ML substituído após checagem periódica");
              }
              accessToken = t;
            } else {
              syncLog(jobId, "aviso: getLatestValidAccessToken retornou vazio na checagem periódica");
            }
          }

          try {
            await syncOneItem(itemId, accessToken);
          } catch (e) {
            if (looksLikeMlAuthError(e)) {
              syncLog(jobId, "erro de autenticação ML; tentando renovar token e repetir item", {
                itemId,
                err: e instanceof Error ? e.message : String(e),
              });
              const newT = await getLatestValidAccessToken(accountId, supabase);
              if (newT) {
                accessToken = newT;
                syncLog(jobId, "repetindo item após renovação de token", { itemId });
                await syncOneItem(itemId, accessToken);
              } else {
                throw e;
              }
            } else {
              throw e;
            }
          }

          processed++;
          ok++;
          await updateJob(supabase, jobId, {
            processed,
            ok,
            errors,
            started_at: progressHeartbeat(),
          });
          await addJobLog(supabase, jobId, { item_id: itemId, status: "ok" });
          if (syncLogVerbose()) {
            syncLog(jobId, "item OK", { itemId, ms: Date.now() - itemT0 });
          }
        } catch (e) {
          processed++;
          errors++;
          const message = e instanceof Error ? e.message : String(e);
          await updateJob(supabase, jobId, {
            processed,
            ok,
            errors,
            started_at: progressHeartbeat(),
          });
          await addJobLog(supabase, jobId, {
            item_id: itemId,
            status: "error",
            message,
            response_json: e instanceof Error ? { name: e.name } : undefined,
          });
          syncLog(jobId, "item com falha", {
            itemId,
            ms: Date.now() - itemT0,
            err: message,
          });
          console.error(`[sync:${jobId}] item ${itemId}`, e);
        }
      });
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }

    if (fulfillmentRefreshQueue.length > 0 && (await assertJobStillActive())) {
      syncLog(jobId, "fase B: estoque Full", {
        pendentes: fulfillmentRefreshQueue.length,
        cacheInventoryIds: fulfillmentStockCache.size,
        ttlMs: getFulfillmentStockTtlMs(),
      });
      let fulfillmentOk = 0;
      let fulfillmentErrors = 0;
      const nowIso = () => new Date().toISOString();

      for (const entry of fulfillmentRefreshQueue) {
        if (!(await assertJobStillActive())) break;

        try {
          if (Date.now() - lastProactiveTokenCheck > 8 * 60 * 1000) {
            lastProactiveTokenCheck = Date.now();
            const t = await getLatestValidAccessToken(accountId, supabase);
            if (t) accessToken = t;
          }

          const stockFields = await fetchFulfillmentStockFields(
            entry.item,
            accessToken,
            entry.variationDetails,
            fulfillmentStockCache
          );
          const itemPatch: Record<string, unknown> = {
            is_fulfillment: stockFields.is_fulfillment,
            inventory_id: stockFields.inventory_id,
            fulfillment_stock: stockFields.fulfillment_stock,
            fulfillment_synced_at: nowIso(),
          };
          if (stockFields.total_listing_stock != null) {
            itemPatch.available_quantity = stockFields.total_listing_stock;
          }
          const { error: updErr } = await (supabase as any)
            .from("ml_items")
            .update(itemPatch)
            .eq("account_id", accountId)
            .eq("item_id", entry.itemId);
          if (updErr) throw updErr;
          await persistVariationFulfillmentStocks(
            supabase,
            accountId,
            entry.itemId,
            stockFields.byInventory
          );
          fulfillmentOk++;
        } catch (e) {
          fulfillmentErrors++;
          syncLog(jobId, "fase B: falha estoque Full", {
            itemId: entry.itemId,
            err: e instanceof Error ? e.message : String(e),
          });
        }
      }

      syncLog(jobId, "fase B concluída", {
        ok: fulfillmentOk,
        errors: fulfillmentErrors,
        cacheInventoryIds: fulfillmentStockCache.size,
      });
    }

    const currentStatus = await getJobStatus(supabase, jobId);
    if (!currentStatus || !isActiveJobStatus(currentStatus)) {
      syncLog(jobId, "encerrado sem sobrescrever status (cancelado ou expirado)", {
        currentStatus,
        ok,
        errors,
        processed,
        total,
      });
      return;
    }

    const finalStatus: JobStatus = errors === 0 ? "success" : total === errors ? "failed" : "partial";
    await updateJob(supabase, jobId, {
      status: finalStatus,
      ended_at: new Date().toISOString(),
    });
    syncLog(jobId, "job finalizado", { finalStatus, ok, errors, total });

    if (finalStatus !== "failed") {
      try {
        const { autoCreateProductsFromMlSync } = await import("@/lib/products/auto-create-from-ml-sync");
        const autoProd = await autoCreateProductsFromMlSync(accountId);
        if (autoProd.ok && !autoProd.skipped_disabled) {
          syncLog(jobId, "produtos auto (SKU + medidas)", {
            created: autoProd.products_created,
            updated: autoProd.products_updated,
            linked: autoProd.items_linked + autoProd.variations_linked,
          });
        }
      } catch (err) {
        console.error(`[sync:${jobId}] auto-create products`, err);
      }
      syncLog(jobId, "disparando refreshPricingCache em background");
      const { refreshPricingCache } = await import("@/lib/pricing-cache");
      refreshPricingCache(accountId).catch((err) =>
        console.error(`[sync:${jobId}] pricing cache refresh`, err)
      );

      try {
        const { maybeKickSalesBackfillAfterItemsSync } = await import(
          "@/lib/mercadolivre/schedule-sales-backfill"
        );
        const backfill = await maybeKickSalesBackfillAfterItemsSync(accountId, {
          triggerSyncJobId: jobId,
        });
        if (backfill.started) {
          syncLog(jobId, "carga inicial vendas 30d (envio + SLA) em background", {
            salesBackfillJobId: backfill.jobId,
          });
        } else {
          syncLog(jobId, "carga inicial vendas 30d não disparada", { reason: backfill.reason });
        }
      } catch (err) {
        console.error(`[sync:${jobId}] auto sales backfill`, err);
      }
    }
  } catch (e) {
    syncLog(jobId, "erro fatal no worker", {
      err: e instanceof Error ? e.message : String(e),
    });
    console.error(`[sync:${jobId}] fatal`, e);
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
  const logId = "import-one";
  const itemIdClean = String(itemId).trim().toUpperCase();
  if (!itemIdClean.startsWith("MLB")) {
    return { ok: false, error: "ID deve começar com MLB (ex.: MLB123456789)" };
  }

  const supabase = createServiceClient();
  const t0 = Date.now();
  if (syncLogVerbose()) {
    syncLog(logId, "sincronização unitária iniciada", { accountId, itemId: itemIdClean });
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
    const item = await fetchItemDetail(itemIdClean, accessToken, { includeAttributesAll: true });
    const pricesResponse = await getItemPrices(itemIdClean, accessToken, { showAllPrices: true });
    const standardPrice = getStandardPriceAmount(pricesResponse);
    const salePriceResponse = await getItemSalePrice(itemIdClean, accessToken);
    const salePrice = getSalePriceAmount(salePriceResponse);
    const variationDetails = await upsertItemVariations(supabase, accountId, item, accessToken);
    const baseRow = mapItemToRow(accountId, item);
    const fastFulfillment = resolveFulfillmentFieldsFast(item, variationDetails);
    const inventoryIds = collectFulfillmentInventoryIds(item, variationDetails);
    const fulfillmentCache = new FulfillmentStockCache();

    let fulfillmentStock: number | null = null;
    let fulfillmentSyncedAt: string | null = null;
    let listingAvailableQuantity: number | null =
      baseRow.available_quantity != null ? Math.floor(Number(baseRow.available_quantity)) : null;

    if (
      fastFulfillment.is_fulfillment &&
      shouldRefreshFulfillmentStock({
        inventoryIds,
        userProductId: item.user_product_id,
        primaryInventoryId: fastFulfillment.inventory_id,
        force: true,
      })
    ) {
      const stockFields = await fetchFulfillmentStockFields(
        item,
        accessToken,
        variationDetails,
        fulfillmentCache
      );
      fulfillmentStock = stockFields.fulfillment_stock;
      fulfillmentSyncedAt = new Date().toISOString();
      listingAvailableQuantity = resolveListingAvailableQuantity(
        baseRow.available_quantity,
        stockFields
      );
      await persistVariationFulfillmentStocks(supabase, accountId, itemIdClean, stockFields.byInventory);
    }

    const row = {
      ...baseRow,
      price: standardPrice ?? baseRow.price,
      sale_price: salePrice,
      available_quantity: listingAvailableQuantity,
      is_fulfillment: fastFulfillment.is_fulfillment,
      inventory_id: fastFulfillment.inventory_id ?? baseRow.inventory_id,
      fulfillment_stock: fulfillmentStock,
      fulfillment_synced_at: fulfillmentSyncedAt,
    };
    const { error: itemErr } = await (supabase as any).from("ml_items").upsert(row, {
      onConflict: "account_id,item_id",
    });
    if (itemErr) throw itemErr;

    const { data: accRow } = await supabase.from("ml_accounts").select("site_id").eq("id", accountId).single();
    const siteIdFallback = ((accRow?.site_id as string | null | undefined) ?? "MLB").trim() || "MLB";
    const siteId = ((item.site_id as string | undefined) ?? siteIdFallback).trim() || siteIdFallback;
    const samplePrice = Number(row.price) || 0;
    if (row.category_id && row.listing_type_id && samplePrice > 0) {
      await upsertCategoryFeeReferenceFromSample({
        supabase,
        siteId,
        categoryId: row.category_id as string,
        listingTypeId: row.listing_type_id as string,
        samplePrice,
        accessToken,
      });
    }

    const wholesaleTiers = buildWholesaleTiers(pricesResponse);
    await (supabase as any)
      .from("ml_items")
      .update({ wholesale_prices_json: wholesaleTiers })
      .eq("account_id", accountId)
      .eq("item_id", itemIdClean);

    try {
      const { autoCreateProductsFromMlSync } = await import("@/lib/products/auto-create-from-ml-sync");
      await autoCreateProductsFromMlSync(accountId, [itemIdClean]);
    } catch (err) {
      console.error(`[sync:${logId}] auto-create products`, err);
    }
    try {
      const { refreshPricingCacheByItemId } = await import("@/lib/pricing-cache");
      await refreshPricingCacheByItemId(accountId, itemIdClean);
    } catch (err) {
      console.error(`[sync:${logId}] pricing cache refresh`, err);
    }
    if (syncLogVerbose()) {
      syncLog(logId, "sincronização unitária OK", {
        accountId,
        itemId: itemIdClean,
        ms: Date.now() - t0,
      });
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    syncLog(logId, "sincronização unitária falhou", {
      accountId,
      itemId: itemIdClean,
      ms: Date.now() - t0,
      err: msg,
    });
    return { ok: false, error: msg };
  }
}
