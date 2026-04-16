/**
 * Agenda trabalho pesado após o handler responder (próximo tick do event loop).
 * Em VPS com `next start`, o processo Node permanece ativo até o job concluir.
 */
export function runSyncInBackground(start: () => Promise<unknown>): void {
  setImmediate(() => {
    void start().catch((e) => {
      console.error("[sync] worker error:", e);
    });
  });
}
