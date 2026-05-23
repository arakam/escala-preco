/** Rótulos em português para `ml_items.status` (valores da API do Mercado Livre). */

const ML_ITEM_STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  paused: "Pausado",
  closed: "Fechado",
  under_review: "Em revisão",
  inactive: "Inativo",
  payment_required: "Pagamento necessário",
  not_yet_active: "Ainda não ativo",
  deleted: "Excluído",
};

export function formatMlItemStatusLabel(status: string | null | undefined): string {
  if (status == null || String(status).trim() === "") return "—";
  const key = String(status).trim().toLowerCase();
  if (ML_ITEM_STATUS_LABELS[key]) return ML_ITEM_STATUS_LABELS[key];
  return key
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Classes do chip de status na tabela (tema claro + escuro). */
export function mlItemStatusBadgeClass(status: string | null | undefined): string {
  const base =
    "ml-item-status-badge inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset";
  const key = status == null ? "" : String(status).trim().toLowerCase();
  switch (key) {
    case "active":
      return `${base} bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-700`;
    case "paused":
      return `${base} bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-700`;
    case "closed":
    case "deleted":
      return `${base} bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600`;
    case "under_review":
    case "not_yet_active":
      return `${base} bg-sky-50 text-sky-900 ring-sky-200 dark:bg-sky-950 dark:text-sky-100 dark:ring-sky-700`;
    case "payment_required":
      return `${base} bg-red-50 text-red-900 ring-red-200 dark:bg-red-950 dark:text-red-100 dark:ring-red-700`;
    case "inactive":
      return `${base} bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800/80 dark:text-slate-300 dark:ring-slate-600`;
    default:
      return `${base} bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-700 dark:text-slate-100 dark:ring-slate-600`;
  }
}

/** Opções do filtro Status na tela Anúncios (valor = API, rótulo = PT). */
export const ML_ITEM_STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "active", label: "Ativo" },
  { value: "paused", label: "Pausado" },
  { value: "closed", label: "Fechado" },
  { value: "under_review", label: "Em revisão" },
  { value: "inactive", label: "Inativo" },
  { value: "payment_required", label: "Pagamento necessário" },
  { value: "not_yet_active", label: "Ainda não ativo" },
];
