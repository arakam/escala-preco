/**
 * Seleção e leitura paginada de rascunhos de atacado (evita duplicatas e mesclas indevidas no apply).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** PostgREST/Supabase costuma limitar ~200–1000 linhas por request; buscamos em páginas. */
const WHOLESALE_DRAFTS_PAGE_SIZE = 1000;
const ML_ITEMS_IN_BATCH = 200;

export type WholesaleDraftRow = {
  variation_id: number | null;
  tiers_json: unknown;
  updated_at?: string;
};

export type WholesaleDraftRowWithItem = WholesaleDraftRow & { item_id: string };

/** Carrega todos os rascunhos da conta (sem truncar no limite padrão do Supabase). */
export async function fetchAllWholesaleDraftsForAccount(
  supabase: SupabaseClient,
  accountId: string
): Promise<WholesaleDraftRowWithItem[]> {
  const all: WholesaleDraftRowWithItem[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("wholesale_drafts")
      .select("item_id, variation_id, tiers_json, updated_at")
      .eq("account_id", accountId)
      .order("id", { ascending: true })
      .range(from, from + WHOLESALE_DRAFTS_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as WholesaleDraftRowWithItem[];
    all.push(...page);
    if (page.length < WHOLESALE_DRAFTS_PAGE_SIZE) break;
    from += WHOLESALE_DRAFTS_PAGE_SIZE;
  }
  return all;
}

export async function fetchHasVariationsByItemId(
  supabase: SupabaseClient,
  accountId: string,
  itemIds: string[]
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (itemIds.length === 0) return map;
  for (let i = 0; i < itemIds.length; i += ML_ITEMS_IN_BATCH) {
    const batch = itemIds.slice(i, i + ML_ITEMS_IN_BATCH);
    const { data, error } = await supabase
      .from("ml_items")
      .select("item_id, has_variations")
      .eq("account_id", accountId)
      .in("item_id", batch);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const r = row as { item_id: string; has_variations: boolean };
      map.set(r.item_id, r.has_variations === true);
    }
  }
  return map;
}

function draftRecency(d: WholesaleDraftRow): string {
  return d.updated_at ?? "";
}

function pickLatestDraft<T extends WholesaleDraftRow>(rows: T[]): T {
  return rows.reduce((best, cur) => (draftRecency(cur) > draftRecency(best) ? cur : best));
}

/**
 * Para item sem variações: um único rascunho (variation_id null) mais recente.
 * Com variações: o mais recente por variation_id (apply ainda agrupa por item na API ML).
 */
export function selectDraftRowsForItemApply(
  itemDrafts: WholesaleDraftRow[],
  hasVariations: boolean
): WholesaleDraftRow[] {
  if (itemDrafts.length === 0) return [];
  if (!hasVariations) {
    const itemLevel = itemDrafts.filter((d) => d.variation_id == null);
    if (itemLevel.length > 0) return [pickLatestDraft(itemLevel)];
    return [pickLatestDraft(itemDrafts)];
  }
  const byVariation = new Map<number, WholesaleDraftRow[]>();
  for (const d of itemDrafts) {
    if (d.variation_id == null) continue;
    const vid = Number(d.variation_id);
    const list = byVariation.get(vid) ?? [];
    list.push(d);
    byVariation.set(vid, list);
  }
  return Array.from(byVariation.values()).map(pickLatestDraft);
}

export function tiersFromDraftRows(draftRows: WholesaleDraftRow[]): { min_qty: number; price: number }[] {
  const allTiers: { min_qty: number; price: number }[] = [];
  const seenMinQty = new Set<number>();
  for (const d of draftRows) {
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
  return allTiers.sort((a, b) => a.min_qty - b.min_qty).slice(0, 5);
}
