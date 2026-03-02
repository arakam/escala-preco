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
  tax_percent: number | null;
  extra_fee_percent: number | null;
}

function detectSeparator(headerLine: string): string {
  const semicolonCount = (headerLine.match(/;/g) || []).length;
  const commaCount = (headerLine.match(/,/g) || []).length;
  return semicolonCount >= commaCount ? ";" : ",";
}

function parseCSVLine(line: string, separator: string): string[] {
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
      } else if (char === separator) {
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
  const cleaned = value.trim().replace(/\s/g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  if (Math.abs(num) > maxValue) return null;
  return Math.round(num * 100) / 100;
}

function parseDimension(value: string): number | null {
  return parseNumber(value, 99999999);
}

function parsePrice(value: string): number | null {
  return parseNumber(value, 9999999999);
}

const EXPECTED_HEADERS = ["sku", "titulo", "altura", "largura", "comprimento", "peso", "precocusto", "precovenda", "imposto", "taxaextra"];

const VALID_HEADER_ALIASES: Record<string, string[]> = {
  sku: ["sku"],
  titulo: ["titulo", "title", "nome"],
  altura: ["altura", "height"],
  largura: ["largura", "width"],
  comprimento: ["comprimento", "length", "profundidade"],
  peso: ["peso", "weight"],
  precocusto: ["precocusto", "cost_price", "custo", "preco_custo"],
  precovenda: ["precovenda", "sale_price", "venda", "preco", "preco_venda"],
  imposto: ["imposto", "tax_percent", "tax", "impostos"],
  taxaextra: ["taxaextra", "extra_fee_percent", "extra_fee", "taxa_extra", "extra"],
};

function normalizeHeader(header: string): string | null {
  const h = header.toLowerCase().trim().replace(/[^a-z0-9_]/g, "");
  for (const [canonical, aliases] of Object.entries(VALID_HEADER_ALIASES)) {
    if (aliases.includes(h)) {
      return canonical;
    }
  }
  return null;
}

function validateHeaders(headers: string[]): { valid: boolean; normalized: Map<string, number>; unknown: string[] } {
  const normalized = new Map<string, number>();
  const unknown: string[] = [];
  
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if (!header) continue;
    
    const normalizedName = normalizeHeader(header);
    if (normalizedName) {
      normalized.set(normalizedName, i);
    } else {
      unknown.push(header);
    }
  }
  
  const hasSku = normalized.has("sku");
  return { valid: hasSku, normalized, unknown };
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

  const separator = detectSeparator(lines[0]);
  const headerLine = lines[0].toLowerCase();
  const headers = parseCSVLine(headerLine, separator);
  
  const { valid, normalized, unknown } = validateHeaders(headers);
  
  if (!valid) {
    return NextResponse.json(
      { error: "CSV deve conter a coluna SKU. Colunas válidas: " + EXPECTED_HEADERS.join(", ") },
      { status: 400 }
    );
  }
  
  const colIndex = {
    sku: normalized.get("sku") ?? -1,
    title: normalized.get("titulo") ?? -1,
    height: normalized.get("altura") ?? -1,
    width: normalized.get("largura") ?? -1,
    length: normalized.get("comprimento") ?? -1,
    weight: normalized.get("peso") ?? -1,
    cost_price: normalized.get("precocusto") ?? -1,
    sale_price: normalized.get("precovenda") ?? -1,
    tax_percent: normalized.get("imposto") ?? -1,
    extra_fee_percent: normalized.get("taxaextra") ?? -1,
  };

  const products: ParsedProduct[] = [];
  const errors: string[] = [];
  
  if (unknown.length > 0) {
    errors.push(`Colunas ignoradas (não reconhecidas): ${unknown.join(", ")}`);
  }
  
  console.log(`[Import] Separador detectado: "${separator}", Colunas encontradas:`, Object.fromEntries(normalized));

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], separator);
    const sku = values[colIndex.sku]?.trim();
    const title = colIndex.title >= 0 ? values[colIndex.title]?.trim() : null;

    if (!sku) {
      errors.push(`Linha ${i + 1}: SKU é obrigatório`);
      continue;
    }

    products.push({
      sku,
      title: title || sku,
      description: null,
      ean: null,
      height: colIndex.height >= 0 ? parseDimension(values[colIndex.height]) : null,
      width: colIndex.width >= 0 ? parseDimension(values[colIndex.width]) : null,
      length: colIndex.length >= 0 ? parseDimension(values[colIndex.length]) : null,
      weight: colIndex.weight >= 0 ? parseDimension(values[colIndex.weight]) : null,
      cost_price: colIndex.cost_price >= 0 ? parsePrice(values[colIndex.cost_price]) : null,
      sale_price: colIndex.sale_price >= 0 ? parsePrice(values[colIndex.sale_price]) : null,
      tax_percent: colIndex.tax_percent >= 0 ? parseNumber(values[colIndex.tax_percent], 100) : null,
      extra_fee_percent: colIndex.extra_fee_percent >= 0 ? parseNumber(values[colIndex.extra_fee_percent], 100) : null,
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
