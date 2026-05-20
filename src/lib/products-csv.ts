import { NextResponse } from "next/server";

/** Separador de colunas (padrão BR). Tags dentro da célula usam vírgula, não `;`. */
export const PRODUCT_CSV_SEPARATOR = ";";

/** BOM UTF-8 para Excel no Windows abrir acentos (ç, ã, é) corretamente. */
export const PRODUCT_CSV_UTF8_BOM = "\uFEFF";

/** Ordem e rótulos oficiais — export, modelo e importação devem seguir isto. */
export const PRODUCT_CSV_COLUMNS = [
  { header: "SKU", key: "sku" },
  { header: "Titulo", key: "titulo" },
  { header: "Descricao", key: "descricao" },
  { header: "Fornecedor", key: "fornecedor" },
  { header: "EAN", key: "ean" },
  { header: "Altura", key: "altura" },
  { header: "Largura", key: "largura" },
  { header: "Comprimento", key: "comprimento" },
  { header: "Peso", key: "peso" },
  { header: "PrecoCusto", key: "precocusto" },
  { header: "Imposto", key: "imposto" },
  { header: "TaxaExtra", key: "taxaextra" },
  { header: "DespFixas", key: "despfixas" },
  { header: "PMA", key: "pma" },
  { header: "Tags", key: "tags" },
] as const;

export const PRODUCT_CSV_HEADER_LINE = PRODUCT_CSV_COLUMNS.map((c) => c.header).join(
  PRODUCT_CSV_SEPARATOR
);

export const PRODUCT_CSV_CANONICAL_KEYS = PRODUCT_CSV_COLUMNS.map((c) => c.key);

export function escapeProductCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (
    str.includes(PRODUCT_CSV_SEPARATOR) ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r") ||
    str.includes(",")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Tags usam vírgula entre nomes — sempre entre aspas no CSV. */
export function escapeProductTagsCsvCell(tagsJoined: string): string {
  if (!tagsJoined.trim()) return "";
  return `"${tagsJoined.replace(/"/g, '""')}"`;
}

export function buildProductCsvContent(dataRows: string[]): string {
  return (
    PRODUCT_CSV_UTF8_BOM +
    [PRODUCT_CSV_HEADER_LINE, ...dataRows].join("\n") +
    "\n"
  );
}

export function productCsvDownloadResponse(
  csvBody: string,
  filename: string
): NextResponse {
  return new NextResponse(csvBody, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/** Linha de exemplo do modelo (com acentos para validar encoding). */
export const PRODUCT_CSV_TEMPLATE_EXAMPLE_ROW: string[] = [
  "SKU-001",
  "Produto Exemplo com Açúcar",
  "Descrição opcional do item",
  "Fornecedor Exemplo Ltda",
  "7891234567890",
  "10",
  "20",
  "30",
  "0.5",
  "50.00",
  "10.5",
  "5.0",
  "2.00",
  "99.90",
  "full, queima estoque",
];
