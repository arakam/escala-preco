/**
 * Normaliza resposta de GET /seller-promotions/items/{item_id}?app_version=v2
 * e resume promoções consideradas ativas para exibição na tela de preços.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** Lista de objetos promoção a partir do JSON do ML (array, results, objeto único, etc.). */
export function normalizeSellerPromotionsList(raw: unknown): Record<string, unknown>[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.filter(isPlainObject) as Record<string, unknown>[];
  }
  if (isPlainObject(raw)) {
    if (Array.isArray(raw.results)) return raw.results.filter(isPlainObject) as Record<string, unknown>[];
    if (Array.isArray(raw.promotions)) return raw.promotions.filter(isPlainObject) as Record<string, unknown>[];
    if (raw.type != null || raw.status != null || raw.id != null) {
      return [raw];
    }
    const vals = Object.values(raw);
    if (vals.length > 0 && vals.every((v) => isPlainObject(v))) {
      return vals as Record<string, unknown>[];
    }
  }
  return [];
}

/**
 * Promoção “ativa” para o vendedor: em andamento no ML ou pendente com preço de venda já definido.
 * Ignoramos em geral `candidate` sem preço (ainda não aplicada).
 */
export function isActiveSellerPromotion(p: Record<string, unknown>): boolean {
  const s = String(p.status ?? "").toLowerCase();
  if (s === "started") return true;
  if (s === "pending") {
    const price = Number(p.price);
    return Number.isFinite(price) && price > 0;
  }
  return false;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatPromotionValuePart(p: Record<string, unknown>): string {
  const price = Number(p.price);
  if (Number.isFinite(price) && price > 0) return brl.format(price);

  const fp = p.fixed_percentage;
  if (fp != null && Number.isFinite(Number(fp))) return `${fp}% (pct. fixo)`;

  const fa = p.fixed_amount;
  if (fa != null && Number.isFinite(Number(fa))) return `${brl.format(Number(fa))} (valor fixo)`;

  const mp = p.meli_percentage;
  const sp = p.seller_percentage;
  if ((mp != null && Number.isFinite(Number(mp))) || (sp != null && Number.isFinite(Number(sp)))) {
    return `ML ${mp ?? 0}% · vend. ${sp ?? 0}%`;
  }

  const sug = p.suggested_discounted_price;
  if (sug != null && Number.isFinite(Number(sug))) return `sug. ${brl.format(Number(sug))}`;

  const orig = p.original_price;
  if (orig != null && Number.isFinite(Number(orig))) return `lista ${brl.format(Number(orig))}`;

  return "—";
}

export function formatSellerPromotionLine(p: Record<string, unknown>): string {
  const name = String(p.name ?? "").trim() || String(p.type ?? "Promoção");
  const typ = p.type ? ` · ${String(p.type)}` : "";
  return `${name}${typ} — ${formatPromotionValuePart(p)}`;
}

/** Texto multilinha para gravar em pricing_cache.ml_active_promotions (uma promo por linha). */
export function buildMlActivePromotionsStorageText(raw: unknown): string {
  const list = normalizeSellerPromotionsList(raw).filter(isActiveSellerPromotion);
  if (list.length === 0) return "";
  return list.map(formatSellerPromotionLine).join("\n");
}

/** Linhas não vazias para UI. */
export function splitMlActivePromotionsCell(stored: string | null | undefined): string[] {
  if (!stored?.trim()) return [];
  return stored
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
