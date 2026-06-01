import { getRouteAuth } from "@/lib/supabase/route-auth";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { computeItemsFees, type PricingFeeInputItem } from "@/lib/pricing/compute-items-fees";
import { loadPricingRulesSnapshot } from "@/lib/pricing/pricing-rules-cache";
import { persistCalculatedPricingBatch } from "@/lib/pricing/persist-calculated-batch";
import { updatePricingCachePlannedPrices } from "@/lib/pricing-cache";
import type { PrecosImportRowValid } from "@/lib/precos-import-csv";
import {
  resolveReferenceFeePercent,
  solveMarginFast,
  type SolveMarginFastInput,
} from "@/lib/pricing/solve-margin-fast";

/** Evita 504 em importações grandes (sem limite artificial de linhas). */
export const maxDuration = 300;

const VARIATION_ID_ITEM = -1;
const CACHE_LOOKUP_ITEM_ID_CHUNK = 100;
const PLANNED_PRICES_UPSERT_BATCH = 500;

type CacheRow = {
  item_id: string;
  variation_id: number;
  sku: string | null;
  listing_type_id: string | null;
  category_id: string | null;
  weight_kg: number | null;
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  cost_price: number | null;
  tax_percent: number | null;
  extra_fee_percent: number | null;
  fixed_expenses: number | null;
  reference_fee_percent: number | null;
  current_price: number | null;
  planned_price: number | null;
};

interface ConfirmBody {
  items?: PrecosImportRowValid[];
  is_mercado_lider?: boolean;
}

function cacheVariationId(variationId: number | null): number {
  return variationId == null || variationId === VARIATION_ID_ITEM ? VARIATION_ID_ITEM : Number(variationId);
}

function cacheLookupKey(itemId: string, variationId: number | null): string {
  return `${itemId.trim().toUpperCase()}:${cacheVariationId(variationId)}`;
}

function toSolveInput(row: CacheRow): SolveMarginFastInput {
  return {
    item_id: row.item_id,
    variation_id: row.variation_id === VARIATION_ID_ITEM ? null : row.variation_id,
    listing_type_id: row.listing_type_id!,
    category_id: row.category_id!,
    weight_kg: row.weight_kg,
    height_cm: row.height_cm,
    width_cm: row.width_cm,
    length_cm: row.length_cm,
    cost_price: Number(row.cost_price),
    tax_percent: row.tax_percent,
    extra_fee_percent: row.extra_fee_percent,
    fixed_expenses: row.fixed_expenses,
    reference_fee_percent: row.reference_fee_percent,
    current_price: row.current_price,
    planned_price: row.planned_price,
  };
}

/**
 * POST /api/pricing/import/confirm
 * Body: { items: PrecosImportRowValid[], is_mercado_lider?: boolean }
 * Aplica promoção ou margem alvo por MLB e grava planned_prices + cache.
 */
