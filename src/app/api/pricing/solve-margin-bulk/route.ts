import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadPricingRulesSnapshot } from "@/lib/pricing/pricing-rules-cache";
import { persistCalculatedPricingBatch } from "@/lib/pricing/persist-calculated-batch";
import type { FullPricingBreakdown } from "@/lib/pricing/full-net";
import {
  resolveReferenceFeePercent,
  solveMarginFast,
  type SolveMarginFastInput,
} from "@/lib/pricing/solve-margin-fast";

type BulkMarginItemBody = {
  item_id: string;
  variation_id?: number | null;
  listing_type_id: string;
  category_id: string;
  weight_kg?: number | null;
  height_cm?: number | null;
  width_cm?: number | null;
  length_cm?: number | null;
  cost_price: number;
  tax_percent?: number | null;
  extra_fee_percent?: number | null;
  fixed_expenses?: number | null;
  reference_fee_percent?: number | null;
  current_price?: number | null;
  planned_price?: number | null;
};

interface SolveMarginBulkBody {
  target_margin_percent: number;
  is_mercado_lider?: boolean;
  items: BulkMarginItemBody[];
}

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = (await req.json()) as SolveMarginBulkBody;
  const targetPct = Number(body.target_margin_percent);
  if (!Number.isFinite(targetPct)) {
    return NextResponse.json({ error: "target_margin_percent inválido" }, { status: 400 });
  }

  if (!body.items?.length) {
    return NextResponse.json({ error: "Nenhum item informado" }, { status: 400 });
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

  const results: Array<{
    item_id: string;
    variation_id: number | null;
    price: number;
    calculated: FullPricingBreakdown;
  }> = [];
  const errors: { item_id: string; variation_id: number | null; error: string }[] = [];

  for (const raw of body.items) {
    const itemId = String(raw.item_id).trim().toUpperCase();
    const variationId = raw.variation_id ?? null;
    const cost = Number(raw.cost_price);

    if (!Number.isFinite(cost) || cost <= 0) {
      errors.push({ item_id: itemId, variation_id: variationId, error: "cost_price inválido" });
      continue;
    }

    if (!raw.listing_type_id || !raw.category_id) {
      errors.push({ item_id: itemId, variation_id: variationId, error: "Sem tipo de listagem ou categoria" });
      continue;
    }

    const listing: SolveMarginFastInput = {
      item_id: itemId,
      variation_id: variationId,
      listing_type_id: raw.listing_type_id,
      category_id: raw.category_id,
      weight_kg: raw.weight_kg,
      height_cm: raw.height_cm,
      width_cm: raw.width_cm,
      length_cm: raw.length_cm,
      cost_price: cost,
      tax_percent: raw.tax_percent ?? null,
      extra_fee_percent: raw.extra_fee_percent ?? null,
      fixed_expenses: raw.fixed_expenses ?? null,
      reference_fee_percent: raw.reference_fee_percent ?? null,
      current_price: raw.current_price ?? null,
      planned_price: raw.planned_price ?? null,
    };

    const feePercent = resolveReferenceFeePercent(listing, feePercentByCatType);
    if (feePercent == null) {
      errors.push({
        item_id: itemId,
        variation_id: variationId,
        error: "Sem taxa de referência; sincronize os anúncios.",
      });
      continue;
    }

    const solved = solveMarginFast(listing, targetPct, feePercent, isMercadoLider, shippingRanges);
    if (!solved) {
      errors.push({
        item_id: itemId,
        variation_id: variationId,
        error: "Não foi possível estimar preço pela margem.",
      });
      continue;
    }

    results.push({
      item_id: solved.item_id,
      variation_id: solved.variation_id,
      price: solved.price,
      calculated: solved.calculated,
    });
  }

  if (results.length > 0) {
    const serviceSupabase = createServiceClient();
    await persistCalculatedPricingBatch(
      serviceSupabase,
      account.id,
      results.map((r) => ({
        item_id: r.item_id,
        variation_id: r.variation_id,
        price: r.price,
        fee: r.calculated.fee,
        shipping_cost: r.calculated.shipping_cost,
      }))
    );
  }

  return NextResponse.json({
    results,
    errors,
    target_margin_percent: targetPct,
    is_mercado_lider: isMercadoLider,
  });
}
