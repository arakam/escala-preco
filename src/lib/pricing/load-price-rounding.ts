import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_PRICE_ROUNDING,
  normalizePriceRoundingConfig,
  PRICE_ROUNDING_PREFERENCE_KEY,
  type PriceRoundingConfig,
} from "@/lib/pricing/price-rounding";

/**
 * Carrega a preferência de arredondamento do Preço Final do usuário (server-side).
 * Em caso de erro/ausência, retorna o padrão (arredondamento desativado).
 */
export async function loadPriceRoundingForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<PriceRoundingConfig> {
  try {
    const { data, error } = await supabase
      .from("user_preferences")
      .select("value")
      .eq("user_id", userId)
      .eq("preference_key", PRICE_ROUNDING_PREFERENCE_KEY)
      .maybeSingle();
    if (error || !data?.value) return { ...DEFAULT_PRICE_ROUNDING };
    return normalizePriceRoundingConfig(data.value as Partial<PriceRoundingConfig>);
  } catch {
    return { ...DEFAULT_PRICE_ROUNDING };
  }
}
