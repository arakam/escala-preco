/**
 * Parser de CSV de importação de preços de atacado.
 * Formato OFICIAL: separador SEMPRE ";", cabeçalho exato, sem autodetecção.
 * Após importar, só atacado1…atacado5 persistem em wholesale_drafts; preco_atual e promocao são só informativas no arquivo.
 */

import { validateTiers, type Tier } from "./atacado";

/** Cabeçalho exato em uma única linha (separador ;). `promocao` = preço da calculadora (somente leitura na importação). */
export const CSV_HEADER_EXACT =
  "item_id;variation_id;sku;titulo;preco_atual;promocao;atacado1_qtd_min;atacado1_preco;atacado2_qtd_min;atacado2_preco;atacado3_qtd_min;atacado3_preco;atacado4_qtd_min;atacado4_preco;atacado5_qtd_min;atacado5_preco";

const SEP = ";";
const EXPECTED_COLUMNS = 16;

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
  /** Valor da coluna promocao no CSV (não é gravado no import — só Atacado 1–5 atualizam rascunho). */
  promocao: string;
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

/** Remove aspas duplas ao redor do valor (Excel/CSV colocam em campos com vírgula). */
function unquoteCsvCell(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/""/g, '"');
  }
  return t;
}

/**
 * Converte string de preço para número aceitando:
 * - BR: 394,85 ou 1.234,56
 * - US: 394.85
 * - Inteiro: 394
 */
function parsePriceBr(value: string): number {
  const raw = unquoteCsvCell(value).trim().replace(/\s/g, "");
  if (raw === "") return Number.NaN;
  const s = raw.replace(/^["']|["']$/g, "");
  if (s === "") return Number.NaN;
  if (s.includes(",")) {
    const br = s.replace(/\./g, "").replace(",", ".");
    return parseFloat(br);
  }
  const n = parseFloat(s);
  return Number.isNaN(n) ? Number.NaN : n;
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
      promocao: cols[5] ?? "",
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
      const base = 6 + t * 2;
      const minQtyStr = unquoteCsvCell(cols[base] ?? "");
      const priceStr = unquoteCsvCell(cols[base + 1] ?? "");
      if (minQtyStr === "" && priceStr === "") continue;
      const minQty = parseInt(minQtyStr, 10);
      const price = parsePriceBr(priceStr);
      if (Number.isNaN(minQty) || Number.isNaN(price)) {
        errors.push({
          row: rowNum,
          field: `atacado${t + 1}`,
          message: `Atacado ${t + 1}: quantidade mínima e preço devem ser números (use vírgula para decimais, ex: 10,50)`,
        });
        break;
      }
      tiers.push({ min_qty: minQty, price });
    }

    preview.tiers = [...tiers];

    const tierErrors = validateTiers(tiers);
    if (tierErrors.length > 0) {
      errors.push({ row: rowNum, field: "atacados", message: tierErrors[0] });
      preview.error = tierErrors[0];
      if (previewRows.length < PREVIEW_MAX) previewRows.push(preview);
      continue;
    }

    if (tiers.length === 0) {
      errors.push({
        row: rowNum,
        field: "atacados",
        message: "Pelo menos um atacado (quantidade mínima e preço) é obrigatório",
      });
      preview.error = "Pelo menos um atacado obrigatório";
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