export async function POST(req: NextRequest) {
  const auth = await getRouteAuth();
  if (!auth) {
    return NextResponse.json(
      { error: "Sessão expirada. Atualize a página e faça login novamente." },
      { status: 401 }
    );
  }
  const { supabase, user } = auth;

  let body: ConfirmBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "Envie pelo menos um item em items" }, { status: 400 });
  }

  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id, site_id")
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  const siteId = (account.site_id as string | null)?.trim() || "MLB";
  const isMercadoLider = body.is_mercado_lider ?? false;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Configuração do servidor incompleta" }, { status: 500 });
  }

  const adminSupabase = createSupabaseClient(supabaseUrl, supabaseServiceKey);
  const { shippingRanges, feePercentByCatType } = await loadPricingRulesSnapshot(adminSupabase, siteId);

  const itemIds = Array.from(new Set(items.map((i) => i.item_id.trim().toUpperCase())));
  const cacheByKey = new Map<string, CacheRow>();
  for (let i = 0; i < itemIds.length; i += CACHE_LOOKUP_ITEM_ID_CHUNK) {
    const idChunk = itemIds.slice(i, i + CACHE_LOOKUP_ITEM_ID_CHUNK);
    const { data: cacheRows, error: cacheError } = await supabase
      .from("pricing_cache")
      .select(
        "item_id, variation_id, sku, listing_type_id, category_id, weight_kg, height_cm, width_cm, length_cm, cost_price, tax_percent, extra_fee_percent, fixed_expenses, reference_fee_percent, current_price, planned_price"
      )
      .eq("account_id", account.id)
      .in("item_id", idChunk);

    if (cacheError) {
      console.error("[pricing/import/confirm] cache lookup", cacheError);
      return NextResponse.json({ error: "Erro ao buscar anúncios no cache" }, { status: 500 });
    }

    for (const row of (cacheRows ?? []) as CacheRow[]) {
      cacheByKey.set(cacheLookupKey(row.item_id, row.variation_id), row);
    }
  }

  const applyErrors: Array<{ item_id: string; variation_id: number | null; error: string }> = [];
  const toSave: Array<{
    item_id: string;
    variation_id: number | null;
    sku: string | null;
    planned_price: number;
    calculated?: { fee: number; shipping_cost: number };
  }> = [];
  const promocaoForFees: PricingFeeInputItem[] = [];

  for (const item of items) {
    const itemId = item.item_id.trim().toUpperCase();
    const variationId = item.variation_id ?? null;
    const cacheRow = cacheByKey.get(cacheLookupKey(itemId, variationId));

    if (!cacheRow) {
      applyErrors.push({
        item_id: itemId,
        variation_id: variationId,
        error: "Anúncio não encontrado no cache (sincronize ou atualize a tabela).",
      });
      continue;
    }

    if (item.mode === "promocao") {
      const price = Number(item.promocao);
      if (!Number.isFinite(price) || price < 0) {
        applyErrors.push({ item_id: itemId, variation_id: variationId, error: "Promocao inválida" });
        continue;
      }
      if (!cacheRow.listing_type_id || !cacheRow.category_id) {
        applyErrors.push({
          item_id: itemId,
          variation_id: variationId,
          error: "Sem tipo de listagem ou categoria; sincronize o anúncio.",
        });
        continue;
      }

      const planned = Math.round(price * 100) / 100;
      toSave.push({
        item_id: itemId,
        variation_id: variationId,
        sku: cacheRow.sku,
        planned_price: planned,
      });
      promocaoForFees.push({
        item_id: itemId,
        variation_id: variationId,
        price: planned,
        listing_type_id: cacheRow.listing_type_id,
        category_id: cacheRow.category_id,
        weight_kg: cacheRow.weight_kg,
        height_cm: cacheRow.height_cm,
        width_cm: cacheRow.width_cm,
        length_cm: cacheRow.length_cm,
        reference_fee_percent: cacheRow.reference_fee_percent,
      });
      continue;
    }

    const targetPct = Number(item.margem_percent);
    if (!Number.isFinite(targetPct)) {
      applyErrors.push({ item_id: itemId, variation_id: variationId, error: "Margem % inválida" });
      continue;
    }

    const cost = Number(cacheRow.cost_price);
    if (!Number.isFinite(cost) || cost <= 0) {
      applyErrors.push({
        item_id: itemId,
        variation_id: variationId,
        error: "Sem custo cadastrado; vincule um produto.",
      });
      continue;
    }
    if (!cacheRow.listing_type_id || !cacheRow.category_id) {
      applyErrors.push({
        item_id: itemId,
        variation_id: variationId,
        error: "Sem tipo de listagem ou categoria; sincronize o anúncio.",
      });
      continue;
    }

    const listing = toSolveInput(cacheRow);
    const feePercent = resolveReferenceFeePercent(listing, feePercentByCatType);
    if (feePercent == null) {
      applyErrors.push({
        item_id: itemId,
        variation_id: variationId,
        error: "Sem taxa de referência; sincronize os anúncios.",
      });
      continue;
    }

    const solved = solveMarginFast(listing, targetPct, feePercent, isMercadoLider, shippingRanges);
    if (!solved) {
      applyErrors.push({
        item_id: itemId,
        variation_id: variationId,
        error: "Não foi possível estimar preço pela margem.",
      });
      continue;
    }

    toSave.push({
      item_id: itemId,
      variation_id: variationId,
      sku: cacheRow.sku,
      planned_price: solved.price,
      calculated: {
        fee: solved.calculated.fee,
        shipping_cost: solved.calculated.shipping_cost,
      },
    });
  }

  if (toSave.length === 0) {
    return NextResponse.json({
      ok: false,
      saved: 0,
      errors: applyErrors,
      message: "Nenhuma linha aplicada.",
    });
  }

  const now = new Date().toISOString();
  const toUpsert = toSave.map((row) => ({
    account_id: account.id,
    item_id: row.item_id,
    variation_id: row.variation_id == null ? VARIATION_ID_ITEM : Number(row.variation_id),
    sku: row.sku?.trim() || null,
    planned_price: row.planned_price,
    updated_at: now,
  }));

  for (let i = 0; i < toUpsert.length; i += PLANNED_PRICES_UPSERT_BATCH) {
    const batch = toUpsert.slice(i, i + PLANNED_PRICES_UPSERT_BATCH);
    const { error: upsertError } = await supabase.from("planned_prices").upsert(batch, {
      onConflict: "account_id,item_id,variation_id",
      ignoreDuplicates: false,
    });
    if (upsertError) {
      console.error("[pricing/import/confirm] upsert", upsertError);
      return NextResponse.json({ error: "Erro ao salvar preços planejados" }, { status: 500 });
    }
  }

  try {
    await updatePricingCachePlannedPrices(
      account.id,
      toSave.map((u) => ({
        item_id: u.item_id,
        variation_id: u.variation_id,
        planned_price: u.planned_price,
      }))
    );
  } catch {
    // cache será atualizado no próximo refresh
  }

  const calculatedRows: Array<{
    item_id: string;
    variation_id: number | null;
    price: number;
    fee: number;
    shipping_cost: number;
  }> = [];

  for (const row of toSave) {
    if (row.calculated) {
      calculatedRows.push({
        item_id: row.item_id,
        variation_id: row.variation_id,
        price: row.planned_price,
        fee: row.calculated.fee,
        shipping_cost: row.calculated.shipping_cost,
      });
    }
  }

  if (promocaoForFees.length > 0) {
    const rules = await loadPricingRulesSnapshot(adminSupabase, siteId, { loadFeeReferences: true });
    const { results: feeResults, errors: feeErrors } = await computeItemsFees(promocaoForFees, {
      siteId,
      accessToken: "",
      isMercadoLider,
      supabaseAdmin: adminSupabase,
      useLinearFees: true,
      rules,
    });
    calculatedRows.push(...feeResults);
    for (const err of feeErrors) {
      applyErrors.push(err);
    }
  }

  if (calculatedRows.length > 0) {
    const serviceSupabase = createServiceClient();
    await persistCalculatedPricingBatch(serviceSupabase, account.id, calculatedRows);
  }

  return NextResponse.json({
    ok: true,
    saved: toSave.length,
    errors: applyErrors,
  });
}
