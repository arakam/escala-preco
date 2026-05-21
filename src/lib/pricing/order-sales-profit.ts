import type { SupabaseClient } from "@supabase/supabase-js";
import { computeItemsFees, type PricingFeeInputItem } from "@/lib/pricing/compute-items-fees";
import { calculateFullPricing } from "@/lib/pricing/full-net";
import { loadPricingRulesSnapshot } from "@/lib/pricing/pricing-rules-cache";

const VARIATION_ID_ITEM = -1;

export type OrderLineInput = {
  ml_order_id: string;
  item_id: string;
  quantity: number;
  unit_price: number | null;
  line_index: number;
  /** Comissão ML da linha (order_items[].sale_fee). */
  sale_fee?: number | null;
};

export type OrderRealMeta = {
  shipping_cost_sender: number | null;
  marketplace_fee: number | null;
};

export type OrderLineProfit = OrderLineInput & {
  sku: string | null;
  cost_price: number | null;
  sale_price: number | null;
  /** Taxa estimada (regra Preços / % referência). */
  fee: number | null;
  /** Frete estimado (tabela Líder). */
  shipping_cost: number | null;
  profit: number | null;
  profit_percent: number | null;
  line_profit: number | null;
  profit_error: string | null;
  /** Taxa real: order_items[].sale_fee (comissão da linha no pedido ML). */
  fee_ml: number | null;
  /** Frete real do vendedor: parcela de shipping_cost_sender do pedido. */
  shipping_ml: number | null;
  line_profit_ml: number | null;
  profit_ml: number | null;
  profit_percent_ml: number | null;
  ml_data_error: string | null;
};

function lineGrossAmount(line: OrderLineInput): number {
  const qty = line.quantity > 0 ? line.quantity : 1;
  const price = line.unit_price != null && line.unit_price > 0 ? line.unit_price : 0;
  return price * qty;
}

/** Reparte frete do pedido entre linhas proporcional ao valor bruto da linha. */
function allocateShippingByLine(
  lines: OrderLineInput[],
  shippingCostSender: number | null
): Map<string, number> {
  const out = new Map<string, number>();
  const key = (l: OrderLineInput) => `${l.ml_order_id}:${l.line_index}:${l.item_id}`;
  if (shippingCostSender == null || !Number.isFinite(shippingCostSender)) {
    for (const l of lines) out.set(key(l), 0);
    return out;
  }
  const totalGross = lines.reduce((s, l) => s + lineGrossAmount(l), 0);
  if (totalGross <= 0) {
    const each = Math.round((shippingCostSender / lines.length) * 100) / 100;
    for (const l of lines) out.set(key(l), each);
    return out;
  }
  let assigned = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const gross = lineGrossAmount(l);
    const share =
      i === lines.length - 1
        ? Math.round((shippingCostSender - assigned) * 100) / 100
        : Math.round(((gross / totalGross) * shippingCostSender) * 100) / 100;
    out.set(key(l), share);
    assigned += share;
  }
  return out;
}

function computeMlLineProfit(
  listing: ListingCtx,
  unitPrice: number,
  quantity: number,
  saleFeeLine: number | null,
  shippingLine: number | null
): { line_profit_ml: number; profit_ml: number; profit_percent_ml: number } | null {
  if (listing.cost_price == null || unitPrice <= 0) return null;
  const qty = quantity > 0 ? quantity : 1;
  const feeLine = saleFeeLine != null && saleFeeLine >= 0 ? saleFeeLine : 0;
  const shipLine = shippingLine != null && shippingLine >= 0 ? shippingLine : 0;
  const unitFee = feeLine / qty;
  const unitShip = shipLine / qty;
  const full = calculateFullPricing(
    listing.tax_percent,
    listing.extra_fee_percent,
    listing.fixed_expenses,
    { price: unitPrice, fee: unitFee, shipping_cost: unitShip }
  );
  const unitProfit = Math.round((full.net_amount - listing.cost_price) * 100) / 100;
  const lineProfit = Math.round(unitProfit * qty * 100) / 100;
  const profitPercent =
    unitPrice > 0 ? Math.round(((unitProfit / unitPrice) * 100) * 10) / 10 : 0;
  return {
    line_profit_ml: lineProfit,
    profit_ml: unitProfit,
    profit_percent_ml: profitPercent,
  };
}

