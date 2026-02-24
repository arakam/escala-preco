/**
 * Worker de refresh de referências de preço (benchmarks ML).
 * Processa job refresh_price_references: scope all (todos itens da conta) ou item (um item_id).
 */
import { createServiceClient } from "@/lib/supabase/service";
import { getValidAccessToken } from "./refresh";
import { updateJob, addJobLog, type JobStatus } from "@/lib/jobs";
import {
  fetchItemPriceReferenceDetails,
  normalizeMLDetailsToSummary,
  type MLPriceReferenceDetails,
} from "./priceReferences";
import { runWithConcurrency } from "./client";

const CONCURRENCY = 3;

function parseLastUpdated(raw: string | undefined): string {
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

async function upsertPriceReference(
  supabase: ReturnType<typeof createServiceClient>,
  accountId: string,
  itemId: string,
  variationId: number | null,
  currentPriceSnapshot: number,
  details: MLPriceReferenceDetails | null,
  referenceJson: object
) {
  const updatedAt = new Date().toISOString();
  const base = {
    account_id: accountId,
    item_id: itemId,
    variation_id: variationId,
    current_price_snapshot: currentPriceSnapshot,
    reference_json: referenceJson,
    updated_at: updatedAt,
  };

  type PriceRefTable = { upsert: (v: Record<string, unknown>, o?: { onConflict?: string }) => Promise<{ error: unknown }> };
  if (!details) {
    await (supabase.from("price_references") as unknown as PriceRefTable).upsert(
      {
        ...base,
        reference_type: "none",
        suggested_price: null,
        min_reference_price: null,
        max_reference_price: null,
        status: "none",
        explanation: "Sem referência de preço disponível.",
      },
      { onConflict: "account_id,item_id,variation_key" }
    );
    return;
  }

  const summary = normalizeMLDetailsToSummary(details, currentPriceSnapshot);
  const lastUpdated = parseLastUpdated(details.last_updated);

  await (supabase.from("price_references") as unknown as PriceRefTable).upsert(
    {
      ...base,
      reference_type: summary.reference_type,
      suggested_price: summary.suggested_price,
      min_reference_price: summary.min_reference_price,
      max_reference_price: summary.max_reference_price,
      status: summary.status,
      explanation: summary.explanation,
      updated_at: lastUpdated,
    },
    { onConflict: "account_id,item_id,variation_key" }
  );
}

export async function runRefreshPriceReferencesJob(
  jobId: string,
  accountId: string,
  scope: "all" | "item",
  itemId?: string
): Promise<void> {
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

    type Row = { item_id: string; variation_id: number | null; current_price: number };
    let rows: Row[] = [];

    type ItemRow = { item_id: string; has_variations: boolean; price: number | null };
    type VarRow = { item_id: string; variation_id: number; price: number | null };

    if (scope === "item" && itemId) {
      const { data: item } = await supabase
        .from("ml_items")
        .select("item_id, has_variations, price")
        .eq("account_id", accountId)
        .eq("item_id", itemId)
        .single();
      const itemRow = item as ItemRow | null;
      if (!itemRow) {
        await updateJob(supabase, jobId, { status: "failed", ended_at: now });
        await addJobLog(supabase, jobId, { status: "error", message: "Item não encontrado", item_id: itemId });
        return;
      }
      if (itemRow.has_variations) {
        const { data: vars } = await supabase
          .from("ml_variations")
          .select("item_id, variation_id, price")
          .eq("account_id", accountId)
          .eq("item_id", itemId);
        rows = ((vars ?? []) as VarRow[]).map((v) => ({
          item_id: v.item_id,
          variation_id: v.variation_id,
          current_price: Number(v.price ?? 0),
        }));
      } else {
        rows = [{ item_id: itemId, variation_id: null, current_price: Number(itemRow.price ?? 0) }];
      }
    } else {
      const { data: items } = await supabase
        .from("ml_items")
        .select("item_id, has_variations, price")
        .eq("account_id", accountId);
      const itemsList = (items ?? []) as ItemRow[];
      for (const item of itemsList) {
        if (item.has_variations) {
          const { data: vars } = await supabase
            .from("ml_variations")
            .select("item_id, variation_id, price")
            .eq("account_id", accountId)
            .eq("item_id", item.item_id);
          for (const v of (vars ?? []) as VarRow[]) {
            rows.push({
              item_id: v.item_id,
              variation_id: v.variation_id,
              current_price: Number(v.price ?? 0),
            });
          }
        } else {
          rows.push({
            item_id: item.item_id,
            variation_id: null,
            current_price: Number(item.price ?? 0),
          });
        }
      }
    }

    const itemIdsToFetch = Array.from(new Set(rows.map((r) => r.item_id)));
    const total = itemIdsToFetch.length;
    await updateJob(supabase, jobId, { total, status: "running", started_at: now });

    let processed = 0;
    let ok = 0;
    let errors = 0;

    await runWithConcurrency(itemIdsToFetch, CONCURRENCY, async (id) => {
      try {
        const details = await fetchItemPriceReferenceDetails(id, accessToken);
        const refJson = details ? (details as unknown as object) : {};
        const rowsForItem = rows.filter((r) => r.item_id === id);
        for (const row of rowsForItem) {
          await upsertPriceReference(
            supabase,
            accountId,
            row.item_id,
            row.variation_id,
            row.current_price,
            details,
            refJson
          );
        }
        processed++;
        ok++;
        await updateJob(supabase, jobId, { processed, ok, errors });
        await addJobLog(supabase, jobId, { item_id: id, status: "ok" });
      } catch (e) {
        processed++;
        errors++;
        const message = e instanceof Error ? e.message : String(e);
        await updateJob(supabase, jobId, { processed, ok, errors });
        await addJobLog(supabase, jobId, {
          item_id: id,
          status: "error",
          message,
          response_json: e instanceof Error ? { name: e.name } : undefined,
        });
      }
    });

    const finalStatus: JobStatus = errors === 0 ? "success" : total === errors ? "failed" : "partial";
    await updateJob(supabase, jobId, {
      status: finalStatus,
      ended_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[refresh_price_references]", e);
    await updateJob(supabase, jobId, {
      status: "failed",
      ended_at: now,
    });
    await addJobLog(supabase, jobId, {
      status: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
