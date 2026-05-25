const CATEGORY_LABELS: Record<string, string> = {
  ALERT: "Alerta",
  NEW: "Novidade",
  RELEASE: "Lançamento",
  PUBLICITY: "Publicidade",
  MODAL: "Modal",
  OPPORTUNITY: "Capacitação / evento",
};

const TAG_TYPE_LABELS: Record<string, string> = {
  EVENTS: "Eventos",
  BILLING: "Faturamento",
  SHIPPING: "Envios",
  PUBLICATIONS: "Publicações",
  METRICS: "Métricas",
  CANCELLATIONS: "Cancelamentos",
  RETURNS: "Devoluções",
};

export function communicationCategoryLabel(category: string | null | undefined): string | null {
  if (!category) return null;
  return CATEGORY_LABELS[category] ?? category;
}

export function communicationTagTypeLabel(type: string | undefined): string {
  if (!type) return "";
  return TAG_TYPE_LABELS[type] ?? type;
}
