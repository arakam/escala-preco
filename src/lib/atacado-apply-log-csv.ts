/**
 * CSV do log de aplicação de atacado no Mercado Livre (job apply_wholesale_prices).
 */

export type AtacadoApplyLogRow = {
  item_id: string | null;
  variation_id: number | null;
  status: string;
  message: string | null;
  response_json?: unknown;
};

const SEP = ";";
const UTF8_BOM = "\uFEFF";

function escapeCsvField(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\r\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatResponseJson(value: unknown): string {
  if (value == null) return "";
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function buildAtacadoApplyLogCsv(
  logs: AtacadoApplyLogRow[],
  job?: { id: string; status: string; total: number; processed: number; ok: number; errors: number }
): string {
  const lines: string[] = [];
  if (job) {
    lines.push(
      [
        "job_id",
        "status",
        "total",
        "processado",
        "ok",
        "erros",
        "",
        "",
      ].join(SEP)
    );
    lines.push(
      [
        job.id,
        job.status,
        job.total,
        job.processed,
        job.ok,
        job.errors,
        "",
        "",
      ]
        .map(escapeCsvField)
        .join(SEP)
    );
    lines.push("");
  }
  lines.push(
    ["item_id", "variation_id", "status", "mensagem", "resposta_ml"].map(escapeCsvField).join(SEP)
  );
  for (const log of logs) {
    lines.push(
      [
        log.item_id ?? "",
        log.variation_id != null ? log.variation_id : "",
        log.status,
        log.message ?? "",
        formatResponseJson(log.response_json),
      ]
        .map(escapeCsvField)
        .join(SEP)
    );
  }
  return UTF8_BOM + lines.join("\r\n");
}

export function downloadAtacadoApplyLogCsv(
  logs: AtacadoApplyLogRow[],
  job?: { id: string; status: string; total: number; processed: number; ok: number; errors: number }
): void {
  const csv = buildAtacadoApplyLogCsv(logs, job);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const jobPart = job?.id ? job.id.slice(0, 8) : "log";
  a.download = `atacado-aplicar-ml-${jobPart}-${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
