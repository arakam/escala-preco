import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchSaleFee } from "@/lib/mercadolivre/fees";

/**
 * Atualiza a referência de taxa ML (% sobre o preço) para o trio site+categoria+tipo de listagem,
 * usando listing_prices no preço de amostra (ex.: preço atual do anúncio na sync).
 */
export async function upsertCategoryFeeReferenceFromSample(params: {
  supabase: SupabaseClient;
  siteId: string;
  categoryId: string | null | undefined;
  listingTypeId: string | null | undefined;
  samplePrice: number;
  accessToken: string;
}): Promise<void> {
  const { supabase, siteId, accessToken } = params;
  const categoryId = params.categoryId?.trim();
  const listingTypeId = params.listingTypeId?.trim();
  const price = Math.round(Number(params.samplePrice) * 100) / 100;
  if (!categoryId || !listingTypeId || !Number.isFinite(price) || price <= 0) return;

  const feeRow = await fetchSaleFee(accessToken, siteId, listingTypeId, price, categoryId);
  if (!feeRow || !Number.isFinite(feeRow.fee)) return;

  const feePercent = (feeRow.fee / price) * 100;
  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 95) return;

  const { error } = await supabase.from("ml_category_fee_reference").upsert(
    {
      site_id: siteId,
      category_id: categoryId,
      listing_type_id: listingTypeId,
      fee_percent: Math.round(feePercent * 1_000_000) / 1_000_000,
      sample_price: price,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "site_id,category_id,listing_type_id" }
  );
  if (error) {
    console.warn("[ml_category_fee_reference] upsert:", error.message);
  }
}
