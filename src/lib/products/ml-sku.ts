/** SKU gerado pelo ML no configurador/catálogo (ex.: CONF-MLB5097086620) — não é código do seller. */
const ML_PLACEHOLDER_SKU = /^CONF-ML[A-Z]{1,3}\d+$/i;

export function normalizeMlSku(sku: string): string {
  return sku.trim().toUpperCase();
}

export function isMlPlaceholderSku(sku: string | null | undefined): boolean {
  if (sku == null || String(sku).trim() === "") return false;
  return ML_PLACEHOLDER_SKU.test(normalizeMlSku(String(sku)));
}

function pickFirstValidSku(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (c == null) continue;
    const trimmed = String(c).trim();
    if (!trimmed) continue;
    const normalized = normalizeMlSku(trimmed);
    if (!isMlPlaceholderSku(normalized)) return normalized;
  }
  return null;
}

function skuFromAttributes(attrs: unknown): string | null {
  if (!Array.isArray(attrs)) return null;
  for (const id of ["SELLER_SKU", "SKU", "CUSTOM_SKU"] as const) {
    const attr = attrs.find(
      (a) => a && typeof a === "object" && (a as { id?: string }).id === id
    );
    if (!attr || typeof attr !== "object") continue;
    const v = (attr as { value_name?: string }).value_name;
    if (v != null && String(v).trim() !== "") return normalizeMlSku(String(v));
  }
  return null;
}

/** Extrai SKU do payload bruto de item ou variação ML (SELLER_SKU / seller_custom_field). */
export function extractSkuFromMlRawJson(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const fromAttrs = skuFromAttributes(obj.attributes);
  const scf =
    typeof obj.seller_custom_field === "string" && obj.seller_custom_field.trim()
      ? obj.seller_custom_field
      : null;
  return pickFirstValidSku(fromAttrs, scf);
}

/** Considera também `seller_custom_field` persistido na linha (pode divergir do raw_json). */
export function extractSkuFromMlListing(opts: {
  rawJson?: unknown;
  sellerCustomField?: string | null;
}): string | null {
  return pickFirstValidSku(
    extractSkuFromMlRawJson(opts.rawJson),
    opts.sellerCustomField
  );
}
