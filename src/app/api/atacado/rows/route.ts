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
  const search = searchParams.get("search")?.trim() ?? "";
  const filter = searchParams.get("filter") ?? ""; // com_variações | com_rascunho | sem_rascunho
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

  let itemsQuery = supabase
    .from("ml_items")
    .select("item_id, title, has_variations, price, listing_type_id, category_id, seller_custom_field, raw_json")
    .eq("account_id", accountId)
    .order("updated_at", { ascending: false });

  if (search) {
    itemsQuery = itemsQuery.or(
      `item_id.ilike.%${search}%,title.ilike.%${search}%,seller_custom_field.ilike.%${search}%`
    );
  }
  if (filter === "com_variações") {
    itemsQuery = itemsQuery.eq("has_variations", true);
  }

  const { data: items, error: itemsError } = await itemsQuery;
  if (itemsError) {
    console.error("[atacado/rows] items error:", itemsError);
    return NextResponse.json({ error: "Erro ao listar itens" }, { status: 500 });
  }

  const itemIds = (items ?? []).map((i) => i.item_id);
  if (itemIds.length === 0) {
    return NextResponse.json({
      rows: [],
      total: 0,
      page,
      limit,
    });
  }

  const itemIdsUpper = Array.from(new Set(itemIds.map((id) => String(id).trim().toUpperCase())));

  const { data: variations } = await supabase
    .from("ml_variations")
    .select("item_id, variation_id, price, seller_custom_field, attributes_json, raw_json")
    .eq("account_id", accountId)
    .in("item_id", itemIds);

  let drafts: DraftRow[] | null = null;
  try {
    const serviceSupabase = createServiceClient();
    const result = await serviceSupabase
      .from("wholesale_drafts")
      .select("item_id, variation_id, tiers_json, updated_at")
      .eq("account_id", accountId)
      .in("item_id", itemIdsUpper);
    drafts = (result.data ?? null) as DraftRow[] | null;
    if (result.error) console.error("[atacado/rows] drafts error:", result.error);
  } catch {
    const result = await supabase
      .from("wholesale_drafts")
      .select("item_id, variation_id, tiers_json, updated_at")
      .eq("account_id", accountId)
      .in("item_id", itemIdsUpper);
    drafts = (result.data ?? null) as DraftRow[] | null;
  }

  const draftsByKey = new Map<string, { tiers: unknown[]; updated_at: string }>();
  const itemKey = (itemId: string, variationId: number | null) =>
    `${String(itemId ?? "").trim().toUpperCase()}:${variationId ?? "item"}`;
  for (const d of drafts ?? []) {
    const key = itemKey(d.item_id, d.variation_id ?? null);
    draftsByKey.set(key, {
      tiers: (d.tiers_json as unknown[]) ?? [],
      updated_at: d.updated_at ?? "",
    });
  }

  function getDraftForKey(
    itemId: string,
    variationId: number | null
  ): { tiers: unknown[]; updated_at: string } | undefined {
    const exact = draftsByKey.get(itemKey(itemId, variationId));
    if (exact) return exact;
    const prefix = itemKey(itemId, null).replace(/:item$/, ":");
    const entries = Array.from(draftsByKey.entries());
    for (let i = 0; i < entries.length; i++) {
      const [k, v] = entries[i];
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
    item: { seller_custom_field?: string | null; raw_json?: unknown },
    variation?: { seller_custom_field?: string | null; attributes_json?: unknown; raw_json?: unknown } | null
  ): string | null {
    if (variation) {
      const vSku = variation.seller_custom_field;
      if (vSku) return vSku;
      const raw = variation.raw_json as Record<string, unknown> | null;
      if (raw) {
        const fromAttrs = extractSkuFromAttributes(raw.attributes);
        if (fromAttrs) return fromAttrs;
        if (raw.seller_custom_field) return String(raw.seller_custom_field);
      }
      const attr = variation.attributes_json;
      if (Array.isArray(attr)) {
        const skuAttr = attr.find((a: { id?: string }) => a?.id === "SELLER_SKU" || a?.id === "SKU" || a?.id === "CUSTOM_SKU");
        if (skuAttr && typeof skuAttr === "object" && "value_name" in skuAttr) return String((skuAttr as { value_name?: string }).value_name ?? "");
      }
    }
    if (item.seller_custom_field) return item.seller_custom_field;
    const raw = item.raw_json as Record<string, unknown> | null;
    if (raw) {
      const fromAttrs = extractSkuFromAttributes(raw.attributes);
      if (fromAttrs) return fromAttrs;
      if (raw.seller_custom_field) return String(raw.seller_custom_field);
    }
    return null;
  }

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
  }> = [];

  for (const item of items ?? []) {
    const itemVariations = (variations ?? []).filter((v) => v.item_id === item.item_id);

    if (item.has_variations && itemVariations.length > 0) {
      for (const v of itemVariations) {
        const draft = getDraftForKey(item.item_id, v.variation_id);
        const tiers = Array.isArray(draft?.tiers)
          ? (draft!.tiers as { min_qty: number; price: number }[]).filter(
              (t) => typeof t?.min_qty === "number" && typeof t?.price === "number"
            )
          : [];
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
        });
      }
    } else {
      const draft = getDraftForKey(item.item_id, null);
      const tiers = Array.isArray(draft?.tiers)
        ? (draft!.tiers as { min_qty: number; price: number }[]).filter(
            (t) => typeof t?.min_qty === "number" && typeof t?.price === "number"
          )
        : [];
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
      });
    }
  }

  let filtered = rows;
  if (filter === "com_rascunho") {
    filtered = rows.filter((r) => r.has_draft);
  } else if (filter === "sem_rascunho") {
    filtered = rows.filter((r) => !r.has_draft);
  }

  const total = filtered.length;
  const paginated = filtered.slice(from, from + limit);

  return NextResponse.json(
    { rows: paginated, total, page, limit },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
