import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveMlItemIdsByProductTagIds } from "@/lib/product-tags";
import { NextRequest, NextResponse } from "next/server";
import { resolveSkuForAtacadoListing } from "@/lib/atacado";
import { isAllPageSize } from "@/lib/table-pagination";

const PAGE_SIZE = 50;
/** Máximo por requisição (alinhado à tela de Preços para regras em massa em catálogos maiores). */
const MAX_PAGE_LIMIT = 10000;

type DraftRow = {
  item_id: string;
  variation_id: number | null;
  tiers_json: unknown;
  updated_at: string;
};

type PriceRefRow = {
  item_id: string;
  variation_id: number | null;
  status: string;
  suggested_price: number | null;
  min_reference_price: number | null;
  max_reference_price: number | null;
  explanation: string | null;
  updated_at: string;
};

type VariationRow = {
  item_id: string;
  variation_id: number;
  price: number | null;
  seller_custom_field: string | null;
  attributes_json: unknown;
  raw_json: unknown;
  products?: unknown;
};

/** Alinhado a planned_prices / pricing-cache: -1 = anúncio sem variação ou preço no nível do item */
const PLANNED_VARIATION_ITEM = -1;

type PlannedPriceRow = {
  item_id: string;
  variation_id: number | null;
  planned_price: number;
};

