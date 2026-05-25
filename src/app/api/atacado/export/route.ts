import { resolveSkuForAtacadoListing } from "@/lib/atacado";
import { createClient } from "@/lib/supabase/server";
import { resolveMlItemIdsByProductTagIds } from "@/lib/product-tags";
import { NextRequest, NextResponse } from "next/server";

const PLANNED_VARIATION_ITEM = -1;

/**
 * GET /api/atacado/export?accountId=...&mlb=...&mlbu_code=...&title=...&sku=...&variation=...&filter=...&hide_variations=...
 * Retorna CSV: item_id, variation_id, sku, titulo, preco_atual, promocao (calculadora),
 * atacado1_qtd_min, atacado1_preco, … atacado5_*. Inclui drafts nas faixas de atacado.
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
  const filterVariation = searchParams.get("variation") ?? "";
  const tagIdsParam = searchParams.get("tags")?.trim() ?? "";
  const tagIds = tagIdsParam
    ? tagIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

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
    const resolved = await resolveMlItemIdsByProductTagIds(supabase, accountId, tagIds);
    allowedItemIds = resolved ?? [];
    if (allowedItemIds.length === 0) {
      const headers = [
        "item_id",
        "variation_id",
        "sku",
        "titulo",
        "preco_atual",
        "promocao",
        ...Array.from({ length: 5 }, (_, i) => [`atacado${i + 1}_qtd_min`, `atacado${i + 1}_preco`]).flat(),
      ].join(";");
      return new NextResponse(headers + "\n", {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"atacado_export.csv\"",
        },
      });
    }
  }

  // Buscar todos os itens com paginação (Supabase limita a 1000 por query)
  const PAGE_SIZE = 1000;
  let allItems: {
    item_id: string;
    title: string | null;
    has_variations: boolean | null;
    price: number | null;
    seller_custom_field: string | null;
    user_product_id: string | null;
    raw_json: unknown;
    products?: unknown;
  }[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let itemsQuery = supabase
      .from("ml_items")
      .select(
        "item_id, title, has_variations, price, seller_custom_field, user_product_id, raw_json, product_id, products:product_id (sku)"
      )
      .eq("account_id", accountId)
      .order("updated_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    // Filtros específicos
    if (filterMlb) {
      if (filterMlb.toUpperCase().startsWith("MLB") && filterMlb.length >= 10) {
        itemsQuery = itemsQuery.eq("item_id", filterMlb.toUpperCase());
      } else {
        itemsQuery = itemsQuery.ilike("item_id", `%${filterMlb}%`);
      }
    }
    if (filterTitle) {
      itemsQuery = itemsQuery.ilike("title", `%${filterTitle}%`);
    }
    if (filterMlbu) {
      itemsQuery = itemsQuery.ilike("user_product_id", `%${filterMlbu}%`);
    }
    if (filterVariation === "com") {
      itemsQuery = itemsQuery.eq("has_variations", true);
    } else if (filterVariation === "sem") {
      itemsQuery = itemsQuery.eq("has_variations", false);
    }
    if (filter === "mlbu") {
      itemsQuery = itemsQuery.not("user_product_id", "is", null);
    }
    if (allowedItemIds) {
      itemsQuery = itemsQuery.in("item_id", allowedItemIds);
    }

    const { data: pageItems, error: itemsError } = await itemsQuery;
    if (itemsError) {
      return NextResponse.json({ error: "Erro ao listar itens" }, { status: 500 });
    }

    if (pageItems && pageItems.length > 0) {
      allItems = allItems.concat(pageItems);
      offset += PAGE_SIZE;
      hasMore = pageItems.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  const items = allItems;

  const itemIds = (items ?? []).map((i) => i.item_id);
  if (itemIds.length === 0) {
    const headers = [
      "item_id",
      "variation_id",
      "sku",
      "titulo",
      "preco_atual",
      "promocao",
      ...Array.from({ length: 5 }, (_, i) => [`atacado${i + 1}_qtd_min`, `atacado${i + 1}_preco`]).flat(),
    ].join(";");
    return new NextResponse(headers + "\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"atacado_modelo.csv\"",
      },
    });
  }

  // Buscar variações em lotes (limite de itens no IN e paginação)
  const BATCH_SIZE = 500;
  let allVariations: {
    item_id: string;
    variation_id: string | number;
    price: number | null;
    seller_custom_field: string | null;
    attributes_json: unknown;
    raw_json: unknown;
    products?: unknown;
  }[] = [];

  for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
    const batchIds = itemIds.slice(i, i + BATCH_SIZE);
    let varOffset = 0;
    let varHasMore = true;

    while (varHasMore) {
      const { data: varPage } = await supabase
        .from("ml_variations")
        .select(
          "item_id, variation_id, price, seller_custom_field, attributes_json, raw_json, product_id, products:product_id (sku)"
        )
        .eq("account_id", accountId)
        .in("item_id", batchIds)
        .range(varOffset, varOffset + PAGE_SIZE - 1);

      if (varPage && varPage.length > 0) {
        allVariations = allVariations.concat(varPage);
        varOffset += PAGE_SIZE;
        varHasMore = varPage.length === PAGE_SIZE;
      } else {
        varHasMore = false;
      }
    }
  }
  const variations = allVariations;

  // Buscar drafts em lotes
  let allDrafts: {
    item_id: string;
    variation_id: string | number | null;
    tiers_json: unknown;
  }[] = [];

  for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
    const batchIds = itemIds.slice(i, i + BATCH_SIZE);
    let draftOffset = 0;
    let draftHasMore = true;

    while (draftHasMore) {
      const { data: draftPage } = await supabase
        .from("wholesale_drafts")
        .select("item_id, variation_id, tiers_json")
        .eq("account_id", accountId)
        .in("item_id", batchIds)
        .range(draftOffset, draftOffset + PAGE_SIZE - 1);

      if (draftPage && draftPage.length > 0) {
        allDrafts = allDrafts.concat(draftPage);
        draftOffset += PAGE_SIZE;
        draftHasMore = draftPage.length === PAGE_SIZE;
      } else {
        draftHasMore = false;
      }
    }
  }
  const drafts = allDrafts;

  const draftsByKey = new Map<string, { min_qty: number; price: number }[]>();
  for (const d of drafts ?? []) {
    const key = `${d.item_id}:${d.variation_id ?? "item"}`;
    const tiers = Array.isArray(d.tiers_json)
      ? (d.tiers_json as { min_qty: number; price: number }[]).filter(
          (t) => typeof t?.min_qty === "number" && typeof t?.price === "number"
        )
      : [];
    draftsByKey.set(key, tiers);
  }

  const plannedByKey = new Map<string, number>();
  const plannedLookupKey = (itemId: string, variationId: number | null) => {
    const vid = variationId == null ? PLANNED_VARIATION_ITEM : variationId;
    return `${String(itemId).trim().toUpperCase()}:${vid}`;
  };
  for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
    const batchIds = itemIds.slice(i, i + BATCH_SIZE);
    const { data: plannedBatch } = await supabase
      .from("planned_prices")
      .select("item_id, variation_id, planned_price")
      .eq("account_id", accountId)
      .in("item_id", batchIds);
    for (const row of plannedBatch ?? []) {
      const pr = row as { item_id: string; variation_id: number | null; planned_price: number };
      const vid =
        pr.variation_id == null || pr.variation_id === PLANNED_VARIATION_ITEM
          ? PLANNED_VARIATION_ITEM
          : Number(pr.variation_id);
      plannedByKey.set(`${String(pr.item_id).trim().toUpperCase()}:${vid}`, Number(pr.planned_price));
    }
  }

  function getPlannedPrice(itemId: string, variationId: number | null): number | null {
    const v = plannedByKey.get(plannedLookupKey(itemId, variationId));
    return v != null && !Number.isNaN(v) ? v : null;
  }

  const SEP = ";";
  function escapeCsv(v: string): string {
    if (v.includes(SEP) || v.includes('"') || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  }
  /** Formata número para CSV no padrão BR: vírgula como decimal (ex: 10,50). */
  function formatPriceCsv(n: number | null | undefined): string {
    if (n == null || Number.isNaN(n)) return "";
    return Number(n).toFixed(2).replace(".", ",");
  }

  const headers = [
    "item_id",
    "variation_id",
    "sku",
    "titulo",
    "preco_atual",
    "promocao",
    ...Array.from({ length: 5 }, (_, i) => [`atacado${i + 1}_qtd_min`, `atacado${i + 1}_preco`]).flat(),
  ];

  interface CsvRow {
    values: string[];
    hasDraft: boolean;
    sku: string | null;
    title: string | null;
    userProductId: string | null;
  }
  const dataRows: CsvRow[] = [];

  function tiersForItem(itemId: string, variationIds: number[]): { min_qty: number; price: number }[] {
    const itemKey = `${itemId}:item`;
    const direct = draftsByKey.get(itemKey);
    if (direct?.length) return direct;
    for (const vid of variationIds) {
      const t = draftsByKey.get(`${itemId}:${vid}`);
      if (t?.length) return t;
    }
    return [];
  }

  function plannedForItem(itemId: string, fallback: number, variationIds: number[]): number | null {
    const atItem = getPlannedPrice(itemId, null);
    if (atItem != null) return atItem;
    for (const vid of variationIds) {
      const p = getPlannedPrice(itemId, vid);
      if (p != null) return p;
    }
    return fallback > 0 ? fallback : null;
  }

  for (const item of items ?? []) {
    const itemVariations = (variations ?? []).filter((v) => v.item_id === item.item_id);
    const variationIds = itemVariations.map((v) => Number(v.variation_id));
    const tiers = tiersForItem(item.item_id, variationIds);
    const skuResolved = resolveSkuForAtacadoListing(item, itemVariations);
    const sku = skuResolved ? escapeCsv(skuResolved) : "";
    const price = item.price != null ? Number(item.price) : null;
    const values = [
      escapeCsv(item.item_id),
      "",
      sku,
      escapeCsv(item.title ?? ""),
      formatPriceCsv(price ?? undefined),
      formatPriceCsv(plannedForItem(item.item_id, price ?? 0, variationIds) ?? undefined),
      ...Array.from({ length: 5 }, (_, i) => {
        const t = tiers[i];
        return t ? [String(t.min_qty), formatPriceCsv(t.price)] : ["", ""];
      }).flat(),
    ];
    dataRows.push({
      values,
      hasDraft: tiers.length > 0,
      sku: skuResolved,
      title: item.title,
      userProductId: item.user_product_id,
    });
  }

  // Aplicar filtros pós-processamento
  let filtered = dataRows;

  // Filtro de SKU (precisa ser feito aqui porque o SKU pode vir da variação)
  if (filterSku) {
    const skuUpper = filterSku.toUpperCase();
    filtered = filtered.filter((r) => r.sku && r.sku.toUpperCase().includes(skuUpper));
  }

  // Filtros de status
  if (filter === "com_rascunho") {
    filtered = filtered.filter((r) => r.hasDraft);
  } else if (filter === "sem_rascunho") {
    filtered = filtered.filter((r) => !r.hasDraft);
  }

  const csvContent = [headers.join(SEP), ...filtered.map((r) => r.values.join(SEP))].join("\n");
  const bom = "\uFEFF";

  return new NextResponse(bom + csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"atacado_export.csv\"",
    },
  });
}
