import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchAllTagsGroupedByProductIdForUser,
  fetchTagsGroupedByProductId,
  formatTagsForCsv,
} from "@/lib/product-tags";
import {
  buildProductCsvContent,
  escapeProductCsvCell,
  escapeProductTagsCsvCell,
  productCsvDownloadResponse,
} from "@/lib/products-csv";

const PAGE_SIZE = 1000;

export const maxDuration = 120;

type ProductExportRow = {
  id: string;
  sku: string;
  title: string | null;
  description: string | null;
  supplier: string | null;
  ean: string | null;
  height: number | null;
  width: number | null;
  length: number | null;
  weight: number | null;
  cost_price: number | null;
  tax_percent: number | null;
  extra_fee_percent: number | null;
  fixed_expenses: number | null;
  pma: number | null;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const products: ProductExportRow[] = [];
    let from = 0;
    while (true) {
      const { data: chunk, error } = await supabase
        .from("products")
        .select(
          "id, sku, title, description, supplier, ean, height, width, length, weight, cost_price, tax_percent, extra_fee_percent, fixed_expenses, pma"
        )
        .eq("user_id", user.id)
        .order("sku", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.error("Erro ao exportar produtos:", error);
        return NextResponse.json({ error: "Erro ao exportar produtos" }, { status: 500 });
      }
      const list = (chunk ?? []) as ProductExportRow[];
      products.push(...list);
      if (list.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    const tagMap =
      products.length > 500
        ? await fetchAllTagsGroupedByProductIdForUser(supabase, user.id)
        : await fetchTagsGroupedByProductId(
            supabase,
            products.map((p) => p.id)
          );

    const rows = products.map((p) => {
      const tagsStr = formatTagsForCsv(tagMap.get(p.id) ?? []);
      return [
        escapeProductCsvCell(p.sku),
        escapeProductCsvCell(p.title),
        escapeProductCsvCell(p.description),
        escapeProductCsvCell(p.supplier),
        escapeProductCsvCell(p.ean),
        escapeProductCsvCell(p.height),
        escapeProductCsvCell(p.width),
        escapeProductCsvCell(p.length),
        escapeProductCsvCell(p.weight),
        escapeProductCsvCell(p.cost_price),
        escapeProductCsvCell(p.tax_percent),
        escapeProductCsvCell(p.extra_fee_percent),
        escapeProductCsvCell(p.fixed_expenses),
        escapeProductCsvCell(p.pma),
        escapeProductTagsCsvCell(tagsStr),
      ].join(";");
    });

    const csv = buildProductCsvContent(rows);
    const filename = `produtos_${new Date().toISOString().split("T")[0]}.csv`;
    return productCsvDownloadResponse(csv, filename);
  } catch (e) {
    console.error("Erro ao exportar produtos:", e);
    const msg = e instanceof Error ? e.message : "Erro ao exportar produtos";
    return NextResponse.json({ error: msg || "Erro ao exportar produtos" }, { status: 500 });
  }
}
