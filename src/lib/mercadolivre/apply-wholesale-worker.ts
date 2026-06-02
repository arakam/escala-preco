/**
 * Worker: aplicar preços de atacado (wholesale_drafts) no Mercado Livre.
 * Processa em fila com concorrência limitada, retry/backoff, e registra em ml_jobs/ml_job_logs.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { getValidAccessToken } from "./refresh";
import { updateJob, addJobLog, type JobStatus } from "@/lib/jobs";
import { runWithConcurrency } from "./client";
import {
  fetchAllWholesaleDraftsForAccount,
  fetchHasVariationsByItemId,
  selectDraftRowsForItemApply,
  tiersFromDraftRows,
} from "@/lib/atacado-drafts";
import { validateDraftForApply, updateWholesalePrices } from "./wholesale";

const JOB_TYPE = "apply_wholesale_prices" as const;
const CONCURRENCY = 3;

export async function runApplyWholesaleJob(jobId: string, accountId: string): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  try {
    const { data: accountData } = await supabase
      .from("ml_accounts")
      .select("ml_user_id")
      .eq("id", accountId)
      .single();
    const account = accountData as { ml_user_id: number } | null;
    if (!account) {
      await updateJob(supabase, jobId, { status: "failed", ended_at: now });
      await addJobLog(supabase, jobId, { status: "error", message: "Conta não encontrada" });
      return;
    }

    const { data: tokenData } = await supabase
      .from("ml_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("account_id", accountId)
      .single();
    const tokenRow = tokenData as { access_token: string; refresh_token: string; expires_at: string } | null;
    if (!tokenRow) {
      await updateJob(supabase, jobId, { status: "failed", ended_at: now });
      await addJobLog(supabase, jobId, { status: "error", message: "Token não encontrado" });
      return;
    }

    const accessToken = await getValidAccessToken(
      accountId,
      tokenRow.access_token,
      tokenRow.refresh_token,
      tokenRow.expires_at,
      supabase
    );
    if (!accessToken) {
      await updateJob(supabase, jobId, { status: "failed", ended_at: now });
      await addJobLog(supabase, jobId, { status: "error", message: "Falha ao obter access token" });
      return;
    }

    const drafts = await fetchAllWholesaleDraftsForAccount(supabase, accountId);
    const uniqueItemIds = Array.from(new Set(drafts.map((d) => d.item_id)));
    const hasVariationsByItem = await fetchHasVariationsByItemId(supabase, accountId, uniqueItemIds);

    // API de preços por quantidade é por item. Agrupa por item_id e usa o rascunho mais recente
    // por variation_id (evita mesclar rascunhos duplicados com variation_id NULL).
    const draftsByItem = new Map<string, typeof drafts>();
    for (const d of drafts) {
      const list = draftsByItem.get(d.item_id) ?? [];
      list.push(d);
      draftsByItem.set(d.item_id, list);
    }

    const toProcess: Array<{ item_id: string; variation_id: number | null; tiers: { min_qty: number; price: number }[]; hasVariations: boolean }> = [];
    const entries = Array.from(draftsByItem.entries());
    for (let e = 0; e < entries.length; e++) {
      const itemId = entries[e][0];
      const itemDrafts = entries[e][1];
      const hasVariations = hasVariationsByItem.get(itemId) ?? false;
      const selectedDrafts = selectDraftRowsForItemApply(itemDrafts, hasVariations);
      const sorted = tiersFromDraftRows(selectedDrafts);
      if (sorted.length === 0) {
        await addJobLog(supabase, jobId, {
          item_id: itemId,
          status: "error",
          message: "Nenhum tier válido (min_qty >= 2, price > 0) nos drafts deste item",
        });
        continue;
      }
      const validated = validateDraftForApply(
        { item_id: itemId, variation_id: selectedDrafts[0]?.variation_id ?? null, tiers: sorted },
        hasVariations
      );
      if (!validated.valid) {
        await addJobLog(supabase, jobId, {
          item_id: itemId,
          variation_id: selectedDrafts[0]?.variation_id ?? undefined,
          status: "error",
          message: validated.reason,
        });
        continue;
      }
      toProcess.push({
        item_id: itemId,
        variation_id: validated.draft.variation_id,
        tiers: validated.draft.tiers,
        hasVariations,
      });
    }

    const total = toProcess.length;
    await updateJob(supabase, jobId, {
      total,
      status: "running",
      started_at: now,
    });

    if (total === 0) {
      await updateJob(supabase, jobId, { status: "success", ended_at: new Date().toISOString() });
      return;
    }

    let processed = 0;
    let ok = 0;
    let errors = 0;

    await runWithConcurrency(toProcess, CONCURRENCY, async (entry) => {
      const result = await updateWholesalePrices(
        entry.item_id,
        entry.variation_id,
        entry.tiers,
        accessToken,
        entry.hasVariations
      );
      processed++;
      if (result.ok) {
        ok++;
        await updateJob(supabase, jobId, { processed, ok, errors });
        await addJobLog(supabase, jobId, {
          item_id: entry.item_id,
          variation_id: entry.variation_id ?? undefined,
          status: "ok",
        });
      } else {
        errors++;
        const message = result.message ?? `HTTP ${result.status}`;
        await updateJob(supabase, jobId, { processed, ok, errors });
        await addJobLog(supabase, jobId, {
          item_id: entry.item_id,
          variation_id: entry.variation_id ?? undefined,
          status: "error",
          message,
          response_json: result.responseJson ?? { status: result.status, body: result.responseBody },
        });
        console.warn(`[apply-wholesale ${jobId}] ${entry.item_id}${entry.variation_id != null ? ` var ${entry.variation_id}` : ""}: ${message}`);
      }
    });

    const finalStatus: JobStatus = errors === 0 ? "success" : total === errors ? "failed" : "partial";
    await updateJob(supabase, jobId, {
      status: finalStatus,
      ended_at: new Date().toISOString(),
    });
    console.log(`[apply-wholesale ${jobId}] finished: ${finalStatus}, ok=${ok}, errors=${errors}`);
  } catch (e) {
    console.error("[apply-wholesale]", e);
    await updateJob(supabase, jobId, {
      status: "failed",
      ended_at: new Date().toISOString(),
    });
    await addJobLog(supabase, jobId, {
      status: "error",
      message: e instanceof Error ? e.message : "Erro inesperado",
      response_json: e instanceof Error ? { name: e.name } : undefined,
    });
  }
}
