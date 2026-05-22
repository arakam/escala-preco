/**
 * Inicia trabalho pesado sem bloquear a resposta HTTP.
 * Em `next dev` / `next start` o processo Node segue vivo até o job terminar.
 *
 * Não usar setImmediate: no App Router o callback pode não rodar antes do handler encerrar.
 */
export function runSyncInBackground(start: () => Promise<unknown>): void {
  void start().catch((e) => {
    console.error("[sync] worker error:", e);
  });
}
