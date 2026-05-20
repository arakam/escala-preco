import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductTag } from "@/lib/db/types";

export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Separa nomes de tags em célula CSV (vírgula, pipe ou ponto-e-vírgula). */
export function parseTagNamesFromCell(cell: string | null | undefined): string[] {
  if (!cell?.trim()) return [];
  const parts = cell.split(/[;,|]/).map((p) => normalizeTagName(p)).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/** Usa vírgula na exportação para não conflitar com o separador `;` do CSV brasileiro. */
export function formatTagsForCsv(tags: { name: string }[]): string {
  return tags.map((t) => t.name).join(", ");
}

/**
 * Lê a coluna Tags mesmo quando o CSV usa `;` e a célula tinha tags com `;` sem aspas
 * (vira colunas extras após a última coluna reconhecida).
 */
export function readTagsCellFromCsvRow(
  values: string[],
  tagsColumnIndex: number,
  maxKnownColumnIndex: number,
  csvSeparator: string
): string {
  if (tagsColumnIndex < 0) return "";
  const spillover =
    tagsColumnIndex === maxKnownColumnIndex && values.length > maxKnownColumnIndex + 1;
  if (spillover) {
    return values
      .slice(tagsColumnIndex)
      .map((v) => v.trim())
      .filter(Boolean)
      .join(csvSeparator === ";" ? ";" : ",");
  }
  return values[tagsColumnIndex]?.trim() ?? "";
}

type TagRow = { id: string; name: string; user_id: string };

/** Cria tags inexistentes e retorna mapa nome (lower) → id. */
export async function getOrCreateTagsByNames(
  supabase: SupabaseClient,
  userId: string,
  names: string[]
): Promise<Map<string, TagRow>> {
  const normalized = Array.from(new Set(names.map(normalizeTagName).filter(Boolean)));
  const map = new Map<string, TagRow>();
  if (normalized.length === 0) return map;

  const { data: existing, error: fetchErr } = await supabase
    .from("product_tags")
    .select("id, name, user_id")
    .eq("user_id", userId);

  if (fetchErr) throw fetchErr;

  for (const row of (existing ?? []) as TagRow[]) {
    map.set(row.name.toLowerCase(), row);
  }

  const toCreate: { user_id: string; name: string }[] = [];
  for (const name of normalized) {
    if (!map.has(name.toLowerCase())) {
      toCreate.push({ user_id: userId, name });
    }
  }

  if (toCreate.length > 0) {
    const { data: created, error: createErr } = await supabase
      .from("product_tags")
      .insert(toCreate)
      .select("id, name, user_id");

    if (createErr) throw createErr;
    for (const row of (created ?? []) as TagRow[]) {
      map.set(row.name.toLowerCase(), row);
    }
  }

  return map;
}

/**
 * MLB da conta cujo produto vinculado (item ou variação) tem alguma das tags.
 * Retorna `null` se tagIds vazio (sem filtro); `[]` se nenhum anúncio bate.
 */
export async function resolveMlItemIdsByProductTagIds(
  supabase: SupabaseClient,
  accountId: string,
  tagIds: string[]
): Promise<string[] | null> {
  if (tagIds.length === 0) return null;

  const productIds = await resolveProductIdsByTagIds(supabase, tagIds);
  if (productIds.length === 0) return [];

  const itemIds = new Set<string>();
  const batchSize = 200;

  for (let i = 0; i < productIds.length; i += batchSize) {
    const batch = productIds.slice(i, i + batchSize);
    const [{ data: items }, { data: vars }] = await Promise.all([
      supabase
        .from("ml_items")
        .select("item_id")
        .eq("account_id", accountId)
        .in("product_id", batch),
      supabase
        .from("ml_variations")
        .select("item_id")
        .eq("account_id", accountId)
        .in("product_id", batch),
    ]);
    for (const r of items ?? []) {
      if (r.item_id) itemIds.add(String(r.item_id).trim().toUpperCase());
    }
    for (const r of vars ?? []) {
      if (r.item_id) itemIds.add(String(r.item_id).trim().toUpperCase());
    }
  }

  return Array.from(itemIds);
}

/** IDs de produtos que possuem pelo menos uma das tags informadas. */
export async function resolveProductIdsByTagIds(
  supabase: SupabaseClient,
  tagIds: string[]
): Promise<string[]> {
  if (tagIds.length === 0) return [];

  const { data, error } = await supabase
    .from("product_tag_assignments")
    .select("product_id")
    .in("tag_id", tagIds);

  if (error) throw error;

  const ids = new Set<string>();
  for (const row of data ?? []) {
    if (row.product_id) ids.add(String(row.product_id));
  }
  return Array.from(ids);
}

/** Substitui todas as tags de um produto pelos nomes informados (cria tags se necessário). */
export async function setProductTagsByNames(
  supabase: SupabaseClient,
  userId: string,
  productId: string,
  tagNames: string[]
): Promise<void> {
  const uniqueNames = Array.from(new Set(tagNames.map(normalizeTagName).filter(Boolean)));
  const tagMap = await getOrCreateTagsByNames(supabase, userId, uniqueNames);
  const tagIds = uniqueNames
    .map((n) => tagMap.get(n.toLowerCase())?.id)
    .filter((id): id is string => !!id);

  const { error: delErr } = await supabase
    .from("product_tag_assignments")
    .delete()
    .eq("product_id", productId);

  if (delErr) throw delErr;

  if (tagIds.length === 0) return;

  const { error: insErr } = await supabase.from("product_tag_assignments").insert(
    tagIds.map((tag_id) => ({ product_id: productId, tag_id }))
  );

  if (insErr) throw insErr;
}

const TAG_ASSIGNMENT_PRODUCT_BATCH = 150;

export async function fetchTagsGroupedByProductId(
  supabase: SupabaseClient,
  productIds: string[]
): Promise<Map<string, ProductTag[]>> {
  const result = new Map<string, ProductTag[]>();
  if (productIds.length === 0) return result;

  for (let i = 0; i < productIds.length; i += TAG_ASSIGNMENT_PRODUCT_BATCH) {
    const batch = productIds.slice(i, i + TAG_ASSIGNMENT_PRODUCT_BATCH);
    const { data, error } = await supabase
      .from("product_tag_assignments")
      .select("product_id, product_tags ( id, name, user_id, created_at )")
      .in("product_id", batch);

    if (error) throw error;

    for (const row of data ?? []) {
      const pid = String(row.product_id);
      const tag = row.product_tags as ProductTag | ProductTag[] | null;
      const tagObj = Array.isArray(tag) ? tag[0] : tag;
      if (!tagObj?.id) continue;
      const list = result.get(pid) ?? [];
      list.push({
        id: tagObj.id,
        name: tagObj.name,
        user_id: tagObj.user_id,
        created_at: tagObj.created_at,
      });
      list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      result.set(pid, list);
    }
  }

  return result;
}

/** Carrega todas as tags de produtos do usuário (eficiente para export em massa). */
export async function fetchAllTagsGroupedByProductIdForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<Map<string, ProductTag[]>> {
  const result = new Map<string, ProductTag[]>();

  const { data: userTags, error: tagsErr } = await supabase
    .from("product_tags")
    .select("id, name, user_id, created_at")
    .eq("user_id", userId);

  if (tagsErr) throw tagsErr;
  const tagList = (userTags ?? []) as ProductTag[];
  if (tagList.length === 0) return result;

  const tagById = new Map(tagList.map((t) => [t.id, t]));
  const tagIds = tagList.map((t) => t.id);

  for (let i = 0; i < tagIds.length; i += TAG_ASSIGNMENT_PRODUCT_BATCH) {
    const batch = tagIds.slice(i, i + TAG_ASSIGNMENT_PRODUCT_BATCH);
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("product_tag_assignments")
        .select("product_id, tag_id")
        .in("tag_id", batch)
        .range(offset, offset + pageSize - 1);

      if (error) throw error;

      const rows = data ?? [];
      for (const row of rows) {
        const pid = String(row.product_id);
        const tag = tagById.get(String(row.tag_id));
        if (!tag) continue;
        const list = result.get(pid) ?? [];
        if (!list.some((t) => t.id === tag.id)) {
          list.push(tag);
          list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
          result.set(pid, list);
        }
      }
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
  }

  return result;
}

const SKU_LOOKUP_BATCH = 200;
const ASSIGNMENT_DELETE_BATCH = 150;
const ASSIGNMENT_INSERT_BATCH = 500;

/** Mapa sku (lower) → product id, em lotes (evita `.in()` gigante no Supabase). */
export async function lookupProductIdsBySkus(
  supabase: SupabaseClient,
  userId: string,
  skus: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(skus.map((s) => s.trim()).filter(Boolean)));
  for (let i = 0; i < unique.length; i += SKU_LOOKUP_BATCH) {
    const batch = unique.slice(i, i + SKU_LOOKUP_BATCH);
    const { data, error } = await supabase
      .from("products")
      .select("id, sku")
      .eq("user_id", userId)
      .in("sku", batch);
    if (error) throw error;
    for (const row of data ?? []) {
      map.set(String(row.sku).toLowerCase(), String(row.id));
    }
  }
  return map;
}

