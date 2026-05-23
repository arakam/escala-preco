/** Rótulos em português para modo/tipo logístico do Mercado Envios (shipments.logistic). */

const LOGISTIC_MODE_LABELS: Record<string, string> = {
  me2: "Mercado Envios",
  me1: "Mercado Envios",
  custom: "Frete customizado",
  not_specified: "Não especificado",
};

const LOGISTIC_TYPE_LABELS: Record<string, string> = {
  drop_off: "Coleta / agência",
  xd_drop_off: "Ponto de coleta",
  cross_docking: "Cross docking",
  fulfillment: "Full",
  self_service: "Flex",
  custom: "Customizado",
  default: "Padrão",
};

export type OrderShippingMeta = {
  shipping_id?: string | null;
  shipping_logistic_mode?: string | null;
  shipping_logistic_type?: string | null;
  shipping_carrier?: string | null;
  tags?: string[];
};

export function labelMlLogisticMode(mode: string | null | undefined): string | null {
  if (!mode) return null;
  const key = mode.trim().toLowerCase();
  return LOGISTIC_MODE_LABELS[key] ?? mode;
}

export function labelMlLogisticType(type: string | null | undefined): string | null {
  if (!type) return null;
  const key = type.trim().toLowerCase();
  return LOGISTIC_TYPE_LABELS[key] ?? type.replace(/_/g, " ");
}

/** Texto único para exibir na tela de vendas (modo · tipo · transportadora). */
export function formatOrderShippingLabel(meta: OrderShippingMeta): string | null {
  const tags = meta.tags ?? [];
  if (tags.includes("no_shipping")) return "Sem envio";

  const parts: string[] = [];
  const mode = labelMlLogisticMode(meta.shipping_logistic_mode);
  const type = labelMlLogisticType(meta.shipping_logistic_type);
  const carrier = meta.shipping_carrier?.trim();

  if (mode) parts.push(mode);
  if (type && type !== mode) parts.push(type);
  if (carrier) parts.push(carrier);

  if (parts.length > 0) return parts.join(" · ");

  if (meta.shipping_id) return "Envio ML";
  return null;
}
