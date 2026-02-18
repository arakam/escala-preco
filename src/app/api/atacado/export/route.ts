import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/atacado/export?accountId=...&search=...&filter=...
 * Retorna CSV modelo com colunas item_id, variation_id, sku, title, price_atual,
 * tier1_min_qty, tier1_price, ... tier5_min_qty, tier5_price
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
  const filter = searchParams.get("filter") ?? "";

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
    .select("item_id, title, has_variations, price, seller_custom_field, raw_json")
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
    return NextResponse.json({ error: "Erro ao listar itens" }, { status: 500 });
  }

  const itemIds = (items ?? []).map((i) => i.item_id);
  if (itemIds.length === 0) {
    const headers = [
      "item_id",
      "variation_id",
      "sku",
      "title",
      "price_atual",
      ...Array.from({ length: 5 }, (_, i) => [`tier${i + 1}_min_qty`, `tier${i + 1}_price`]).flat(),
    ].join(";");
    return new NextResponse(headers + "\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"atacado_modelo.csv\"",
      },
    });
  }

  const { data: variations } = await supabase
    .from("ml_variations")
    .select("item_id, variation_id, price, seller_custom_field, attributes_json, raw_json")
    .eq("account_id", accountId)
    .in("item_id", itemIds);

  const { data: drafts } = await supabase
    .from("wholesale_drafts")
    .select("item_id, variation_id, tiers_json")
    .eq("account_id", accountId)
    .in("item_id", itemIds);

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
  ): string {
    if (variation) {
      if (variation.seller_custom_field) return escapeCsv(variation.seller_custom_field);
      const raw = variation.raw_json as Record<string, unknown> | null;
      if (raw) {
        const fromAttrs = extractSkuFromAttributes(raw.attributes);
        if (fromAttrs) return escapeCsv(fromAttrs);
        if (raw.seller_custom_field) return escapeCsv(String(raw.seller_custom_field));
      }
      const attr = variation.attributes_json;
      if (Array.isArray(attr)) {
        const skuAttr = attr.find((a: { id?: string }) => a?.id === "SELLER_SKU" || a?.id === "SKU" || a?.id === "CUSTOM_SKU");
        if (skuAttr && typeof skuAttr === "object" && "value_name" in skuAttr) return escapeCsv(String((skuAttr as { value_name?: string }).value_name ?? ""));
      }
    }
    if (item.seller_custom_field) return escapeCsv(item.seller_custom_field);
    const raw = item.raw_json as Record<string, unknown> | null;
    if (raw) {
      const fromAttrs = extractSkuFromAttributes(raw.attributes);
      if (fromAttrs) return escapeCsv(fromAttrs);
      if (raw.seller_custom_field) return escapeCsv(String(raw.seller_custom_field));
    }
    return "";
  }

  const SEP = ";";
  function escapeCsv(v: string): string {
    if (v.includes(SEP) || v.includes('"') || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  }

  const headers = [
    "item_id",
    "variation_id",
    "sku",
    "title",
    "price_atual",
    ...Array.from({ length: 5 }, (_, i) => [`tier${i + 1}_min_qty`, `tier${i + 1}_price`]).flat(),
  ];

  interface CsvRow { values: string[]; hasDraft: boolean }
  const dataRows: CsvRow[] = [];

  for (const item of items ?? []) {
    const itemVariations = (variations ?? []).filter((v) => v.item_id === item.item_id);

    if (item.has_variations && itemVariations.length > 0) {
      for (const v of itemVariations) {
        const key = `${item.item_id}:${v.variation_id}`;
        const tiers = draftsByKey.get(key) ?? [];
        const price = v.price != null ? Number(v.price) : item.price;
        const values = [
          escapeCsv(item.item_id),
          String(v.variation_id),
          getSku(item, v),
          escapeCsv(item.title ?? ""),
          price != null ? String(price) : "",
          ...Array.from({ length: 5 }, (_, i) => {
            const t = tiers[i];
            return t ? [String(t.min_qty), String(t.price)] : ["", ""];
          }).flat(),
        ];
        dataRows.push({ values, hasDraft: tiers.length > 0 });
      }
    } else {
      const key = `${item.item_id}:item`;
      const tiers = draftsByKey.get(key) ?? [];
      const values = [
        escapeCsv(item.item_id),
        "",
        getSku(item, null),
        escapeCsv(item.title ?? ""),
        item.price != null ? String(Number(item.price)) : "",
        ...Array.from({ length: 5 }, (_, i) => {
          const t = tiers[i];
          return t ? [String(t.min_qty), String(t.price)] : ["", ""];
        }).flat(),
      ];
      dataRows.push({ values, hasDraft: tiers.length > 0 });
    }
  }

  let filtered = dataRows;
  if (filter === "com_rascunho") filtered = dataRows.filter((r) => r.hasDraft);
  else if (filter === "sem_rascunho") filtered = dataRows.filter((r) => !r.hasDraft);

  const csvContent = [headers.join(SEP), ...filtered.map((r) => r.values.join(SEP))].join("\n");
  const bom = "\uFEFF";

  return new NextResponse(bom + csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"atacado_modelo.csv\"",
    },
  });
}