type ListingCtx = {
  item_id: string;
  listing_type_id: string | null;
  category_id: string | null;
  weight_kg: number | null;
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  sku: string | null;
  cost_price: number | null;
  tax_percent: number | null;
  extra_fee_percent: number | null;
  fixed_expenses: number | null;
  reference_fee_percent: number | null;
  current_price: number | null;
};

function pickBestListingRow(
  rows: Array<Record<string, unknown>>
): ListingCtx | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => {
    const av = Number(a.variation_id);
    const bv = Number(b.variation_id);
    const aItem = av === VARIATION_ID_ITEM || av === -1;
    const bItem = bv === VARIATION_ID_ITEM || bv === -1;
    if (aItem !== bItem) return aItem ? -1 : 1;
    const ap = a.product_id != null && a.product_id !== "";
    const bp = b.product_id != null && b.product_id !== "";
    if (ap !== bp) return ap ? -1 : 1;
    return av - bv;
  });
  const r = sorted[0];
  return {
    item_id: String(r.item_id).trim().toUpperCase(),
    listing_type_id: r.listing_type_id != null ? String(r.listing_type_id) : null,
    category_id: r.category_id != null ? String(r.category_id) : null,
    weight_kg: numOrNull(r.weight_kg),
    height_cm: numOrNull(r.height_cm),
    width_cm: numOrNull(r.width_cm),
    length_cm: numOrNull(r.length_cm),
    sku: r.sku != null ? String(r.sku) : null,
    cost_price: numOrNull(r.cost_price),
    tax_percent: numOrNull(r.tax_percent),
    extra_fee_percent: numOrNull(r.extra_fee_percent),
    fixed_expenses: numOrNull(r.fixed_expenses),
    reference_fee_percent: numOrNull(r.reference_fee_percent),
    current_price: numOrNull(r.current_price),
  };
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function loadListingByItemIds(
  supabase: SupabaseClient,
  accountId: string,
  itemIds: string[]
): Promise<Map<string, ListingCtx>> {
  const map = new Map<string, ListingCtx>();
  if (itemIds.length === 0) return map;

  const cacheCols =
    "item_id, variation_id, listing_type_id, category_id, weight_kg, height_cm, width_cm, length_cm, sku, product_id, cost_price, tax_percent, extra_fee_percent, fixed_expenses, reference_fee_percent, current_price";

  const chunk = 80;
  const byItem = new Map<string, Array<Record<string, unknown>>>();
  for (let i = 0; i < itemIds.length; i += chunk) {
    const slice = itemIds.slice(i, i + chunk);
    const { data: cacheRows } = await supabase
      .from("pricing_cache")
      .select(cacheCols)
      .eq("account_id", accountId)
      .in("item_id", slice);
    for (const row of cacheRows ?? []) {
      const id = String(row.item_id).trim().toUpperCase();
      const list = byItem.get(id) ?? [];
      list.push(row as Record<string, unknown>);
      byItem.set(id, list);
    }
  }

  const missing: string[] = [];
  for (const id of itemIds) {
    const rows = byItem.get(id);
    if (rows?.length) {
      const picked = pickBestListingRow(rows);
      if (picked) map.set(id, picked);
    } else {
      missing.push(id);
    }
  }

  if (missing.length > 0) {
    for (let i = 0; i < missing.length; i += chunk) {
      const slice = missing.slice(i, i + chunk);
      const { data: itemRows } = await supabase
        .from("ml_items")
        .select(
          `item_id, price, listing_type_id, category_id, weight_kg, height_cm, width_cm, length_cm, seller_custom_field,
           product_id, products ( sku, cost_price, tax_percent, extra_fee_percent, fixed_expenses, weight, height, width, length )`
        )
        .eq("account_id", accountId)
        .in("item_id", slice);

      for (const row of itemRows ?? []) {
        const raw = row as Record<string, unknown>;
        const id = String(raw.item_id).trim().toUpperCase();
        if (map.has(id)) continue;
        const prod = raw.products as Record<string, unknown> | Record<string, unknown>[] | null;
        const p = Array.isArray(prod) ? prod[0] : prod;
        map.set(id, {
          item_id: id,
          listing_type_id: raw.listing_type_id != null ? String(raw.listing_type_id) : null,
          category_id: raw.category_id != null ? String(raw.category_id) : null,
          weight_kg: numOrNull(raw.weight_kg) ?? numOrNull(p?.weight),
          height_cm: numOrNull(raw.height_cm) ?? numOrNull(p?.height),
          width_cm: numOrNull(raw.width_cm) ?? numOrNull(p?.width),
          length_cm: numOrNull(raw.length_cm) ?? numOrNull(p?.length),
          sku:
            (p && typeof p.sku === "string" ? p.sku : null) ??
            (raw.seller_custom_field != null ? String(raw.seller_custom_field) : null),
          cost_price: numOrNull(p?.cost_price),
          tax_percent: numOrNull(p?.tax_percent),
          extra_fee_percent: numOrNull(p?.extra_fee_percent),
          fixed_expenses: numOrNull(p?.fixed_expenses),
          reference_fee_percent: null,
          current_price: numOrNull(raw.price),
        });
      }
    }
  }

  return map;
}

