/** Preferência manual (contas sem badge Gold/Platinum) para incluir frete ML nos cálculos de Preços. */
export const PRICING_CALCULAR_FRETE_STORAGE_KEY = "escalapreco_pricing_calcular_frete";

export const PRICING_FRETE_PREFERENCE_EVENT = "escalapreco-pricing-freight-preference";

/** Gold/Platinum: mesma regra usada na tela de Preços e em integrações ML. */
export function isMercadoLiderPowerSeller(status: string | null | undefined): boolean {
  const p = (status ?? "").toLowerCase();
  return p === "gold" || p === "platinum";
}

export function readCalcularFretePreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(PRICING_CALCULAR_FRETE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeCalcularFretePreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) localStorage.setItem(PRICING_CALCULAR_FRETE_STORAGE_KEY, "1");
    else localStorage.removeItem(PRICING_CALCULAR_FRETE_STORAGE_KEY);
    window.dispatchEvent(new Event(PRICING_FRETE_PREFERENCE_EVENT));
  } catch {
    // ignore
  }
}

/** Conta Líder (API) sempre inclui frete; demais contas seguem preferência salva. */
export function effectiveCalcularFreteMl(
  detectedMercadoLider: boolean,
  manualPreference = readCalcularFretePreference()
): boolean {
  if (detectedMercadoLider) return true;
  return manualPreference;
}
