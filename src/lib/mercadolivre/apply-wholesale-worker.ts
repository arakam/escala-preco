/**
 * Worker: aplicar preços de atacado (wholesale_drafts) no Mercado Livre.
 * Processa em fila com concorrência limitada, retry/backoff, e registra em ml_jobs/ml_job_logs.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { getValidAccessToken } from "./refresh";
import { updateJob, addJobLog, type JobStatus } from "@/lib/jobs";
import { runWithConcurrency } from "./client";
import { validateDraftForApply, updateWholesalePrices } from "./wholesale";

const JOB_TYPE = "apply_wholesale_prices" as const;
const CONCURRENCY = 3;

interface DraftRow {
  item_id: string;
  variation_id: number | null;
  tiers_json: unknown;
}

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

    const { data: draftsRows } = await supabase
      .from("wholesale_drafts")
      .select("item_id, variation_id, tiers_json")
      .eq("account_id", accountId)
      .order("item_id", { ascending: true })
      .order("variation_id", { ascending: true, nullsFirst: true });
    const drafts = (draftsRows ?? []) as DraftRow[];

    const { data: itemsRows } = await supabase
      .from("ml_items")
      .select("item_id, has_variations")
      .eq("account_id", accountId)
      .in("item_id", [...new Set(drafts.map((d) => d.item_id))]);
    const hasVariationsByItem = new Map<string, boolean>();
    for (const row of itemsRows ?? []) {
      const r = row as { item_id: string; has_variations: boolean };
      hasVariationsByItem.set(r.item_id, r.has_variations === true);
    }

    // API de preços por quantidade é por item. Agrupa por item_id e MESCLA todos os tiers
    // dos drafts desse item (para enviar todos os preços por quantidade, não só do primeiro draft).
    const draftsByItem = new Map<string, DraftRow[]>();
    for (const d of drafts) {
      const list = draftsByItem.get(d.item_id) ?? [];
      list.push(d);
      draftsByItem.set(d.item_id, list);
    }

    const toProcess: Array<{ item_id: string; variation_id: number | null; tiers: { min_qty: number; price: number }[]; hasVariations: boolean }> = [];
    for (const [itemId, itemDrafts] of draftsByItem) {
      const hasVariations = hasVariationsByItem.get(itemId) ?? false;
      const allTiers: { min_qty: number; price: number }[] = [];
      const seenMinQty = new Set<number>();
      for (const d of itemDrafts) {
        const tiersArr = Array.isArray(d.tiers_json) ? d.tiers_json : [];
        for (const t of tiersArr) {
          if (t && typeof t === "object" && "min_qty" in t && "price" in t) {
            const minQty = Number((t as { min_qty: number }).min_qty);
            const price = Number((t as { price: number }).price);
            if (Number.isInteger(minQty) && minQty >= 2 && price > 0 && !seenMinQty.has(minQty)) {
              seenMinQty.add(minQty);
              allTiers.push({ min_qty: minQty, price });
            }
          }
        }
      }
      const sorted = allTiers.sort((a, b) => a.min_qty - b.min_qty).slice(0, 5);
      if (sorted.length === 0) {
        await addJobLog(supabase, jobId, {
          item_id: itemId,
          status: "error",
          message: "Nenhum tier válido (min_qty >= 2, price > 0) nos drafts deste item",
        });
        continue;
      }
      const validated = validateDraftForApply(
        { item_id: itemId, variation_id: itemDrafts[0].variation_id, tiers: sorted },
        hasVariations
      );
      if (!validated.valid) {
        await addJobLog(supabase, jobId, {
          item_id: itemId,
          variation_id: itemDrafts[0].variation_id ?? undefined,
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
