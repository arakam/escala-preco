/**
 * Tipos de promoção/campanha retornados pelo Mercado Livre em `seller-promotions` (campo `type`).
 * Referência: documentação de promoções e campanhas (Manage promotions / tipos de campanha).
 *
 * Valores são normalizados em maiúsculas; o ML pode enviar variantes — use `normalizeMlPromotionTypeCode`.
 */

export type MlPromotionTypeEntry = {
  /** Valor típico do campo `type` na API. */
  code: string;
  /** Nome amigável para filtros e UI. */
  labelPt: string;
};

/**
 * Catálogo principal (campanhas tradicionais, marketplace, relâmpago, SMART, cupons, etc.).
 * Mantido alinhado aos tipos citados na documentação pública do ML.
 */
export const ML_PROMOTION_TYPE_CATALOG: readonly MlPromotionTypeEntry[] = [
  { code: "DEAL", labelPt: "Campanhas tradicionais (DEAL)" },
  { code: "MARKETPLACE_CAMPAIGN", labelPt: "Campanhas com participação do ML (MARKETPLACE_CAMPAIGN)" },
  { code: "PRICE_DISCOUNT", labelPt: "Descontos individuais (PRICE_DISCOUNT)" },
  { code: "LIGHTNING", labelPt: "Ofertas relâmpago (LIGHTNING)" },
  { code: "DOD", labelPt: "Ofertas do dia (DOD)" },
  { code: "VOLUME", labelPt: "Desconto por volume (VOLUME)" },
  { code: "PRE_NEGOTIATED", labelPt: "Desconto pré-acordado por item (PRE_NEGOTIATED)" },
  { code: "SELLER_CAMPAIGN", labelPt: "Campanha do vendedor (SELLER_CAMPAIGN)" },
  { code: "SMART", labelPt: "Co-participação automatizada (SMART)" },
  { code: "PRICE_MATCHING", labelPt: "Preços competitivos (PRICE_MATCHING)" },
  { code: "UNHEALTHY_STOCK", labelPt: "Liquidação estoque Full (UNHEALTHY_STOCK)" },
  { code: "SELLER_COUPON_CAMPAIGN", labelPt: "Cupons do vendedor (SELLER_COUPON_CAMPAIGN)" },
] as const;

const LABEL_BY_CODE = new Map<string, string>(
  ML_PROMOTION_TYPE_CATALOG.map((e) => [e.code, e.labelPt])
);

/** Normaliza valor do ML para comparação e filtro (maiúsculas, espaços → _). */
export function normalizeMlPromotionTypeCode(raw: string | null | undefined): string {
  if (raw == null) return "";
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, "_");
  return s || "";
}

export function labelForMlPromotionType(code: string | null | undefined): string {
  const c = normalizeMlPromotionTypeCode(code ?? "");
  if (!c) return "—";
  return LABEL_BY_CODE.get(c) ?? c;
}

/**
 * Extrai o código do tipo no sufixo ` · TYPE` do título gerado por `formatSellerPromotionTitle`
 * (resposta seller-promotions). Usado quando a coluna `promotion_type` no cache ainda é nula.
 */
export function inferPromotionTypeFromSellerTitleLabel(label: string | null | undefined): string | null {
  if (label == null || !String(label).trim()) return null;
  const s = String(label);
  const idx = s.lastIndexOf(" · ");
  if (idx < 0) return null;
  const tail = s.slice(idx + 3).trim();
  if (!tail) return null;
  const token = (tail.split(/[\s—–|]/)[0] ?? "").trim();
  const c = normalizeMlPromotionTypeCode(token);
  return c || null;
}

/** Códigos conhecidos, mais longos primeiro (ex.: MARKETPLACE_CAMPAIGN antes de DEAL). */
const CATALOG_CODES_BY_LENGTH_DESC = [...ML_PROMOTION_TYPE_CATALOG.map((e) => e.code)].sort(
  (a, b) => b.length - a.length
);

/**
 * Tenta extrair um tipo de campanha do texto do rótulo (colunas Promoção / cache), inclusive quando
 * o ML não usa o sufixo exato ` · TYPE` (ex.: outro separador ou nome traduzido + código entre parênteses).
 */
export function inferPromotionTypeFromAnyLabelText(label: string | null | undefined): string | null {
  const strict = inferPromotionTypeFromSellerTitleLabel(label);
  if (strict) return strict;
  if (label == null || !String(label).trim()) return null;
  const u = String(label).toUpperCase();
  for (const code of CATALOG_CODES_BY_LENGTH_DESC) {
    if (u.includes(` · ${code}`)) return code;
    if (u.includes(`(${code})`)) return code;
    if (u.includes(`[${code}]`)) return code;
    if (u.includes(`— ${code}`) || u.includes(`- ${code}`)) return code;
  }
  return null;
}