/** Aplica tags de importação CSV em massa (substitui vínculos dos produtos listados). */
export async function syncImportedProductTagsBulk(
  supabase: SupabaseClient,
  userId: string,
  rows: { productId: string; tagNames: string[] }[]
): Promise<void> {
  if (rows.length === 0) return;

  const allNames: string[] = [];
  for (const r of rows) {
    for (const n of r.tagNames) allNames.push(n);
  }
  const tagMap = await getOrCreateTagsByNames(supabase, userId, allNames);

  const productIds = rows.map((r) => r.productId);
  for (let i = 0; i < productIds.length; i += ASSIGNMENT_DELETE_BATCH) {
    const batch = productIds.slice(i, i + ASSIGNMENT_DELETE_BATCH);
    const { error } = await supabase
      .from("product_tag_assignments")
      .delete()
      .in("product_id", batch);
    if (error) throw error;
  }

  const inserts: { product_id: string; tag_id: string }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const names = Array.from(new Set(r.tagNames.map(normalizeTagName).filter(Boolean)));
    for (const name of names) {
      const tag = tagMap.get(name.toLowerCase());
      if (!tag) continue;
      const key = `${r.productId}:${tag.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      inserts.push({ product_id: r.productId, tag_id: tag.id });
    }
  }

  for (let i = 0; i < inserts.length; i += ASSIGNMENT_INSERT_BATCH) {
    const batch = inserts.slice(i, i + ASSIGNMENT_INSERT_BATCH);
    const { error } = await supabase.from("product_tag_assignments").insert(batch);
    if (error) throw error;
  }
}

export type ProductTagWithCount = ProductTag & { product_count: number };

/** Lista tags do usuário com contagem de produtos vinculados. */
export async function listUserTagsWithCounts(
  supabase: SupabaseClient,
  userId: string
): Promise<ProductTagWithCount[]> {
  const { data: tags, error: tagsErr } = await supabase
    .from("product_tags")
    .select("id, name, user_id, created_at")
    .eq("user_id", userId)
    .order("name", { ascending: true });

  if (tagsErr) throw tagsErr;

  const tagList = (tags ?? []) as ProductTag[];
  if (tagList.length === 0) return [];

  const tagIds = tagList.map((t) => t.id);
  const { data: assignments, error: assignErr } = await supabase
    .from("product_tag_assignments")
    .select("tag_id, product_id")
    .in("tag_id", tagIds);

  if (assignErr) throw assignErr;

  const counts = new Map<string, number>();
  for (const row of assignments ?? []) {
    const tid = String(row.tag_id);
    counts.set(tid, (counts.get(tid) ?? 0) + 1);
  }

  return tagList.map((t) => ({
    ...t,
    product_count: counts.get(t.id) ?? 0,
  }));
}
