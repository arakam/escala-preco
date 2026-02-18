/**
 * Parser de CSV de importação de preços de atacado.
 * Formato OFICIAL: separador SEMPRE ";", cabeçalho exato, sem autodetecção.
 */

import { validateTiers, type Tier } from "./atacado";

/** Cabeçalho exato em uma única linha (separador ;) */
export const CSV_HEADER_EXACT =
  "item_id;variation_id;sku;title;price_atual;tier1_min_qty;tier1_price;tier2_min_qty;tier2_price;tier3_min_qty;tier3_price;tier4_min_qty;tier4_price;tier5_min_qty;tier5_price";

const SEP = ";";
const EXPECTED_COLUMNS = 15;

export interface ImportRowParsed {
  item_id: string;
  variation_id: number | null;
  sku: string;
  title: string;
  price_atual: string;
  tiers: Tier[];
}

export interface ImportRowValid {
  item_id: string;
  variation_id: number | null;
  tiers: Tier[];
}

export interface ImportRowError {
  row: number;
  field?: string;
  message: string;
}

export interface ImportPreviewRow {
  row: number;
  item_id: string;
  variation_id: string;
  sku: string;
  title: string;
  price_atual: string;
  tiers: Tier[];
  valid: boolean;
  error?: string;
}

export interface ImportParseResult {
  ok: boolean;
  headerError?: string;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  errors: ImportRowError[];
  preview: ImportPreviewRow[];
  valid_items: ImportRowValid[];
}

/**
 * Decodifica buffer para string (UTF-8), removendo BOM se existir.
 */
function decodeCsvBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const start = hasBom ? 3 : 0;
  return new TextDecoder("utf-8").decode(bytes.subarray(start));
}

/**
 * Divide linha CSV por ";" (não trata aspas para manter regras rígidas).
 */
function splitLine(line: string): string[] {
  return line.split(SEP).map((c) => c.trim());
}

/**
 * Verifica se o arquivo parece usar vírgula como separador.
 */
function looksLikeCommaSeparated(headerLine: string): boolean {
  const bySemicolon = headerLine.split(SEP).length;
  const byComma = headerLine.split(",").length;
  return byComma >= EXPECTED_COLUMNS && bySemicolon < EXPECTED_COLUMNS;
}

/**
 * Parseia e valida CSV de atacado. Delimitador FIXO ";".
 * Retorna preview (primeiras 20 linhas), erros por linha e itens válidos.
 */
export function parseWholesaleCsv(buffer: ArrayBuffer): ImportParseResult {
  const text = decodeCsvBuffer(buffer);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const result: ImportParseResult = {
    ok: false,
    total_rows: 0,
    valid_rows: 0,
    error_rows: 0,
    errors: [],
    preview: [],
    valid_items: [],
  };

  if (lines.length === 0) {
    result.headerError = "Arquivo vazio";
    return result;
  }

  const headerLine = lines[0];
  if (looksLikeCommaSeparated(headerLine)) {
    result.headerError = "CSV deve usar separador ; (ponto e vírgula), não vírgula.";
    return result;
  }

  if (headerLine !== CSV_HEADER_EXACT) {
    result.headerError = `Cabeçalho inválido. Esperado exatamente: ${CSV_HEADER_EXACT}`;
    return result;
  }

  const dataLines = lines.slice(1);
  result.total_rows = dataLines.length;

  const errors: ImportRowError[] = [];
  const validItems: ImportRowValid[] = [];
  const previewRows: ImportPreviewRow[] = [];
  const PREVIEW_MAX = 20;

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    const rowNum = i + 2; // 1-based + header
    const cols = splitLine(line);

    const preview: ImportPreviewRow = {
      row: rowNum,
      item_id: cols[0] ?? "",
      variation_id: (cols[1] ?? "").trim(),
      sku: cols[2] ?? "",
      title: cols[3] ?? "",
      price_atual: cols[4] ?? "",
      tiers: [],
      valid: false,
    };

    if (cols.length !== EXPECTED_COLUMNS) {
      errors.push({ row: rowNum, field: "linha", message: `Esperadas ${EXPECTED_COLUMNS} colunas (separador ;), encontradas ${cols.length}` });
      preview.error = `Colunas: esperado ${EXPECTED_COLUMNS}, encontrado ${cols.length}`;
      if (previewRows.length < PREVIEW_MAX) previewRows.push(preview);
      continue;
    }

    const itemId = (cols[0] ?? "").trim();
    if (!itemId) {
      errors.push({ row: rowNum, field: "item_id", message: "item_id obrigatório" });
      preview.error = "item_id obrigatório";
      if (previewRows.length < PREVIEW_MAX) previewRows.push(preview);
      continue;
    }

    let variationId: number | null = null;
    const rawVar = (cols[1] ?? "").trim();
    if (rawVar !== "") {
      const n = parseInt(rawVar, 10);
      if (Number.isNaN(n) || n < 0) {
        errors.push({ row: rowNum, field: "variation_id", message: "variation_id deve ser número inteiro ou vazio" });
        preview.error = "variation_id inválido";
        if (previewRows.length < PREVIEW_MAX) previewRows.push(preview);
        continue;
      }
      variationId = n;
    }

    const tiers: Tier[] = [];
    for (let t = 0; t < 5; t++) {
      const base = 5 + t * 2;
      const minQtyStr = (cols[base] ?? "").trim();
      const priceStr = (cols[base + 1] ?? "").trim();
      if (minQtyStr === "" && priceStr === "") continue;
      const minQty = parseInt(minQtyStr, 10);
      const price = parseFloat(priceStr.replace(",", "."));
      if (Number.isNaN(minQty) || Number.isNaN(price)) {
        errors.push({ row: rowNum, field: `tier${t + 1}`, message: `Tier ${t + 1}: min_qty e price devem ser números` });
        break;
      }
      tiers.push({ min_qty: minQty, price });
    }

    preview.tiers = [...tiers];

    const tierErrors = validateTiers(tiers);
    if (tierErrors.length > 0) {
      errors.push({ row: rowNum, field: "tiers", message: tierErrors[0] });
      preview.error = tierErrors[0];
      if (previewRows.length < PREVIEW_MAX) previewRows.push(preview);
      continue;
    }

    if (tiers.length === 0) {
      errors.push({ row: rowNum, field: "tiers", message: "Pelo menos um tier (min_qty e price) é obrigatório" });
      preview.error = "Pelo menos um tier obrigatório";
      if (previewRows.length < PREVIEW_MAX) previewRows.push(preview);
      continue;
    }

    preview.valid = true;
    if (previewRows.length < PREVIEW_MAX) previewRows.push(preview);
    validItems.push({ item_id: itemId, variation_id: variationId, tiers });
  }

  result.errors = errors;
  result.valid_rows = validItems.length;
  result.error_rows = result.total_rows - validItems.length;
  result.preview = previewRows;
  result.valid_items = validItems;
  result.ok = result.headerError == null && result.total_rows >= 0;
  return result;
}
