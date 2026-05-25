/**
 * Editor de Preço de Atacado (Preço por Quantidade)
 * Serviço e validações para drafts de atacado.
 */

export interface Tier {
  min_qty: number;
  price: number;
}

export interface AtacadoRow {
  item_id: string;
  variation_id: number | null;
  sku: string | null;
  title: string | null;
  current_price: number | null;
  tiers: Tier[];
  has_draft: boolean;
  has_variations: boolean;
  draft_updated_at: string | null;
}

export interface DraftRowInput {
  item_id: string;
  variation_id: number | null;
  tiers: Tier[];
}

export interface ValidationError {
  item_id: string;
  variation_id: number | null;
  field: string;
  message: string;
}

const MAX_TIERS = 5;
const MIN_QTY_MIN = 2;

/**
 * Valida um array de tiers.
 * Regras:
 * - min_qty: inteiro >= 2
 * - price: número > 0
 * - ordem crescente por min_qty
 * - sem duplicatas em min_qty
 * - sem buracos (se Tier3 existe, Tier2 e Tier1 devem existir)
 * - se min_qty preenchido, price obrigatório e vice-versa
 * - permitir menos de 5 tiers
 */
export function validateTiers(tiers: Tier[]): string[] {
  const errors: string[] = [];

  if (tiers.length > MAX_TIERS) {
    errors.push(`No máximo ${MAX_TIERS} faixas de atacado permitidas`);
    return errors;
  }

  // Validar cada faixa (Atacado 1…5 no CSV / UI)
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (typeof t.min_qty !== "number" || typeof t.price !== "number") {
      errors.push(`Atacado ${i + 1}: quantidade mínima e preço são obrigatórios`);
      continue;
    }
    if (t.min_qty < MIN_QTY_MIN || !Number.isInteger(t.min_qty)) {
      errors.push(`Atacado ${i + 1}: quantidade mínima deve ser inteiro >= ${MIN_QTY_MIN}`);
    }
    if (t.price <= 0) {
      errors.push(`Atacado ${i + 1}: preço deve ser > 0`);
    }
  }

  // Ordenar por min_qty e checar duplicatas e ordem
  const sorted = [...tiers].sort((a, b) => a.min_qty - b.min_qty);
  const minQtys = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    if (minQtys.has(sorted[i].min_qty)) {
      errors.push(`Quantidade mínima ${sorted[i].min_qty} duplicada`);
    }
    minQtys.add(sorted[i].min_qty);
  }

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].min_qty <= sorted[i - 1].min_qty) {
      errors.push(
        `Cada quantidade mínima deve ser maior que a anterior (recebido ${sorted[i].min_qty} após ${sorted[i - 1].min_qty}).`
      );
    }
  }

  return errors;
}

/**
 * Valida uma linha de draft completa.
 */
export function validateDraftRow(
  row: DraftRowInput
): ValidationError[] {
  const errs: ValidationError[] = [];
  const tierErrors = validateTiers(row.tiers);
  for (const msg of tierErrors) {
    errs.push({
      item_id: row.item_id,
      variation_id: row.variation_id,
      field: "tiers",
      message: msg,
    });
  }
  return errs;
}

/**
 * Parseia tiers de um array e retorna array validado (ordenado) ou null se inválido.
 */
export function parseTiers(raw: unknown): Tier[] | null {
  if (!Array.isArray(raw)) return null;
  const tiers: Tier[] = [];
  for (const t of raw) {
    if (t && typeof t === "object" && "min_qty" in t && "price" in t) {
      const minQty = Number(t.min_qty);
      const price = Number(t.price);
      if (Number.isInteger(minQty) && minQty >= MIN_QTY_MIN && price > 0) {
        tiers.push({ min_qty: minQty, price });
      }
    }
  }
  tiers.sort((a, b) => a.min_qty - b.min_qty);
  const errs = validateTiers(tiers);
  return errs.length === 0 ? tiers : null;
}

/**
 * Converte `ml_items.wholesale_prices_json` da sync (GET /items/{id}/prices):
 * `{ min_purchase_unit, amount }[]` → tiers do editor / `wholesale_drafts`.
 * Retorna null se não houver faixas válidas segundo as regras do app (ex.: quantidade mínima menor que 2).
 */
