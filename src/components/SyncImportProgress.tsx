"use client";

import type { ReactNode } from "react";

/** Estados de `ml_jobs.status` → rótulos em português */
export function mlJobStatusLabelPt(status: string): string {
  switch (status) {
    case "queued":
      return "Na fila";
    case "running":
      return "Em andamento";
    case "success":
      return "Concluído";
    case "failed":
      return "Falhou";
    case "partial":
      return "Concluído com avisos";
    default:
      return status;
  }
}

export interface SyncImportProgressJob {
  status: string;
  total: number;
  processed: number;
  ok: number;
  errors: number;
}

interface SyncImportProgressProps {
  job: SyncImportProgressJob;
  actions?: ReactNode;
  /** `app`: tema Anúncios (primary). `plain`: cartão cinza (página Mercado Livre). */
  tone?: "app" | "plain";
}

function n(v: unknown, fallback = 0): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

export function SyncImportProgress({ job, actions, tone = "app" }: SyncImportProgressProps) {
  const status = job.status ?? "";
  const total = n(job.total);
  const processed = n(job.processed);
  const ok = n(job.ok);
  const errors = n(job.errors);
  const label = mlJobStatusLabelPt(status);
  const showCounts = total > 0;
  const pct = showCounts ? Math.min(100, Math.round((processed / Math.max(1, total)) * 100)) : 0;
  const preparing =
    (status === "queued" || status === "running") && total === 0;

  const shell =
    tone === "app"
      ? "rounded-app bg-slate-50 px-3 py-3 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:ring-slate-600"
      : "rounded-md bg-slate-50 p-3 text-sm text-fg ring-1 ring-slate-200 dark:bg-slate-800/60 dark:text-fg dark:ring-slate-600";
  const fill = tone === "app" ? "bg-primary" : "bg-brand-blue";
  const muted = tone === "app" ? "text-slate-500 dark:text-slate-400" : "text-fg-muted";
  const strong = tone === "app" ? "text-slate-800 dark:text-slate-100" : "text-fg-strong";

  return (
    <div className={shell}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
            <span className={`font-semibold ${strong}`}>Importação</span>
            <span className={tone === "app" ? "text-slate-600 dark:text-slate-300" : "text-fg"}>· {label}</span>
            {showCounts && (
              <span className={tone === "app" ? "text-slate-600 dark:text-slate-300" : "text-fg"}>
                · {processed.toLocaleString("pt-BR")} de {total.toLocaleString("pt-BR")} anúncios
              </span>
            )}
            {showCounts && ok > 0 && (
              <span className="text-emerald-700 dark:text-emerald-400">
                · {ok.toLocaleString("pt-BR")} com sucesso
              </span>
            )}
            {showCounts && errors > 0 && (
              <span className="text-rose-700 dark:text-rose-400">
                · {errors.toLocaleString("pt-BR")} com falha
              </span>
            )}
          </div>
          {preparing ? (
            <p className={`text-xs ${muted}`}>
              Buscando lista de anúncios no Mercado Livre…
            </p>
          ) : null}
          <div
            className={`h-2 w-full overflow-hidden rounded-full ${tone === "app" ? "bg-slate-200/90 dark:bg-slate-600/80" : "bg-slate-200 dark:bg-slate-600/80"}`}
            role="progressbar"
            aria-valuenow={preparing ? undefined : pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progresso da importação de anúncios"
          >
            {preparing ? (
              <div className={`h-full w-full rounded-full ${fill} opacity-80 animate-pulse`} />
            ) : (
              <div
                className={`h-full rounded-full ${fill} transition-[width] duration-300 ease-out`}
                style={{ width: showCounts ? `${pct}%` : "0%" }}
              />
            )}
          </div>
          {!preparing && showCounts ? (
            <p className={`text-[11px] ${muted}`}>{pct}% concluído</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Barra indeterminada ao importar um único anúncio (MLB). */
export function SingleAnuncioImportBar() {
  return (
    <div className="mt-2 space-y-1.5" aria-busy="true" aria-label="Importando anúncio">
      <p className="text-xs text-slate-600">Importando anúncio…</p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="h-full w-full rounded-full bg-primary/75 animate-pulse" />
      </div>
    </div>
  );
}
