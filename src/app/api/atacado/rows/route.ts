import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { NextRequest, NextResponse } from "next/server";

const PAGE_SIZE = 50;

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
};

/**
 * GET /api/atacado/rows?accountId=...&search=...&filter=...&page=...&limit=...
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
  // Filtros específicos
  const filterMlb = searchParams.get("mlb")?.trim() ?? "";
  const filterMlbu = searchParams.get("mlbu_code")?.trim() ?? "";
  const filterTitle = searchParams.get("title")?.trim() ?? "";
  const filterSku = searchParams.get("sku")?.trim() ?? "";
  const filterVariation = searchParams.get("variation") ?? ""; // "com" | "sem" | ""
  const hideVariations = searchParams.get("hide_variations") === "true"; // Mostrar só anúncios, sem expandir variações
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? String(PAGE_SIZE), 10) || PAGE_SIZE));
  const from = (page - 1) * limit;

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

  // Buscar itens com paginação interna (evita limite de 1000 do Supabase)
  async function fetchAllItems() {
    const batchSize = 1000;
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
      raw_json: unknown;
    };
    let allItems: ItemRow[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      let query = supabase
        .from("ml_items")
        .select("item_id, title, has_variations, price, listing_type_id, category_id, seller_custom_field, family_name, family_id, user_product_id, raw_json")
        .eq("account_id", accountId)
        .order("updated_at", { ascending: false })
        .range(offset, offset + batchSize - 1);

      // Filtros específicos
      if (filterMlb) {
        // Busca exata se parece ser um MLB completo, senão busca parcial
        if (filterMlb.toUpperCase().startsWith("MLB") && filterMlb.length >= 10) {
          query = query.eq("item_id", filterMlb.toUpperCase());
        } else {
          query = query.ilike("item_id", `%${filterMlb}%`);
        }
      }
      if (filterMlbu) {
        query = query.ilike("user_product_id", `%${filterMlbu}%`);
      }
      if (filterTitle) {
        query = query.ilike("title", `%${filterTitle}%`);
      }
      // SKU não é filtrado aqui porque pode estar na variação, não no item
      // O filtro de SKU é aplicado no pós-processamento após extrair o SKU corretamente
      if (filterVariation === "com") {
        query = query.eq("has_variations", true);
      } else if (filterVariation === "sem") {
        query = query.eq("has_variations", false);
      }
      // Filtros de status (dropdown)
      if (filter === "mlbu") {
        query = query.not("user_product_id", "is", null);
      }
      if (filter === "com_familia") {
        query = query.not("family_name", "is", null);
      }

      const { data, error } = await query;
      if (error) throw error;

      const batch = (data ?? []) as ItemRow[];
      allItems = [...allItems, ...batch];
      hasMore = batch.length === batchSize;
      offset += batchSize;
    }

    return allItems;
  }

  let items: Awaited<ReturnType<typeof fetchAllItems>>;
  try {
    items = await fetchAllItems();
  } catch (err) {
    console.error("[atacado/rows] items error:", err);
    return NextResponse.json({ error: "Erro ao listar itens" }, { status: 500 });
  }

  // Verificar se há filtros específicos ativos (não incluir itens da família quando filtrando)
  const hasSpecificFilters = filterMlb || filterMlbu || filterTitle || filterSku || filterVariation;

  // Incluir itens da mesma família APENAS quando não há filtros específicos
  if (!hasSpecificFilters && items.length > 0) {
    const familyIdsFromMatch = Array.from(new Set(items.map((i) => i.family_id).filter(Boolean))) as string[];
    if (familyIdsFromMatch.length > 0) {
      const { data: familySiblings } = await supabase
        .from("ml_items")
        .select("item_id, title, has_variations, price, listing_type_id, category_id, seller_custom_field, family_name, family_id, user_product_id, raw_json")
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
  const [variations, priceRefs, drafts, familyItemsData] = await Promise.all([
    // Variações
    fetchInParallelBatches<VariationRow>(itemIds, 100, async (batchIds) => {
      const { data } = await supabase
        .from("ml_variations")
        .select("item_id, variation_id, price, seller_custom_field, attributes_json, raw_json")
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
    for (const [k, v] of draftsByKey.entries()) {
      if (k.startsWith(prefix)) return v;
    }
    return undefined;
  }

  function extractSkuFromAttributes(attributes: unknown): string | null {
    if (!Array.isArray(attributes)) return null;
    const skuAttr = attributes.find(
      (a: { id?: string }) => a?.id === "SELLER_SKU" || a?.id === "SKU" || a?.id === "CUSTOM_SKU"
    );
    if (skuAttr && typeof skuAttr === "object" && "value_name" in skuAttr) {
      const v = (skuAttr as { value_name?: string }).value_name;
      return v ? String(v) : null;
    }
    return null;
  }

  function getSku(
    item: { raw_json?: unknown },
    variation?: { attributes_json?: unknown; raw_json?: unknown } | null
  ): string | null {
    if (variation) {
      const rawVar = variation.raw_json as Record<string, unknown> | null;
      if (rawVar) {
        const fromAttrs = extractSkuFromAttributes(rawVar.attributes);
        if (fromAttrs) return fromAttrs;
      }
      const attr = variation.attributes_json;
      if (Array.isArray(attr)) {
        const skuAttr = attr.find((a: { id?: string }) => a?.id === "SELLER_SKU" || a?.id === "SKU" || a?.id === "CUSTOM_SKU");
        if (skuAttr && typeof skuAttr === "object" && "value_name" in skuAttr) {
          const v = (skuAttr as { value_name?: string }).value_name;
          if (v) return String(v);
        }
      }
    }
    const raw = item.raw_json as Record<string, unknown> | null;
    if (raw) {
      const fromAttrs = extractSkuFromAttributes(raw.attributes);
      if (fromAttrs) return fromAttrs;
    }
    return null;
  }

  // Construir linhas
  const rows: Array<{
    item_id: string;
    variation_id: number | null;
    sku: string | null;
    title: string | null;
    current_price: number | null;
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

    if (item.has_variations && itemVariations.length > 0 && !hideVariations) {
      // Expandir variações (comportamento padrão)
      for (const v of itemVariations) {
        const draft = getDraftForKey(item.item_id, v.variation_id);
        const ref = getRef(item.item_id, v.variation_id);
        const tiers = Array.isArray(draft?.tiers)
          ? (draft!.tiers as { min_qty: number; price: number }[]).filter(
              (t) => typeof t?.min_qty === "number" && typeof t?.price === "number"
            )
          : [];
        const familyItemIds = item.family_id ? (familyToItemIds.get(item.family_id) ?? null) : null;
        rows.push({
          item_id: item.item_id,
          variation_id: v.variation_id,
          sku: getSku(item, v),
          title: item.title ?? null,
          current_price: v.price != null ? Number(v.price) : null,
          listing_type_id: item.listing_type_id ?? null,
          category_id: item.category_id ?? null,
          tiers,
          has_draft: !!draft,
          has_variations: true,
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
    } else {
      // Mostrar apenas o item (sem expandir variações, ou item sem variações)
      const draft = getDraftForKey(item.item_id, null);
      const ref = getRef(item.item_id, null);
      const tiers = Array.isArray(draft?.tiers)
        ? (draft!.tiers as { min_qty: number; price: number }[]).filter(
            (t) => typeof t?.min_qty === "number" && typeof t?.price === "number"
          )
        : [];
      const familyItemIds = item.family_id ? (familyToItemIds.get(item.family_id) ?? null) : null;
      rows.push({
        item_id: item.item_id,
        variation_id: null,
        sku: getSku(item, null),
        title: item.title ?? null,
        current_price: item.price != null ? Number(item.price) : null,
        listing_type_id: item.listing_type_id ?? null,
        category_id: item.category_id ?? null,
        tiers,
        has_draft: !!draft,
        has_variations: false,
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
  }

  // Filtros pós-processamento
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
  const paginated = filtered.slice(from, from + limit);

  return NextResponse.json(
    { rows: paginated, total, totalItems, page, limit },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
