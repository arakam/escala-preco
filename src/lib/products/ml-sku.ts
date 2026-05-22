/** Extrai SKU do payload bruto de item ou variação ML (SELLER_SKU / seller_custom_field). */
export function extractSkuFromMlRawJson(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const attrs = obj.attributes;
  if (Array.isArray(attrs)) {
    for (const a of attrs) {
      if (!a || typeof a !== "object") continue;
      const id = (a as { id?: string }).id;
      if (id === "SELLER_SKU" || id === "SKU" || id === "CUSTOM_SKU") {
        const v = (a as { value_name?: string }).value_name;
        if (v != null && String(v).trim() !== "") return normalizeMlSku(String(v));
      }
    }
  }
  const scf = obj.seller_custom_field;
  if (typeof scf === "string" && scf.trim()) return normalizeMlSku(scf);
  return null;
}

export function normalizeMlSku(sku: string): string {
  return sku.trim().toUpperCase();
}
