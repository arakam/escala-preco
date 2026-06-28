import type { SupabaseClient } from "@supabase/supabase-js";

export type CalculatedPersistRow = {
  item_id: string;
  variation_id: number | null;
  price: number;
  fee: number;
  shipping_cost: number;
};

/** Linhas por chamada RPC (payload JSONB). Mantém a requisição enxuta. */
const RPC_CHUNK = 1000;
/** Fallback (sem RPC): UPDATEs individuais paralelizados por bloco. */
const FALLBACK_PARALLEL_CHUNK = 50;

/**
 * Grava calculated_* no pricing_cache.
 *
 * Caminho rápido: função RPC `bulk_update_pricing_calculated` (1 query por lote).
 * Fallback: se a função ainda não existir no banco (migration não aplicada),
 * cai para UPDATEs individuais para não quebrar o fluxo.
 */
export async function persistCalculatedPricingBatch(
  supabase: SupabaseClient,
  accountId: string,
  rows: CalculatedPersistRow[]
): Promise<void> {
  if (rows.length === 0) return;

  const now = new Date().toISOString();

  const usedFallback = await persistViaRpc(supabase, accountId, rows, now);
  if (!usedFallback) return;

  await persistViaPerRowUpdates(supabase, accountId, rows, now);
}

/**
 * Tenta o caminho rápido via RPC. Retorna `true` se precisar usar o fallback
 * (função ausente), `false` se a gravação via RPC concluiu.
 */
async function persistViaRpc(
  supabase: SupabaseClient,
  accountId: string,
  rows: CalculatedPersistRow[],
  calculatedAt: string
): Promise<boolean> {
  for (let i = 0; i < rows.length; i += RPC_CHUNK) {
    const chunk = rows.slice(i, i + RPC_CHUNK);
    const payload = chunk.map((item) => ({
      item_id: item.item_id,
      variation_id: item.variation_id ?? -1,
      calculated_price: item.price,
      calculated_fee: item.fee,
      calculated_shipping_cost: item.shipping_cost,
    }));

    const { error } = await supabase.rpc("bulk_update_pricing_calculated", {
      p_account_id: accountId,
      p_rows: payload,
      p_calculated_at: calculatedAt,
    });

    if (error) {
      // Função inexistente (migration pendente) ou assinatura divergente: usa fallback.
      if (isMissingFunctionError(error)) {
        return true;
      }
      throw error;
    }
  }
  return false;
}

function isMissingFunctionError(error: { code?: string; message?: string }): boolean {
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

async function persistViaPerRowUpdates(
  supabase: SupabaseClient,
  accountId: string,
  rows: CalculatedPersistRow[],
  calculatedAt: string
): Promise<void> {
  for (let i = 0; i < rows.length; i += FALLBACK_PARALLEL_CHUNK) {
    const chunk = rows.slice(i, i + FALLBACK_PARALLEL_CHUNK);
    await Promise.all(
      chunk.map((item) => {
        const variationId = item.variation_id ?? -1;
        return supabase
          .from("pricing_cache")
          .update({
            calculated_price: item.price,
            calculated_fee: item.fee,
            calculated_shipping_cost: item.shipping_cost,
            calculated_at: calculatedAt,
          })
          .eq("account_id", accountId)
          .eq("item_id", item.item_id)
          .eq("variation_id", variationId);
      })
    );
  }
}