/**
 * Calcula taxa, frete e lucro por linha de pedido (mesma regra da tela Preços).
 */
export async function enrichOrderLinesWithProfit(
  supabaseAdmin: SupabaseClient,
  accountId: string,
  siteId: string,
  accessToken: string,
  isMercadoLider: boolean,
  lines: OrderLineInput[],
  orderMetaById?: Map<string, OrderRealMeta>
): Promise<OrderLineProfit[]> {
  if (lines.length === 0) return [];

  const shippingByLineKey = new Map<string, number>();
  if (orderMetaById) {
    const byOrder = new Map<string, OrderLineInput[]>();
    for (const line of lines) {
      const list = byOrder.get(line.ml_order_id) ?? [];
      list.push(line);
      byOrder.set(line.ml_order_id, list);
    }
    Array.from(byOrder.entries()).forEach(([orderId, orderLines]) => {
      const meta = orderMetaById.get(orderId);
      const alloc = allocateShippingByLine(
        orderLines,
        meta?.shipping_cost_sender ?? null
      );
      Array.from(alloc.entries()).forEach(([k, v]) => shippingByLineKey.set(k, v));
    });
  }

  const itemIds = Array.from(
    new Set(lines.map((l) => String(l.item_id).trim().toUpperCase()).filter(Boolean))
  );
  const listingByItem = await loadListingByItemIds(supabaseAdmin, accountId, itemIds);
  const rules = await loadPricingRulesSnapshot(supabaseAdmin, siteId, { loadFeeReferences: true });

  const feeInputs: PricingFeeInputItem[] = [];
  const feeInputIndexByLine: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const itemId = String(line.item_id).trim().toUpperCase();
    const listing = listingByItem.get(itemId);
    const salePrice =
      line.unit_price != null && line.unit_price > 0
        ? line.unit_price
        : listing?.current_price != null && listing.current_price > 0
          ? listing.current_price
          : null;

    if (!listing || !salePrice || !listing.listing_type_id || !listing.category_id) {
      feeInputIndexByLine[i] = -1;
      continue;
    }

    feeInputIndexByLine[i] = feeInputs.length;
    feeInputs.push({
      item_id: itemId,
      variation_id: VARIATION_ID_ITEM,
      price: salePrice,
      listing_type_id: listing.listing_type_id,
      category_id: listing.category_id,
      weight_kg: listing.weight_kg,
      height_cm: listing.height_cm,
      width_cm: listing.width_cm,
      length_cm: listing.length_cm,
      reference_fee_percent: listing.reference_fee_percent,
    });
  }

  const feeByInputIndex = new Map<number, { fee: number; shipping_cost: number; price: number }>();
  if (feeInputs.length > 0) {
    const { results } = await computeItemsFees(feeInputs, {
      siteId,
      accessToken,
      isMercadoLider,
      supabaseAdmin,
      useLinearFees: true,
      rules,
    });
    const feeByKey = new Map<string, { fee: number; shipping_cost: number; price: number }>();
    for (const r of results) {
      feeByKey.set(`${r.item_id}:${r.variation_id ?? VARIATION_ID_ITEM}:${r.price}`, r);
    }
    for (let j = 0; j < feeInputs.length; j++) {
      const inp = feeInputs[j];
      const key = `${inp.item_id}:${inp.variation_id ?? VARIATION_ID_ITEM}:${inp.price}`;
      const row = feeByKey.get(key);
      if (row) feeByInputIndex.set(j, row);
    }
  }

  const linesByOrder = new Map<string, OrderLineInput[]>();
  for (const line of lines) {
    const list = linesByOrder.get(line.ml_order_id) ?? [];
    list.push(line);
    linesByOrder.set(line.ml_order_id, list);
  }

  function resolveSaleFeeMl(line: OrderLineInput): number | null {
    if (line.sale_fee != null && Number.isFinite(Number(line.sale_fee))) {
      return Number(line.sale_fee);
    }
    const meta = orderMetaById?.get(line.ml_order_id);
    if (meta?.marketplace_fee == null || !Number.isFinite(meta.marketplace_fee)) {
      return null;
    }
    const orderLines = linesByOrder.get(line.ml_order_id) ?? [line];
    const totalGross = orderLines.reduce((s, l) => s + lineGrossAmount(l), 0);
    const gross = lineGrossAmount(line);
    if (totalGross <= 0 || gross <= 0) return null;
    return Math.round(((gross / totalGross) * meta.marketplace_fee) * 100) / 100;
  }

  return lines.map((line, i) => {
    const itemId = String(line.item_id).trim().toUpperCase();
    const listing = listingByItem.get(itemId);
    const salePrice =
      line.unit_price != null && line.unit_price > 0
        ? line.unit_price
        : listing?.current_price != null && listing.current_price > 0
          ? listing.current_price
          : null;

    const lineKey = `${line.ml_order_id}:${line.line_index}:${itemId}`;
    const shippingMl = shippingByLineKey.get(lineKey) ?? null;
    const saleFeeMl = resolveSaleFeeMl(line);

    const base: OrderLineProfit = {
      ...line,
      sku: listing?.sku ?? null,
      cost_price: listing?.cost_price ?? null,
      sale_price: salePrice,
      fee: null,
      shipping_cost: null,
      profit: null,
      profit_percent: null,
      line_profit: null,
      profit_error: null,
      fee_ml: saleFeeMl,
      shipping_ml: shippingMl,
      line_profit_ml: null,
      profit_ml: null,
      profit_percent_ml: null,
      ml_data_error: null,
    };

    if (!listing) {
      return { ...base, profit_error: "Anúncio não encontrado no cache" };
    }
    if (salePrice == null || salePrice <= 0) {
      return { ...base, profit_error: "Preço da venda indisponível" };
    }
    if (!listing.listing_type_id || !listing.category_id) {
      return { ...base, profit_error: "Tipo ou categoria do anúncio ausente" };
    }
    if (listing.cost_price == null) {
      return { ...base, profit_error: "Sem produto vinculado (custo)" };
    }

    const feeIdx = feeInputIndexByLine[i];
    if (feeIdx < 0) {
      return { ...base, profit_error: "Não foi possível calcular taxa/frete" };
    }
    const feeRow = feeByInputIndex.get(feeIdx);
    if (!feeRow) {
      return { ...base, profit_error: "Taxa ML indisponível (sincronize anúncios)" };
    }

    const full = calculateFullPricing(
      listing.tax_percent,
      listing.extra_fee_percent,
      listing.fixed_expenses,
      {
        price: feeRow.price,
        fee: feeRow.fee,
        shipping_cost: feeRow.shipping_cost,
      }
    );
    const unitProfit = Math.round((full.net_amount - listing.cost_price) * 100) / 100;
    const profitPercent =
      salePrice > 0 ? Math.round(((unitProfit / salePrice) * 100) * 10) / 10 : null;
    const qty = line.quantity > 0 ? line.quantity : 1;
    const lineProfit = Math.round(unitProfit * qty * 100) / 100;

    let mlProfit: ReturnType<typeof computeMlLineProfit> = null;
    let mlDataError: string | null = null;
    if (saleFeeMl == null && shippingMl == null) {
      mlDataError = "Sem sale_fee nem frete ML no pedido (resincronize)";
    } else if (listing.cost_price == null) {
      mlDataError = "Sem custo para lucro real";
    } else {
      mlProfit = computeMlLineProfit(
        listing,
        salePrice,
        line.quantity,
        saleFeeMl,
        shippingMl
      );
      if (!mlProfit && saleFeeMl == null) {
        mlDataError = "Comissão ML da linha indisponível";
      }
    }

    return {
      ...base,
      fee: feeRow.fee,
      shipping_cost: feeRow.shipping_cost,
      profit: unitProfit,
      profit_percent: profitPercent,
      line_profit: lineProfit,
      profit_error: null,
      fee_ml: saleFeeMl,
      shipping_ml: shippingMl,
      line_profit_ml: mlProfit?.line_profit_ml ?? null,
      profit_ml: mlProfit?.profit_ml ?? null,
      profit_percent_ml: mlProfit?.profit_percent_ml ?? null,
      ml_data_error: mlDataError,
    };
  });
}
