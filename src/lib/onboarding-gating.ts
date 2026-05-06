export type OnboardingGateStatus = {
  ml_connected: boolean;
  listings_synced: boolean;
  products_imported: boolean;
};

/** Próxima rota a abrir quando preço/atacado (ou passo seguinte) ainda está bloqueado. */
export function navBlockedHref(status: OnboardingGateStatus | null): string {
  if (!status?.ml_connected) return "/app/configuracao";
  if (!status.listings_synced) return "/app/anuncios";
  if (!status.products_imported) return "/app/produtos";
  return "/app";
}

export function isPrecoAtacadoAllowed(status: OnboardingGateStatus | null, loading: boolean): boolean {
  if (loading || !status) return false;
  return status.ml_connected && status.listings_synced && status.products_imported;
}
