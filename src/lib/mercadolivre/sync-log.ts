/**
 * Logs de diagnóstico da sincronização ML (aparecem no stdout do Node: PM2, Docker, Vercel logs).
 *
 * Variáveis de ambiente:
 * - SYNC_LOG_VERBOSE=1 — loga início/fim de cada anúncio (e duração).
 * - SYNC_LOG_HEARTBEAT_MS=15000 — intervalo do heartbeat em ms (0 = desliga). Padrão: 15000.
 */

export function syncLogVerbose(): boolean {
  return process.env.SYNC_LOG_VERBOSE === "1" || process.env.SYNC_LOG_VERBOSE === "true";
}

export function syncHeartbeatMs(): number {
  const raw = process.env.SYNC_LOG_HEARTBEAT_MS;
  if (raw === "0" || raw === "false") return 0;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return n;
  return 15_000;
}

export function syncLog(jobId: string, message: string, meta?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  if (meta && Object.keys(meta).length > 0) {
    console.log(`[${ts}] [sync:${jobId}] ${message}`, meta);
  } else {
    console.log(`[${ts}] [sync:${jobId}] ${message}`);
  }
}
