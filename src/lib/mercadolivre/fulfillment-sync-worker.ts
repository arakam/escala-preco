/**
 * Worker do job sync_fulfillment_stock (fase B — estoque Full).
 * Disparado automaticamente após sync_items (fase A).
 */
import type { MLVariationDetail } from "./client";
import { fetchItemDetail } from "./client";
import {
  fetchFulfillmentStockFields,
  FulfillmentStockCache,
  getFulfillmentStockTtlMs,
  persistVariationFulfillmentStocks,
} from "./fulfillment-stock";
import { getLatestValidAccessToken, getValidAccessToken } from "./refresh";
import { syncLog } from "./sync-log";
import { createServiceClient } from "@/lib/supabase/service";
import {
  addJobLog,
  getJobStatus,
  isActiveJobStatus,
  updateJob,
  type JobStatus,
} from "@/lib/jobs";

type FulfillmentJobMeta = {
  item_ids?: string[];
  trigger_sync_job_id?: string;
};

function readFulfillmentItemIds(meta: unknown): string[] {
  if (meta == null || typeof meta !== "object") return [];
  const ids = (meta as FulfillmentJobMeta).item_ids;
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => String(id).trim()).filter(Boolean);
}

export async function runFulfillmentSyncJob(jobId: string, accountId: string): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  try {
    syncLog(jobId, "job iniciado (sync_fulfillment_stock)", { accountId });

    const { data: jobRow } = await supabase
      .from("ml_jobs")
      .select("meta_json")
      .eq("id", jobId)
      .single();
    let itemIds = readFulfillmentItemIds(jobRow?.meta_json);

    if (itemIds.length === 0) {
      syncLog(jobId, "meta_json vazio; nada a processar");
      await updateJob(supabase, jobId, {
        status: "success",
        total: 0,
        processed: 0,
        ok: 0,
        errors: 0,
        ended_at: now,
        phase: null,
      });
      return;
    }

    itemIds = Array.from(new Set(itemIds));
    const total = itemIds.length;

    const { data: tokenData } = await supabase
      .from("ml_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("account_id", accountId)
      .single();
    const tokenRow = tokenData as {
      access_token: string;
      refresh_token: string;
      expires_at: string;
    } | null;
    if (!tokenRow) {
      await updateJob(supabase, jobId, { status: "failed", ended_at: now });
      await addJobLog(supabase, jobId, { status: "error", message: "Token não encontrado" });
      return;
    }

    const initialToken = await getValidAccessToken(
      accountId,
      tokenRow.access_token,
      tokenRow.refresh_token,
      tokenRow.expires_at,
      supabase
    );
    if (!initialToken) {
      await updateJob(supabase, jobId, { status: "failed", ended_at: now });
      await addJobLog(supabase, jobId, { status: "error", message: "Falha ao obter access token" });
      return;
    }

    let accessToken = initialToken;
    await updateJob(supabase, jobId, {
      total,
      status: "running",
      started_at: now,
      processed: 0,
      ok: 0,
      errors: 0,
      phase: "fulfillment",
    });

    syncLog(jobId, "fase B: estoque Full", {
      total,
      ttlMs: getFulfillmentStockTtlMs(),
    });

    let processed = 0;
    let ok = 0;
    let errors = 0;
    let lastJobStatusCheck = 0;
    let jobStillActive = true;
    let lastProactiveTokenCheck = Date.now();
    const fulfillmentStockCache = new FulfillmentStockCache();
    const progressHeartbeat = () => new Date().toISOString();

    const assertJobStillActive = async (): Promise<boolean> => {
      if (Date.now() - lastJobStatusCheck < 2000) return jobStillActive;
      lastJobStatusCheck = Date.now();
      const status = await getJobStatus(supabase, jobId);
      jobStillActive = status != null && isActiveJobStatus(status);
      if (!jobStillActive) {
        syncLog(jobId, "abortar: job cancelado ou finalizado no banco", { status });
      }
      return jobStillActive;
    };

    for (const itemId of itemIds) {
      if (!(await assertJobStillActive())) break;

      try {
        if (Date.now() - lastProactiveTokenCheck > 8 * 60 * 1000) {
          lastProactiveTokenCheck = Date.now();
          const t = await getLatestValidAccessToken(accountId, supabase);
          if (t) accessToken = t;
        }

        const item = await fetchItemDetail(itemId, accessToken, { includeAttributesAll: true });
        const variationDetails: MLVariationDetail[] = Array.isArray(item.variations)
          ? (item.variations as MLVariationDetail[])
          : [];

        const stockFields = await fetchFulfillmentStockFields(
          item,
          accessToken,
          variationDetails,
          fulfillmentStockCache
        );
        const nowIso = progressHeartbeat();
        const itemPatch: Record<string, unknown> = {
          is_fulfillment: stockFields.is_fulfillment,
          inventory_id: stockFields.inventory_id,
          fulfillment_stock: stockFields.fulfillment_stock,
          fulfillment_synced_at: nowIso,
        };
        if (stockFields.total_listing_stock != null) {
          itemPatch.available_quantity = stockFields.total_listing_stock;
        }
        const { error: updErr } = await (supabase as any)
          .from("ml_items")
          .update(itemPatch)
          .eq("account_id", accountId)
          .eq("item_id", itemId);
        if (updErr) throw updErr;

        await persistVariationFulfillmentStocks(
          supabase,
          accountId,
          itemId,
          stockFields.byInventory
        );

        processed++;
        ok++;
        await updateJob(supabase, jobId, {
          processed,
          ok,
          errors,
          started_at: progressHeartbeat(),
        });
        await addJobLog(supabase, jobId, { item_id: itemId, status: "ok" });
      } catch (e) {
        processed++;
        errors++;
        const message = e instanceof Error ? e.message : String(e);
        await updateJob(supabase, jobId, {
          processed,
          ok,
          errors,
          started_at: progressHeartbeat(),
        });
        await addJobLog(supabase, jobId, {
          item_id: itemId,
          status: "error",
          message,
        });
        syncLog(jobId, "fase B: falha estoque Full", { itemId, err: message });
      }
    }

    const currentStatus = await getJobStatus(supabase, jobId);
    if (!currentStatus || !isActiveJobStatus(currentStatus)) {
      syncLog(jobId, "encerrado sem sobrescrever status (cancelado)", { currentStatus, ok, errors, total });
      return;
    }

    const finalStatus: JobStatus =
      errors === 0 ? "success" : total === errors ? "failed" : "partial";
    await updateJob(supabase, jobId, {
      status: finalStatus,
      phase: null,
      ended_at: new Date().toISOString(),
    });
    syncLog(jobId, "fase B concluída", { finalStatus, ok, errors, total });
  } catch (e) {
    syncLog(jobId, "erro fatal fulfillment worker", {
      err: e instanceof Error ? e.message : String(e),
    });
    console.error(`[sync:${jobId}] fulfillment fatal`, e);
    await updateJob(supabase, jobId, {
      status: "failed",
      ended_at: new Date().toISOString(),
      phase: null,
    });
    await addJobLog(supabase, jobId, {
      status: "error",
      message: e instanceof Error ? e.message : "Erro inesperado",
    });
  }
}
