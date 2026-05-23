import { createClient } from "@/lib/supabase/server";
import { parseTiers, tiersFromMlWholesaleJson, validateDraftRow, type Tier } from "@/lib/atacado";
import { NextResponse } from "next/server";

export const maxDuration = 120;

const UPSERT_CHUNK = 200;

function draftKey(itemId: string, variationId: number | null): string {
  return `${String(itemId).trim().toUpperCase()}:${variationId ?? "item"}`;
}

function draftRowHasContent(tiers_json: unknown): boolean {
  const t = parseTiers(tiers_json);
  return t != null && t.length > 0;
}

type SeedMode = "fill_empty" | "overwrite";

/**
 * POST /api/atacado/seed-from-sync
 * Body: { accountId: string, mode?: "fill_empty" | "overwrite" }
 * Copia faixas de `ml_items.wholesale_prices_json` (dados do Mercado Livre) para `wholesale_drafts`.
 * Em anúncios com variações, replica as mesmas faixas do item para cada variação (como no ML por listing).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: { accountId?: string; mode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }

  const accountId = body.accountId?.trim();
  if (!accountId) {
    return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });
  }

  const mode: SeedMode = body.mode === "overwrite" ? "overwrite" : "fill_empty";

  const { data: account } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  type ItemRow = {
    item_id: string;
    has_variations: boolean;
    wholesale_prices_json: unknown;
  };

  const batchSize = 1000;
  let offset = 0;
  let allItems: ItemRow[] = [];
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from("ml_items")
      .select("item_id, has_variations, wholesale_prices_json")
      .eq("account_id", accountId)
      .order("updated_at", { ascending: false })
      .range(offset, offset + batchSize - 1);
    if (error) {
      console.error("[atacado/seed-from-sync] items:", error);
      return NextResponse.json({ error: "Erro ao listar itens" }, { status: 500 });
    }
    const batch = (data ?? []) as ItemRow[];
    allItems = [...allItems, ...batch];
    hasMore = batch.length === batchSize;
    offset += batchSize;
  }

  const itemsWithTiers: Array<{ item_id: string; has_variations: boolean; tiers: Tier[] }> = [];
  for (const row of allItems) {
    const tiers = tiersFromMlWholesaleJson(row.wholesale_prices_json);
    if (tiers && tiers.length > 0) {
      itemsWithTiers.push({
        item_id: String(row.item_id).trim(),
        has_variations: !!row.has_variations,
        tiers,
      });
    }
  }

  if (itemsWithTiers.length === 0) {
    return NextResponse.json({
      ok: true,
      seeded_count: 0,
      skipped_no_ml_data: allItems.length,
      skipped_has_draft: 0,
      skipped_invalid: 0,
      message:
        "Nenhum item com preço de atacado no Mercado Livre.",
    });
  }

  const itemIdsUpper = Array.from(new Set(itemsWithTiers.map((i) => i.item_id.toUpperCase())));

  async function fetchInBatches<T>(ids: string[], size: number, fetcher: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += size) {
      chunks.push(ids.slice(i, i + size));
    }
    const parts = await Promise.all(chunks.map(fetcher));
    return parts.flat();
  }

  const [variationRows, draftRows] = await Promise.all([
    fetchInBatches(itemIdsUpper, 100, async (chunk) => {
      const { data } = await supabase
        .from("ml_variations")
        .select("item_id, variation_id")
        .eq("account_id", accountId)
        .in(
          "item_id",
          chunk.map((id) => id)
        );
      return (data ?? []) as { item_id: string; variation_id: number }[];
    }),
    fetchInBatches(itemIdsUpper, 100, async (chunk) => {
      const { data } = await supabase
        .from("wholesale_drafts")
        .select("item_id, variation_id, tiers_json")
        .eq("account_id", accountId)
        .in(
          "item_id",
          chunk.map((id) => id)
        );
      return (data ?? []) as { item_id: string; variation_id: number | null; tiers_json: unknown }[];
    }),
  ]);

  const variationsByItem = new Map<string, number[]>();
  const variationSets = new Map<string, Set<number>>();
  for (const v of variationRows) {
    const iid = String(v.item_id).trim().toUpperCase();
    const vid = Number(v.variation_id);
    if (!Number.isFinite(vid)) continue;
    let set = variationSets.get(iid);
    if (!set) {
      set = new Set();
      variationSets.set(iid, set);
    }
    set.add(vid);
  }
  for (const [iid, set] of Array.from(variationSets.entries())) {
    variationsByItem.set(iid, Array.from(set).sort((a, b) => a - b));
  }

  const draftContentByKey = new Map<string, boolean>();
  for (const d of draftRows) {
    const iid = String(d.item_id).trim().toUpperCase();
    const vid = d.variation_id != null ? Number(d.variation_id) : null;
    draftContentByKey.set(draftKey(iid, vid), draftRowHasContent(d.tiers_json));
  }

  const toUpsert: Array<{ item_id: string; variation_id: number | null; tiers: Tier[] }> = [];
  let skipped_has_draft = 0;
  let skipped_invalid = 0;

  for (const item of itemsWithTiers) {
    const iidUpper = item.item_id.toUpperCase();
    const vids = variationsByItem.get(iidUpper) ?? [];
    const targets: Array<{ variation_id: number | null }> =
      item.has_variations && vids.length > 0 ? vids.map((id) => ({ variation_id: id })) : [{ variation_id: null }];

    const rowErrors = validateDraftRow({
      item_id: item.item_id,
      variation_id: targets[0]?.variation_id ?? null,
      tiers: item.tiers,
    });
    if (rowErrors.length > 0) {
      skipped_invalid += targets.length;
      continue;
    }

    for (const t of targets) {
      const key = draftKey(item.item_id, t.variation_id);
      const hasProtectedDraft = mode === "fill_empty" && draftContentByKey.get(key) === true;
      if (hasProtectedDraft) {
        skipped_has_draft++;
        continue;
      }
      toUpsert.push({
        item_id: String(item.item_id).trim().toUpperCase(),
        variation_id: t.variation_id,
        tiers: item.tiers,
      });
    }
  }

  if (toUpsert.length === 0) {
    return NextResponse.json({
      ok: true,
      seeded_count: 0,
      skipped_no_ml_data: allItems.length - itemsWithTiers.length,
      skipped_has_draft,
      skipped_invalid,
      message:
        mode === "fill_empty"
          ? "Todas as linhas relevantes já tinham rascunho com faixas. Use «Importar do ML» se quiser substituir pelo que está no Mercado Livre."
          : "Nenhuma faixa sincronizada passou na validação ou não havia linhas a gravar.",
    });
  }

  const now = new Date().toISOString();
  let seeded_count = 0;
  for (let i = 0; i < toUpsert.length; i += UPSERT_CHUNK) {
    const chunk = toUpsert.slice(i, i + UPSERT_CHUNK);
    const payload = chunk.map((row) => ({
      account_id: accountId,
      item_id: row.item_id,
      variation_id: row.variation_id,
      tiers_json: row.tiers,
      source: "import" as const,
      updated_at: now,
    }));

    const { error: chunkError } = await supabase.from("wholesale_drafts").upsert(payload, {
      onConflict: "account_id,item_id,variation_id",
    });

    if (!chunkError) {
      seeded_count += chunk.length;
      continue;
    }

    for (const row of chunk) {
      const { error } = await supabase.from("wholesale_drafts").upsert(
        {
          account_id: accountId,
          item_id: row.item_id,
          variation_id: row.variation_id,
          tiers_json: row.tiers,
          source: "import",
          updated_at: now,
        },
        { onConflict: "account_id,item_id,variation_id" }
      );
      if (!error) seeded_count++;
    }
  }

  return NextResponse.json({
    ok: true,
    seeded_count,
    skipped_no_ml_data: allItems.length - itemsWithTiers.length,
    skipped_has_draft,
    skipped_invalid,
    mode,
  });
}
