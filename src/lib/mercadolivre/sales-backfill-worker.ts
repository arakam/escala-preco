/**
 * Worker da carga inicial de vendas (30 dias). Roda em background após POST /api/sales/backfill.
 */
import { addJobLog, updateJob } from "@/lib/jobs";
import { runSalesBackfillForAccount } from "@/lib/mercadolivre/orders-store";
import { createServiceClient } from "@/lib/supabase/service";

export async function runSalesBackfillJob(
  jobId: string,
  accountId: string,
  userId: string,
  mlUserId: number
): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  try {
    const result = await runSalesBackfillForAccount(supabase, accountId, userId, mlUserId, {
      skipShipmentEnrichment: true,
      onProgress: async (p) => {
        await updateJob(supabase, jobId, {
          total: p.total,
          processed: p.processed,
          ok: p.ordersUpserted,
        });
      },
    });

    await updateJob(supabase, jobId, {
      status: "success",
      total: result.ordersUpserted,
      processed: result.ordersUpserted,
      ok: result.ordersUpserted,
      ended_at: now,
    });
    await addJobLog(supabase, jobId, {
      status: "ok",
      message: `Carga concluída: ${result.ordersUpserted} pedido(s), ${result.itemsUpserted} linha(s).`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro na carga inicial";
    console.error(`[sales-backfill] job=${jobId}`, e);
    await updateJob(supabase, jobId, { status: "failed", ended_at: now });
    await addJobLog(supabase, jobId, { status: "error", message: msg.slice(0, 500) });
  }
}
