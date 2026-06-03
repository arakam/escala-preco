/** Chave em `user_preferences` para arredondamento do Preço Final. */
export const PRICE_ROUNDING_PREFERENCE_KEY = "pricing_price_rounding";

/** localStorage legado (migrado para o banco na primeira carga). */
export const PRICING_PRICE_ROUNDING_STORAGE_KEY = "escalapreco_pricing_price_rounding";

export const PRICING_ROUNDING_PREFERENCE_EVENT = "escalapreco-pricing-rounding-preference";

export type PriceRoundingConfig = {
  enabled: boolean;
  /** Centavos finais desejados (0–99). Ex.: 90 → preço termina em ,90 */
  targetCents: number;
};

export const DEFAULT_PRICE_ROUNDING: PriceRoundingConfig = {
  enabled: false,
  targetCents: 90,
};

export function clampTargetCents(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PRICE_ROUNDING.targetCents;
  return Math.min(99, Math.max(0, Math.round(value)));
}

export function normalizePriceRoundingConfig(
  raw: Partial<PriceRoundingConfig> | null | undefined
): PriceRoundingConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PRICE_ROUNDING };
  return {
    enabled: Boolean(raw.enabled),
    targetCents: clampTargetCents(raw.targetCents ?? DEFAULT_PRICE_ROUNDING.targetCents),
  };
}

function parseLocalStorageRounding(raw: string | null): PriceRoundingConfig | null {
  if (!raw) return null;
  try {
    return normalizePriceRoundingConfig(JSON.parse(raw) as Partial<PriceRoundingConfig>);
  } catch {
    return null;
  }
}

function readLegacyLocalStorageRounding(): PriceRoundingConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = parseLocalStorageRounding(localStorage.getItem(PRICING_PRICE_ROUNDING_STORAGE_KEY));
    if (!parsed) return null;
    const d = DEFAULT_PRICE_ROUNDING;
    if (parsed.enabled === d.enabled && parsed.targetCents === d.targetCents) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearLegacyLocalStorageRounding(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(PRICING_PRICE_ROUNDING_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function dispatchRoundingPreferenceEvent(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PRICING_ROUNDING_PREFERENCE_EVENT));
}

/** Síncrono — padrão local até a API responder (evita flash incorreto breve). */
export function readPriceRoundingPreference(): PriceRoundingConfig {
  return readLegacyLocalStorageRounding() ?? { ...DEFAULT_PRICE_ROUNDING };
}

export async function loadPriceRoundingPreference(): Promise<PriceRoundingConfig> {
  if (typeof window === "undefined") return { ...DEFAULT_PRICE_ROUNDING };

  try {
    const res = await fetch("/api/pricing/price-rounding");
    if (res.ok) {
      const data = (await res.json()) as { config?: Partial<PriceRoundingConfig> };
      let config = normalizePriceRoundingConfig(data.config);

      const legacy = readLegacyLocalStorageRounding();
      const isServerDefault =
        !config.enabled && config.targetCents === DEFAULT_PRICE_ROUNDING.targetCents;

      if (legacy && isServerDefault) {
        const saved = await savePriceRoundingPreference(legacy);
        if (saved) config = saved;
      } else {
        clearLegacyLocalStorageRounding();
      }

      return config;
    }
  } catch {
    // rede / offline
  }

  return readLegacyLocalStorageRounding() ?? { ...DEFAULT_PRICE_ROUNDING };
}

export async function savePriceRoundingPreference(
  config: PriceRoundingConfig
): Promise<PriceRoundingConfig | null> {
  const normalized = normalizePriceRoundingConfig(config);
  if (typeof window === "undefined") return normalized;

  try {
    const res = await fetch("/api/pricing/price-rounding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalized),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { config?: Partial<PriceRoundingConfig> };
    const saved = normalizePriceRoundingConfig(data.config ?? normalized);
    clearLegacyLocalStorageRounding();
    dispatchRoundingPreferenceEvent();
    return saved;
  } catch {
    return null;
  }
}

/** @deprecated Use savePriceRoundingPreference — mantido para chamadas legadas. */
export function writePriceRoundingPreference(config: PriceRoundingConfig): void {
  void savePriceRoundingPreference(config);
}

/**
 * Mantém os reais e substitui só os centavos por `targetCents`.
 * Ex.: 88,93 com target 90 → 88,90; 102,53 → 102,90 (nunca vira 89,90 ou 103,90).
 */
export function applyPriceRounding(price: number, config: PriceRoundingConfig): number {
  if (!config.enabled || !Number.isFinite(price) || price <= 0) {
    return Math.round(price * 100) / 100;
  }
  const target = clampTargetCents(config.targetCents);
  const totalCents = Math.round(price * 100);
  const dollars = Math.floor(totalCents / 100);
  return (dollars * 100 + target) / 100;
}

export function formatTargetCentsLabel(targetCents: number): string {
  return `,${String(clampTargetCents(targetCents)).padStart(2, "0")}`;
}
