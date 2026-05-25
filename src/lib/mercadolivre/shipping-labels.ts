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
export type OrderDispatchDeadlineMeta = {
  shipping_sla_expected_at?: string | null;
  shipping_sla_status?: string | null;
  tags?: string[];
};

function formatDateOnlyPtBr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const SLA_STATUS_LABELS: Record<string, string> = {
  on_time: "No prazo",
  delayed: "Atrasado",
  early: "Adiantado",
  insufficient_info: "Info insuficiente",
};

/** Prazo máximo de despacho (GET /shipments/{id}/sla → expected_date). */
export function formatOrderDispatchDeadline(
  meta: OrderDispatchDeadlineMeta
): { label: string | null; title: string | null } {
  const tags = meta.tags ?? [];
  if (tags.includes("no_shipping")) {
    return { label: "Sem envio", title: null };
  }

  const sla = meta.shipping_sla_expected_at?.trim();
  if (!sla) {
    return { label: null, title: "Resincronize o pedido para obter o SLA do envio" };
  }

  const slaStatus = meta.shipping_sla_status?.trim().toLowerCase();
  const statusLabel = slaStatus ? SLA_STATUS_LABELS[slaStatus] ?? slaStatus : null;
  return {
    label: formatDateOnlyPtBr(sla),
    title: statusLabel
      ? `Prazo máximo de despacho (SLA) · ${statusLabel}`
      : "Prazo máximo de despacho (GET /shipments/{id}/sla → expected_date)",
  };
}

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
