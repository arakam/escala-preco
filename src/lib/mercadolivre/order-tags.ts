/** Labels amigáveis para tags comuns em order.tags (Mercado Livre). */
const ML_ORDER_TAG_LABELS: Record<string, string> = {
  paid: "Pago",
  delivered: "Entregue",
  not_delivered: "Não entregue",
  no_shipping: "Sem envio",
  pack_order: "Carrinho",
  test_order: "Pedido teste",
  fraud_risk_detected: "Risco de fraude",
  b2b: "B2B",
  mshops: "Loja ML",
  catalog: "Catálogo",
  loyalty_discount: "Desconto fidelidade",
  bundle: "Kit",
};

export function parseMlOrderTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const s = String(t).trim().toLowerCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function formatMlOrderTagLabel(tag: string): string {
  const key = tag.trim().toLowerCase();
  if (ML_ORDER_TAG_LABELS[key]) return ML_ORDER_TAG_LABELS[key];
  return key
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function mlOrderTagBadgeClass(tag: string): string {
  const t = tag.toLowerCase();
  if (t === "paid" || t === "delivered") {
    return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200";
  }
  if (t === "fraud_risk_detected" || t === "not_delivered") {
    return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
  }
  if (t === "test_order") {
    return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200";
  }
  return "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200";
}
