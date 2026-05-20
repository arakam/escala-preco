import {
  buildProductCsvContent,
  escapeProductCsvCell,
  escapeProductTagsCsvCell,
  PRODUCT_CSV_TEMPLATE_EXAMPLE_ROW,
  productCsvDownloadResponse,
} from "@/lib/products-csv";

export async function GET() {
  const row = PRODUCT_CSV_TEMPLATE_EXAMPLE_ROW.map((cell, idx) =>
    idx === PRODUCT_CSV_TEMPLATE_EXAMPLE_ROW.length - 1
      ? escapeProductTagsCsvCell(cell)
      : escapeProductCsvCell(cell)
  ).join(";");

  const csv = buildProductCsvContent([row]);
  return productCsvDownloadResponse(csv, "modelo_produtos.csv");
}
