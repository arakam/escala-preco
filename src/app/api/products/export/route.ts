import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 1000;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  type ProductExportRow = {
    sku: string;
    title: string | null;
    description: string | null;
    ean: string | null;
    height: number | null;
    width: number | null;
    length: number | null;
    weight: number | null;
    cost_price: number | null;
    fixed_expenses: number | null;
  };

  const products: ProductExportRow[] = [];
  let from = 0;
  while (true) {
    const { data: chunk, error } = await supabase
      .from("products")
      .select("sku, title, description, ean, height, width, length, weight, cost_price, fixed_expenses")
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

  const headers = ["SKU", "Titulo", "Descricao", "EAN", "Altura", "Largura", "Comprimento", "Peso", "PrecoCusto", "DespFixas"];
  
  const escapeCSV = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (str.includes(";") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = (products ?? []).map((p) => [
    escapeCSV(p.sku),
    escapeCSV(p.title),
    escapeCSV(p.description),
    escapeCSV(p.ean),
    escapeCSV(p.height),
    escapeCSV(p.width),
    escapeCSV(p.length),
    escapeCSV(p.weight),
    escapeCSV(p.cost_price),
    escapeCSV(p.fixed_expenses),
  ].join(";"));

  const csv = [headers.join(";"), ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="produtos_${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
