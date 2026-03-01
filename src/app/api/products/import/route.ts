import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface ParsedProduct {
  sku: string;
  title: string;
  description: string | null;
  ean: string | null;
  height: number | null;
  width: number | null;
  length: number | null;
  weight: number | null;
  cost_price: number | null;
  sale_price: number | null;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ";" || char === ",") {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }
  result.push(current.trim());
  return result;
}

function parseNumber(value: string, maxValue: number = 99999999): number | null {
  if (!value || value.trim() === "") return null;
  const num = parseFloat(value.replace(",", "."));
  if (isNaN(num)) return null;
  if (Math.abs(num) > maxValue) return null;
  return num;
}

function parseDimension(value: string): number | null {
  return parseNumber(value, 99999999);
}

function parsePrice(value: string): number | null {
  return parseNumber(value, 9999999999);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const mode = formData.get("mode") as string || "upsert";

  if (!file) {
    return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });
  }

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((line) => line.trim());

  if (lines.length < 2) {
    return NextResponse.json(
      { error: "Arquivo CSV deve ter cabeçalho e pelo menos uma linha de dados" },
      { status: 400 }
    );
  }

  const headerLine = lines[0].toLowerCase();
  const headers = parseCSVLine(headerLine);
  
  const colIndex = {
    sku: headers.findIndex((h) => h === "sku"),
    title: headers.findIndex((h) => h === "titulo" || h === "title"),
    description: headers.findIndex((h) => h === "descricao" || h === "description"),
    ean: headers.findIndex((h) => h === "ean"),
    height: headers.findIndex((h) => h === "altura" || h === "height"),
    width: headers.findIndex((h) => h === "largura" || h === "width"),
    length: headers.findIndex((h) => h === "comprimento" || h === "length"),
    weight: headers.findIndex((h) => h === "peso" || h === "weight"),
    cost_price: headers.findIndex((h) => h === "precocusto" || h === "cost_price" || h === "custo"),
    sale_price: headers.findIndex((h) => h === "precovenda" || h === "sale_price" || h === "venda" || h === "preco"),
  };

  if (colIndex.sku === -1 || colIndex.title === -1) {
    return NextResponse.json(
      { error: "CSV deve conter colunas SKU e Titulo" },
      { status: 400 }
    );
  }

  const products: ParsedProduct[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const sku = values[colIndex.sku]?.trim();
    const title = values[colIndex.title]?.trim();

    if (!sku || !title) {
      errors.push(`Linha ${i + 1}: SKU e Título são obrigatórios`);
      continue;
    }

    products.push({
      sku,
      title,
      description: colIndex.description >= 0 ? values[colIndex.description]?.trim() || null : null,
      ean: colIndex.ean >= 0 ? values[colIndex.ean]?.trim() || null : null,
      height: colIndex.height >= 0 ? parseDimension(values[colIndex.height]) : null,
      width: colIndex.width >= 0 ? parseDimension(values[colIndex.width]) : null,
      length: colIndex.length >= 0 ? parseDimension(values[colIndex.length]) : null,
      weight: colIndex.weight >= 0 ? parseDimension(values[colIndex.weight]) : null,
      cost_price: colIndex.cost_price >= 0 ? parsePrice(values[colIndex.cost_price]) : null,
      sale_price: colIndex.sale_price >= 0 ? parsePrice(values[colIndex.sale_price]) : null,
    });
  }

  if (products.length === 0) {
    return NextResponse.json(
      { error: "Nenhum produto válido encontrado no CSV", details: errors },
      { status: 400 }
    );
  }

  const uniqueProducts = new Map<string, ParsedProduct>();
  for (const product of products) {
    uniqueProducts.set(product.sku.toLowerCase(), product);
  }
  
  const deduplicatedProducts = Array.from(uniqueProducts.values());
  const duplicatesRemoved = products.length - deduplicatedProducts.length;

  const productsWithUser = deduplicatedProducts.map((p) => ({
    ...p,
    user_id: user.id,
  }));

  const { error } = await supabase.from("products").upsert(productsWithUser, {
    onConflict: "user_id,sku",
    ignoreDuplicates: mode === "skip",
  });

  if (error) {
    console.error("Erro ao importar produtos:", error);
    return NextResponse.json(
      { error: "Erro ao importar produtos", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    imported: deduplicatedProducts.length,
    duplicatesRemoved,
    errors: errors.length > 0 ? errors : undefined,
  });
}
