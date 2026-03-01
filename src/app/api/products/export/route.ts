import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data: products, error } = await supabase
    .from("products")
    .select("sku, title, description, ean, height, width, length, weight, cost_price, sale_price")
    .eq("user_id", user.id)
    .order("sku", { ascending: true });

  if (error) {
    console.error("Erro ao exportar produtos:", error);
    return NextResponse.json({ error: "Erro ao exportar produtos" }, { status: 500 });
  }

  const headers = ["SKU", "Titulo", "Descricao", "EAN", "Altura", "Largura", "Comprimento", "Peso", "PrecoCusto", "PrecoVenda"];
  
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
    escapeCSV(p.sale_price),
  ].join(";"));

  const csv = [headers.join(";"), ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="produtos_${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
