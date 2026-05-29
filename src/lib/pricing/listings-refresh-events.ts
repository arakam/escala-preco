/**
 * Sinaliza que a tabela de Preços deve recarregar após mudanças em Produtos (ou vínculo MLB↔SKU).
 * - sessionStorage: aba de Preços monta depois ou volta com visibilitychange
 * - CustomEvent: mesma aba com as duas rotas montadas (raro)
 * - BroadcastChannel: outra aba/janela com Preços aberta
 */
export const PRICING_LISTINGS_STALE_STORAGE_KEY = "escalapreco_pricing_listings_stale";

export const PRICING_LISTINGS_REFRESH_EVENT = "escalapreco-pricing-listings-refresh";

const BROADCAST_CHANNEL_NAME = "escalapreco-pricing-listings-refresh";

export type PricingListingsRefreshReason =
  | "products_saved"
  | "products_deleted"
  | "products_deleted_all"
  | "products_import"
  | "products_link"
  | "products_tags"
  | "listings_sync"
  | "listing_sync_single";

export type PricingListingsRefreshDetail = {
  reason?: PricingListingsRefreshReason | string;
};

export function notifyPricingListingsShouldRefresh(
  reason?: PricingListingsRefreshReason | string
): void {
  if (typeof window === "undefined") return;

  try {
    sessionStorage.setItem(PRICING_LISTINGS_STALE_STORAGE_KEY, reason ?? "1");
  } catch {
    // ignore (modo privado, quota, etc.)
  }

  try {
    window.dispatchEvent(
      new CustomEvent<PricingListingsRefreshDetail>(PRICING_LISTINGS_REFRESH_EVENT, {
        detail: { reason },
      })
    );
  } catch {
    // ignore
  }

  try {
    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      ch.postMessage({ reason } satisfies PricingListingsRefreshDetail);
      ch.close();
    }
  } catch {
    // ignore
  }
}

/** Lê e remove a flag de lista desatualizada (uso na montagem de Preços). */
export function consumePricingListingsStaleFlag(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    if (!sessionStorage.getItem(PRICING_LISTINGS_STALE_STORAGE_KEY)) return false;
    sessionStorage.removeItem(PRICING_LISTINGS_STALE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function peekPricingListingsStaleFlag(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return !!sessionStorage.getItem(PRICING_LISTINGS_STALE_STORAGE_KEY);
  } catch {
    return false;
  }
}

const REFRESH_DEBOUNCE_MS = 400;

/**
 * Inscreve recarregamento da lista de Preços (debounced).
 * Retorna função de cleanup.
 */
export function subscribePricingListingsRefresh(onRefresh: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  let debounce: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      onRefresh();
    }, REFRESH_DEBOUNCE_MS);
  };

  const onWindowEvent = () => schedule();
  window.addEventListener(PRICING_LISTINGS_REFRESH_EVENT, onWindowEvent);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    channel.addEventListener("message", onWindowEvent);
  }

  const onVis = () => {
    if (document.visibilityState !== "visible") return;
    if (!peekPricingListingsStaleFlag()) return;
    consumePricingListingsStaleFlag();
    schedule();
  };
  document.addEventListener("visibilitychange", onVis);

  return () => {
    if (debounce) clearTimeout(debounce);
    window.removeEventListener(PRICING_LISTINGS_REFRESH_EVENT, onWindowEvent);
    channel?.close();
    document.removeEventListener("visibilitychange", onVis);
  };
}
