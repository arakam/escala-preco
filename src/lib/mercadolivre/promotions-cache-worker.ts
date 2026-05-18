/**
 * Worker de recarregamento do cache de promoções (tela Promoções).
 * Processa job refresh_promotions_cache em background.
 */
import { createServiceClient } from "@/lib/supabase/service";
import { addJobLog, updateJob, type JobStatus } from "@/lib/jobs";
import {
  countMlItemsForPromotionsPage,
  PROMOTIONS_OVERVIEW_PAGE_SIZE,
  refreshPromotionsCache,
  type PromotionsLinkFilter,
} from "@/lib/mercadolivre/promotions-cache";

export type RefreshPromotionsCacheJobParams = {
  userId: string;
  page: number;
  search: string;
  linkFilter: PromotionsLinkFilter;
  refreshScope: "page" | "all";
};

export async function runRefreshPromotionsCacheJob(
  jobId: string,
  accountId: string,
  params: RefreshPromotionsCacheJobParams
): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  try {
    await updateJob(supabase, jobId, { status: "running", started_at: now });

    const itemCount = await countMlItemsForPromotionsPage(
      supabase,
      accountId,
      params.search,
      params.linkFilter
    );
    const totalPages =
      params.refreshScope === "all"
        ? itemCount <= 0
          ? 0
          : Math.ceil(itemCount / PROMOTIONS_OVERVIEW_PAGE_SIZE)
        : 1;
    await updateJob(supabase, jobId, { total: totalPages });

    let lastProcessed = 0;
    let lastTotal = totalPages;

    await refreshPromotionsCache({
      supabase,
      accountId,
      userId: params.userId,
      page: params.page,
      search: params.search,
      linkFilter: params.linkFilter,
      refreshScope: params.refreshScope,
      onProgress: async (processed, totalPages) => {
        lastProcessed = processed;
        lastTotal = totalPages;
        await updateJob(supabase, jobId, {
          total: totalPages,
          processed,
          ok: processed,
        });
      },
    });

    const finalStatus: JobStatus = "success";
    await updateJob(supabase, jobId, {
      status: finalStatus,
      total: lastTotal || lastProcessed || 1,
      processed: lastTotal || lastProcessed || 1,
      ok: lastTotal || lastProcessed || 1,
      errors: 0,
      ended_at: new Date().toISOString(),
    });
    await addJobLog(supabase, jobId, {
      status: "ok",
      message: "Cache de promoções atualizado",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[refresh_promotions_cache]", e);
    await updateJob(supabase, jobId, {
      status: "failed",
      ended_at: new Date().toISOString(),
    });
    await addJobLog(supabase, jobId, { status: "error", message });
  }
}