/**
 * GET /api/atacado/rows?accountId=...&filter=...&page=...&limit=...
 * Retorna linhas achatadas (item/variação) combinadas com drafts.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId")?.trim();
  const filter = searchParams.get("filter") ?? "";
  const filterMlb = searchParams.get("mlb")?.trim() ?? "";
  const filterMlbu = searchParams.get("mlbu_code")?.trim() ?? "";
  const filterTitle = searchParams.get("title")?.trim() ?? "";
  const filterSku = searchParams.get("sku")?.trim() ?? "";
  const filterVariation = searchParams.get("variation") ?? ""; // "com" | "sem" | ""
  const tagIdsParam = searchParams.get("tags")?.trim() ?? "";
  const tagIds = tagIdsParam
    ? tagIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const limitParam = parseInt(searchParams.get("limit") ?? String(PAGE_SIZE), 10);
  const showAll = isAllPageSize(limitParam);
  const page = showAll ? 1 : Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = showAll
    ? MAX_PAGE_LIMIT
    : Math.min(
        MAX_PAGE_LIMIT,
        Math.max(1, Number.isFinite(limitParam) ? limitParam : PAGE_SIZE)
      );
  const from = showAll ? 0 : (page - 1) * limit;

  if (!accountId) {
    return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });
  }

  const { data: account } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  let allowedItemIds: string[] | null = null;
  if (tagIds.length > 0) {
    try {
      const resolved = await resolveMlItemIdsByProductTagIds(supabase, accountId, tagIds);
      allowedItemIds = resolved ?? [];
      if (allowedItemIds.length === 0) {
        return NextResponse.json({ rows: [], total: 0, totalItems: 0, page, limit: showAll ? 0 : limit });
      }
    } catch (e) {
      console.error("[atacado/rows] filtro por tags:", e);
      return NextResponse.json({ error: "Erro ao filtrar por tags" }, { status: 500 });
    }
  }

  type ItemRow = {
    item_id: string;
    title: string | null;
    has_variations: boolean;
    price: number | null;
    listing_type_id: string | null;
    category_id: string | null;
    seller_custom_field: string | null;
    family_name: string | null;
    family_id: string | null;
    user_product_id: string | null;
    raw_json?: unknown;
    products?: unknown;
  };

  const ITEM_SELECT =
    "item_id, title, has_variations, price, listing_type_id, category_id, seller_custom_field, family_name, family_id, user_product_id, product_id, products:product_id (sku)";
  const ITEM_SELECT_WITH_RAW =
    "item_id, title, has_variations, price, listing_type_id, category_id, seller_custom_field, family_name, family_id, user_product_id, product_id, raw_json, products:product_id (sku)";

  const needsFullScan =
    showAll ||
    !!filterSku ||
    filter === "com_rascunho" ||
    filter === "sem_rascunho" ||
    filter === "price_high";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- evita TS2589 com tipos profundos do Supabase
  function applyItemFilters(query: any): any {
    let q = query;
    if (filterMlb) {
      if (filterMlb.toUpperCase().startsWith("MLB") && filterMlb.length >= 10) {
        q = q.eq("item_id", filterMlb.toUpperCase());
      } else {
        q = q.ilike("item_id", `%${filterMlb}%`);
      }
    }
    if (filterTitle) {
      q = q.ilike("title", `%${filterTitle}%`);
    }
    if (filterMlbu) {
      q = q.ilike("user_product_id", `%${filterMlbu}%`);
    }
    if (filterVariation === "com") {
      q = q.eq("has_variations", true);
    } else if (filterVariation === "sem") {
      q = q.eq("has_variations", false);
    }
    if (filter === "mlbu") {
      q = q.not("user_product_id", "is", null);
    }
    if (filter === "com_familia") {
      q = q.not("family_name", "is", null);
    }
    if (allowedItemIds) {
      q = q.in("item_id", allowedItemIds);
    }
    return q;
  }

  async function fetchAllItems(includeRawJson: boolean) {
    const batchSize = 1000;
    let allItems: ItemRow[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const rangeEnd = offset + batchSize - 1;
      const { data, error } = includeRawJson
        ? await applyItemFilters(
            supabase
              .from("ml_items")
              .select(ITEM_SELECT_WITH_RAW)
              .eq("account_id", accountId)
              .order("updated_at", { ascending: false })
              .range(offset, rangeEnd)
          )
        : await applyItemFilters(
            supabase
              .from("ml_items")
              .select(ITEM_SELECT)
              .eq("account_id", accountId)
              .order("updated_at", { ascending: false })
              .range(offset, rangeEnd)
          );

      if (error) throw error;

      const batch = (data ?? []) as unknown as ItemRow[];
      allItems = [...allItems, ...batch];
      hasMore = batch.length === batchSize;
      offset += batchSize;
    }

    return allItems;
  }

  let items: ItemRow[] = [];
  let dbPaginatedTotal: number | null = null;

  try {
    if (!needsFullScan) {
      const countQuery = applyItemFilters(
        supabase
          .from("ml_items")
          .select("item_id", { count: "exact", head: true })
          .eq("account_id", accountId)
      );
      const pageQuery = applyItemFilters(
        supabase
          .from("ml_items")
          .select(ITEM_SELECT)
          .eq("account_id", accountId)
          .order("updated_at", { ascending: false })
          .range(from, from + limit - 1)
      );

      const [{ count, error: countError }, { data: pageItems, error: pageError }] = await Promise.all([
        countQuery,
        pageQuery,
      ]);

      if (countError) throw countError;
      if (pageError) throw pageError;

      dbPaginatedTotal = count ?? 0;
      items = (pageItems ?? []) as ItemRow[];
    } else {
      items = await fetchAllItems(!!filterSku);
    }
  } catch (err) {
    console.error("[atacado/rows] items error:", err);
    const code = typeof err === "object" && err != null && "code" in err ? String((err as { code?: string }).code) : "";
    if (code === "57014") {
      return NextResponse.json(
        { error: "A consulta demorou demais. Use filtros (MLB, título, SKU) para reduzir o resultado." },
        { status: 504 }
      );
    }
    return NextResponse.json({ error: "Erro ao listar itens" }, { status: 500 });
  }

  const hasSpecificFilters =
    filterMlb || filterMlbu || filterTitle || filterSku || filterVariation || !!allowedItemIds;

  if (needsFullScan && !hasSpecificFilters && items.length > 0) {
    const familyIdsFromMatch = Array.from(new Set(items.map((i) => i.family_id).filter(Boolean))) as string[];
    if (familyIdsFromMatch.length > 0) {
      const { data: familySiblings } = await supabase
        .from("ml_items")
        .select(ITEM_SELECT)
        .eq("account_id", accountId)
        .in("family_id", familyIdsFromMatch);
      const seen = new Set(items.map((i) => i.item_id));
      const extra = ((familySiblings ?? []) as typeof items).filter((s) => !seen.has(s.item_id));
      if (extra.length > 0) {
        items = [...items, ...extra];
      }
      items.sort((a, b) => {
        const fa = a.family_id ?? "\uffff";
        const fb = b.family_id ?? "\uffff";
        if (fa !== fb) return fa.localeCompare(fb);
        return (a.item_id ?? "").localeCompare(b.item_id ?? "");
      });
    }
  }

  const itemIds = items.map((i) => i.item_id);
  if (itemIds.length === 0) {
    return NextResponse.json({ rows: [], total: 0, totalItems: 0, page, limit });
  }

  const itemIdsUpper = Array.from(new Set(itemIds.map((id) => String(id).trim().toUpperCase())));

  // Função auxiliar para buscar em lotes paralelos
  async function fetchInParallelBatches<T>(
    ids: string[],
    batchSize: number,
    fetcher: (batchIds: string[]) => Promise<T[]>
  ): Promise<T[]> {
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += batchSize) {
      batches.push(ids.slice(i, i + batchSize));
    }
    // Executa todos os lotes em paralelo
    const results = await Promise.all(batches.map(fetcher));
    return results.flat();
  }

  // Preparar service client para drafts
  let draftsClient = supabase;
  try {
    draftsClient = createServiceClient();
  } catch {
    // usa supabase normal
  }

  // Executar todas as buscas em PARALELO
  const [variations, priceRefs, drafts, plannedRows, familyItemsData] = await Promise.all([
    // Variações
    fetchInParallelBatches<VariationRow>(itemIds, 100, async (batchIds) => {
      const { data } = await supabase
        .from("ml_variations")
        .select(
          "item_id, variation_id, price, seller_custom_field, attributes_json, raw_json, product_id, products:product_id (sku)"
        )
        .eq("account_id", accountId)
        .in("item_id", batchIds);
      return (data ?? []) as VariationRow[];
    }),

    // Price references
    fetchInParallelBatches<PriceRefRow>(itemIds, 100, async (batchIds) => {
      const { data } = await supabase
        .from("price_references")
        .select("item_id, variation_id, status, suggested_price, min_reference_price, max_reference_price, explanation, updated_at")
        .eq("account_id", accountId)
        .in("item_id", batchIds);
      return (data ?? []) as PriceRefRow[];
    }),

    // Drafts
    fetchInParallelBatches<DraftRow>(itemIdsUpper, 100, async (batchIds) => {
      const { data, error } = await draftsClient
        .from("wholesale_drafts")
        .select("item_id, variation_id, tiers_json, updated_at")
        .eq("account_id", accountId)
        .in("item_id", batchIds);
      if (error) console.error("[atacado/rows] drafts batch error:", error);
      return (data ?? []) as DraftRow[];
    }),

    // Preços planejados (calculadora / Preços)
    fetchInParallelBatches<PlannedPriceRow>(itemIdsUpper, 100, async (batchIds) => {
      const { data, error } = await supabase
        .from("planned_prices")
        .select("item_id, variation_id, planned_price")
        .eq("account_id", accountId)
        .in("item_id", batchIds);
      if (error) console.error("[atacado/rows] planned_prices batch error:", error);
      return (data ?? []) as PlannedPriceRow[];
    }),

    // Family items mapping
    (async () => {
      const familyIds = Array.from(new Set(items.map((i) => i.family_id).filter(Boolean))) as string[];
      if (familyIds.length === 0) return [];
      const { data } = await supabase
        .from("ml_items")
        .select("family_id, item_id")
        .eq("account_id", accountId)
        .in("family_id", familyIds);
      return data ?? [];
    })(),
  ]);

  // Criar mapas para lookup rápido
  const familyToItemIds = new Map<string, string[]>();
  for (const row of familyItemsData) {
    const r = row as { family_id: string; item_id: string };
    const list = familyToItemIds.get(r.family_id) ?? [];
    list.push(r.item_id);
    familyToItemIds.set(r.family_id, list);
  }

  const refsByKey = new Map<string, PriceRefRow>();
  const refKey = (itemId: string, variationId: number | null) =>
    `${String(itemId).trim().toUpperCase()}:${variationId ?? "item"}`;
  for (const r of priceRefs) {
    refsByKey.set(refKey(r.item_id, r.variation_id ?? null), r);
  }

  const draftsByKey = new Map<string, { tiers: unknown[]; updated_at: string }>();
  const itemKey = (itemId: string, variationId: number | null) =>
    `${String(itemId ?? "").trim().toUpperCase()}:${variationId ?? "item"}`;
  for (const d of drafts) {
    draftsByKey.set(itemKey(d.item_id, d.variation_id ?? null), {
      tiers: (d.tiers_json as unknown[]) ?? [],
      updated_at: d.updated_at ?? "",
    });
  }

  const plannedByKey = new Map<string, number>();
  const plannedLookupKey = (itemId: string, variationId: number | null) => {
    const vid = variationId == null ? PLANNED_VARIATION_ITEM : variationId;
    return `${String(itemId).trim().toUpperCase()}:${vid}`;
  };
  for (const p of plannedRows) {
    const vid =
      p.variation_id == null || p.variation_id === PLANNED_VARIATION_ITEM
        ? PLANNED_VARIATION_ITEM
        : Number(p.variation_id);
    plannedByKey.set(`${String(p.item_id).trim().toUpperCase()}:${vid}`, Number(p.planned_price));
  }

  function getPlannedPrice(itemId: string, variationId: number | null): number | null {
    const v = plannedByKey.get(plannedLookupKey(itemId, variationId));
    return v != null && !Number.isNaN(v) ? v : null;
  }

  function resolvePlannedPriceForItem(
    itemId: string,
    fallbackPrice: number,
    variationIds: number[]
  ): number | null {
    const atItem = getPlannedPrice(itemId, null);
    if (atItem != null) return atItem;
    for (const vid of variationIds) {
      const p = getPlannedPrice(itemId, vid);
      if (p != null) return p;
    }
    return Number.isFinite(fallbackPrice) && fallbackPrice > 0 ? fallbackPrice : null;
  }

  function resolveDraftForItem(
    itemId: string,
    variationIds: number[]
  ): { tiers: unknown[]; updated_at: string } | undefined {
    const atItem = getDraftForKey(itemId, null);
    if (atItem) return atItem;
    for (const vid of variationIds) {
      const d = getDraftForKey(itemId, vid);
      if (d) return d;
    }
    return undefined;
  }

  function resolveRefForItem(itemId: string, variationIds: number[]): PriceRefRow | undefined {
    const atItem = getRef(itemId, null);
    if (atItem) return atItem;
    for (const vid of variationIds) {
      const r = getRef(itemId, vid);
      if (r) return r;
    }
    return undefined;
  }

  // Criar mapa de variações por item_id para lookup O(1)
  const variationsByItemId = new Map<string, VariationRow[]>();
  for (const v of variations) {
    const list = variationsByItemId.get(v.item_id) ?? [];
    list.push(v);
    variationsByItemId.set(v.item_id, list);
  }

  function getRef(itemId: string, variationId: number | null): PriceRefRow | undefined {
    return refsByKey.get(refKey(itemId, variationId));
  }

  function getDraftForKey(itemId: string, variationId: number | null): { tiers: unknown[]; updated_at: string } | undefined {
    const exact = draftsByKey.get(itemKey(itemId, variationId));
    if (exact) return exact;
    const prefix = itemKey(itemId, null).replace(/:item$/, ":");
    for (const [k, v] of Array.from(draftsByKey.entries())) {
      if (k.startsWith(prefix)) return v;
    }
    return undefined;
  }

  // Construir linhas
  const rows: Array<{
    item_id: string;
    variation_id: number | null;
    sku: string | null;
    title: string | null;
    current_price: number | null;
    /** Preço novo da calculadora (planned_prices), mesma conta */
    planned_price: number | null;
    listing_type_id: string | null;
    category_id: string | null;
    tiers: { min_qty: number; price: number }[];
    has_draft: boolean;
    has_variations: boolean;
    draft_updated_at: string | null;
    price_reference_status: "competitive" | "attention" | "high" | "none";
    reference_summary: {
      suggested_price: number | null;
      min_reference_price: number | null;
      max_reference_price: number | null;
      status: string;
      explanation: string;
      updated_at: string | null;
    } | null;
    family_name: string | null;
    is_user_product: boolean;
    user_product_id: string | null;
    family_id: string | null;
    family_item_ids: string[] | null;
  }> = [];

  for (const item of items) {
    const itemVariations = variationsByItemId.get(item.item_id) ?? [];
    const variationIds = itemVariations.map((v) => v.variation_id);
    const draft = resolveDraftForItem(item.item_id, variationIds);
    const ref = resolveRefForItem(item.item_id, variationIds);
    const tiers = Array.isArray(draft?.tiers)
      ? (draft.tiers as { min_qty: number; price: number }[]).filter(
          (t) => typeof t?.min_qty === "number" && typeof t?.price === "number"
        )
      : [];
    const familyItemIds = item.family_id ? (familyToItemIds.get(item.family_id) ?? null) : null;
    const currentPrice = item.price != null ? Number(item.price) : null;
    rows.push({
      item_id: item.item_id,
      variation_id: null,
      sku: resolveSkuForAtacadoListing(item, itemVariations),
      title: item.title ?? null,
      current_price: currentPrice,
      planned_price: resolvePlannedPriceForItem(
        item.item_id,
        currentPrice ?? 0,
        variationIds
      ),
      listing_type_id: item.listing_type_id ?? null,
      category_id: item.category_id ?? null,
      tiers,
      has_draft: !!draft,
      has_variations: !!item.has_variations,
      draft_updated_at: draft?.updated_at ?? null,
      price_reference_status: (ref?.status as "competitive" | "attention" | "high" | "none") ?? "none",
      reference_summary: ref
        ? {
            suggested_price: ref.suggested_price ?? null,
            min_reference_price: ref.min_reference_price ?? null,
            max_reference_price: ref.max_reference_price ?? null,
            status: ref.status,
            explanation: ref.explanation ?? "",
            updated_at: ref.updated_at ?? null,
          }
        : null,
      family_name: item.family_name ?? null,
      is_user_product: !!item.user_product_id,
      user_product_id: item.user_product_id ?? null,
      family_id: item.family_id ?? null,
      family_item_ids: familyItemIds,
    });
  }

  if (dbPaginatedTotal != null) {
    return NextResponse.json(
      {
        rows,
        total: dbPaginatedTotal,
        totalItems: dbPaginatedTotal,
        page,
        limit: showAll ? 0 : limit,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  // Filtros pós-processamento (modo varredura completa)
  let filtered = rows;
  
  // Filtro de variação (garantir que funcione no nível da linha)
  if (filterVariation === "com") {
    filtered = filtered.filter((r) => r.has_variations);
  } else if (filterVariation === "sem") {
    filtered = filtered.filter((r) => !r.has_variations);
  }
  
  // Filtro de MLB (garantir busca exata quando é um MLB completo)
  if (filterMlb) {
    const mlbUpper = filterMlb.toUpperCase();
    if (mlbUpper.startsWith("MLB") && filterMlb.length >= 10) {
      filtered = filtered.filter((r) => r.item_id.toUpperCase() === mlbUpper);
    } else {
      filtered = filtered.filter((r) => r.item_id.toUpperCase().includes(mlbUpper));
    }
  }

  // Filtro de SKU (busca no campo sku que já foi extraído corretamente)
  if (filterSku) {
    const skuUpper = filterSku.toUpperCase();
    filtered = filtered.filter((r) => r.sku && r.sku.toUpperCase().includes(skuUpper));
  }

  // Filtro de título
  if (filterTitle) {
    const titleUpper = filterTitle.toUpperCase();
    filtered = filtered.filter((r) => r.title && r.title.toUpperCase().includes(titleUpper));
  }
  
  // Filtro de MLBU
  if (filterMlbu) {
    const mlbuUpper = filterMlbu.toUpperCase();
    filtered = filtered.filter((r) => r.user_product_id && r.user_product_id.toUpperCase().includes(mlbuUpper));
  }
  
  // Filtros de status
  if (filter === "com_rascunho") {
    filtered = filtered.filter((r) => r.has_draft);
  } else if (filter === "sem_rascunho") {
    filtered = filtered.filter((r) => !r.has_draft);
  } else if (filter === "price_high") {
    filtered = filtered.filter((r) => r.price_reference_status === "high");
  }

  // Ordenar
  filtered = [...filtered].sort((a, b) => {
    const fa = a.family_id ?? "\uffff";
    const fb = b.family_id ?? "\uffff";
    if (fa !== fb) return fa.localeCompare(fb);
    return (a.item_id ?? "").localeCompare(b.item_id ?? "");
  });

  const total = filtered.length;
  const totalItems = new Set(filtered.map((r) => r.item_id)).size;
  const paginated = showAll
    ? filtered
    : filtered.slice(from, from + limit);

  return NextResponse.json(
    { rows: paginated, total, totalItems, page, limit: showAll ? 0 : limit },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