export function tiersFromMlWholesaleJson(raw: unknown): Tier[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const mapped: Tier[] = [];
  for (const el of raw) {
    if (el == null || typeof el !== "object") continue;
    const o = el as Record<string, unknown>;
    const minRaw = o.min_purchase_unit ?? o.min_qty;
    const priceRaw = o.amount ?? o.price;
    const min_qty = typeof minRaw === "number" ? minRaw : Number(minRaw);
    const price = typeof priceRaw === "number" ? priceRaw : Number(priceRaw);
    if (!Number.isFinite(min_qty) || !Number.isFinite(price)) continue;
    if (!Number.isInteger(min_qty)) continue;
    mapped.push({ min_qty, price });
  }
  const normalized = normalizeTiers(mapped);
  if (normalized.length === 0) return null;
  const errs = validateTiers(normalized);
  return errs.length === 0 ? normalized : null;
}

/**
 * Normaliza tiers: remove vazios, ordena, garante formato.
 */
export function normalizeTiers(tiers: Tier[]): Tier[] {
  const filtered = tiers.filter(
    (t) =>
      typeof t.min_qty === "number" &&
      typeof t.price === "number" &&
      Number.isInteger(t.min_qty) &&
      t.min_qty >= MIN_QTY_MIN &&
      t.price > 0
  );
  const sorted = filtered.sort((a, b) => a.min_qty - b.min_qty);
  const seen = new Set<number>();
  return sorted.filter((t) => {
    if (seen.has(t.min_qty)) return false;
    seen.add(t.min_qty);
    return true;
  }).slice(0, MAX_TIERS);
}

/** SKU do join Supabase `products:product_id (sku)`. */
export function productSkuFromJoin(products: unknown): string | null {
  if (!products) return null;
  const prod = products as Record<string, unknown> | Record<string, unknown>[] | null;
  const p = Array.isArray(prod) ? prod[0] : prod;
  const sku = p && typeof p.sku === "string" ? p.sku.trim() : "";
  return sku || null;
}

function extractSkuFromAttributes(attributes: unknown): string | null {
  if (!Array.isArray(attributes)) return null;
  const skuAttr = attributes.find(
    (a: { id?: string }) => a?.id === "SELLER_SKU" || a?.id === "SKU" || a?.id === "CUSTOM_SKU"
  );
  if (skuAttr && typeof skuAttr === "object" && "value_name" in skuAttr) {
    const v = (skuAttr as { value_name?: string }).value_name;
    return v ? String(v).trim() : null;
  }
  return null;
}

/**
 * SKU exibido na tela de atacado: atributos ML → seller_custom_field → produto vinculado.
 * Alinhado à tela de Preços (`pricing-cache`).
 */
export function resolveMlListingSku(opts: {
  rawJson?: unknown;
  sellerCustomField?: string | null;
  attributesJson?: unknown;
  variationRawJson?: unknown;
  productSku?: string | null;
}): string | null {
  const variationRaw = opts.variationRawJson as Record<string, unknown> | null | undefined;
  if (variationRaw) {
    const fromVarAttrs = extractSkuFromAttributes(variationRaw.attributes);
    if (fromVarAttrs) return fromVarAttrs;
  }
  const fromAttrsJson = extractSkuFromAttributes(opts.attributesJson);
  if (fromAttrsJson) return fromAttrsJson;

  const raw = opts.rawJson as Record<string, unknown> | null | undefined;
  if (raw) {
    const fromItemAttrs = extractSkuFromAttributes(raw.attributes);
    if (fromItemAttrs) return fromItemAttrs;
    if (typeof raw.seller_custom_field === "string" && raw.seller_custom_field.trim()) {
      return raw.seller_custom_field.trim();
    }
  }

  const scf = opts.sellerCustomField;
  if (scf != null && String(scf).trim() !== "") return String(scf).trim();

  return opts.productSku?.trim() ? opts.productSku.trim() : null;
}

export type AtacadoSkuVariationInput = {
  attributes_json?: unknown;
  raw_json?: unknown;
  seller_custom_field?: string | null;
  products?: unknown;
};

/** Resolve SKU de um anúncio (nível item), considerando variações e produto vinculado. */
export function resolveSkuForAtacadoListing(
  item: {
    raw_json?: unknown;
    seller_custom_field?: string | null;
    products?: unknown;
  },
  variations: AtacadoSkuVariationInput[]
): string | null {
  const itemProductSku = productSkuFromJoin(item.products);

  const fromItem = resolveMlListingSku({
    rawJson: item.raw_json,
    sellerCustomField: item.seller_custom_field,
    productSku: itemProductSku,
  });
  if (fromItem) return fromItem;

  for (const v of variations) {
    const s = resolveMlListingSku({
      attributesJson: v.attributes_json,
      variationRawJson: v.raw_json,
      sellerCustomField: v.seller_custom_field,
      productSku: productSkuFromJoin(v.products),
    });
    if (s) return s;
  }

  return itemProductSku;
}
