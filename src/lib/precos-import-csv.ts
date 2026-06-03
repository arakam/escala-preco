/**
 * Parser de CSV para importação de preços planejados (Preço Calculado) ou margem alvo na Calculadora de Preços.
 * Referência principal: coluna MLB (item_id). Aceita o modelo mínimo ou o CSV exportado pela própria tela.
 */

const SEP = ";";

export const PRECOS_IMPORT_CSV_TEMPLATE_HEADER = "MLB;Variacao;Preco Calculado;Margem %";

export type PrecosImportUpdateMode = "promocao" | "margem";

export interface PrecosImportRowValid {
  item_id: string;
  variation_id: number | null;
  mode: PrecosImportUpdateMode;
  promocao?: number;
  margem_percent?: number;
}

export interface PrecosImportRowError {
  row: number;
  field?: string;
  message: string;
}

export interface PrecosImportPreviewRow {
  row: number;
  item_id: string;
  variation_id: string;
  promocao: string;
  margem: string;
  mode: PrecosImportUpdateMode | "";
  valid: boolean;
  error?: string;
}

export interface PrecosImportParseResult {
  ok: boolean;
  headerError?: string;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  errors: PrecosImportRowError[];
  /** Verdadeiro quando há mais erros do que o limite retornado na lista `errors`. */
  errors_truncated?: boolean;
  preview: PrecosImportPreviewRow[];
  valid_items: PrecosImportRowValid[];
}

function decodeCsvBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const start = hasBom ? 3 : 0;
  return new TextDecoder("utf-8").decode(bytes.subarray(start));
}

function splitLine(line: string): string[] {
  return line.split(SEP).map((c) => c.trim());
}

function unquoteCsvCell(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/""/g, '"');
  }
  return t;
}

function normalizeHeader(value: string): string {
  return unquoteCsvCell(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function parseDecimalBr(value: string): number {
  const raw = unquoteCsvCell(value).trim().replace(/\s/g, "").replace(/%/g, "");
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

function looksLikeCommaSeparated(headerLine: string): boolean {
  const bySemicolon = headerLine.split(SEP).length;
  const byComma = headerLine.split(",").length;
  return byComma >= 3 && bySemicolon < 3;
}

type ColumnMap = {
  mlb: number;
  variacao: number | null;
  promocao: number | null;
  margem: number | null;
};

function resolveColumnMap(headers: string[]): { map: ColumnMap | null; error?: string } {
  const normalized = headers.map(normalizeHeader);

  const findIndex = (aliases: string[]): number | null => {
    for (const alias of aliases) {
      const idx = normalized.indexOf(alias);
      if (idx >= 0) return idx;
    }
    return null;
  };

  const mlb = findIndex(["mlb", "item_id"]);
  if (mlb == null) {
    return { map: null, error: "Coluna MLB (ou item_id) não encontrada no cabeçalho." };
  }

  const promocao = findIndex([
    "preco calculado",
    "preço calculado",
    "promocao",
    "promoção",
  ]);
  const margem = findIndex(["margem %", "margem", "margem_percent", "margem percentual"]);
  if (promocao == null && margem == null) {
    return {
      map: null,
      error: "Informe ao menos uma coluna Preço Calculado (ou Promocao) ou Margem % no cabeçalho.",
    };
  }

  const variacao = findIndex(["variacao", "variação", "variation_id"]);

  return {
    map: {
      mlb,
      variacao,
      promocao,
      margem,
    },
  };
}

function cell(cols: string[], index: number | null): string {
  if (index == null) return "";
  return cols[index] ?? "";
}

function listingKey(itemId: string, variationId: number | null): string {
  return `${itemId.trim().toUpperCase()}:${variationId ?? "n"}`;
}

/**
 * Parseia CSV de importação de preços. Delimitador fixo ";". Colunas identificadas pelo cabeçalho.
 */
export function parsePrecosImportCsv(buffer: ArrayBuffer): PrecosImportParseResult {
  const text = decodeCsvBuffer(buffer);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const result: PrecosImportParseResult = {
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

  const headerCols = splitLine(headerLine);
  const { map, error: headerMapError } = resolveColumnMap(headerCols);
  if (!map) {
    result.headerError = headerMapError ?? "Cabeçalho inválido";
    return result;
  }

  const dataLines = lines.slice(1);
  result.total_rows = dataLines.length;

  const errors: PrecosImportRowError[] = [];
  const validItems: PrecosImportRowValid[] = [];
  const previewRows: PrecosImportPreviewRow[] = [];
  const seenKeys = new Set<string>();
  const PREVIEW_MAX = 20;
  /** Limite de erros detalhados no retorno (evita JSON/state gigante em CSVs com muitas linhas inválidas). */
  const ERRORS_MAX = 250;
  const pushError = (err: PrecosImportRowError) => {
    if (errors.length < ERRORS_MAX) errors.push(err);
  };

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    const rowNum = i + 2;
    const cols = splitLine(line);

    const preview: PrecosImportPreviewRow = {
      row: rowNum,
      item_id: cell(cols, map.mlb),
      variation_id: cell(cols, map.variacao),
      promocao: cell(cols, map.promocao),
      margem: cell(cols, map.margem),
      mode: "",
      valid: false,
    };

    const itemId = unquoteCsvCell(cell(cols, map.mlb)).trim().toUpperCase();

    if (!itemId) {
      pushError({ row: rowNum, field: "MLB", message: "MLB obrigatório" });
      preview.error = "MLB obrigatório";
      if (previewRows.length < PREVIEW_MAX) previewRows.push(preview);
      continue;
    }

    if (!itemId.startsWith("MLB")) {
      pushError({ row: rowNum, field: "MLB", message: "MLB deve começar com MLB" });
      preview.error = "MLB inválido";
      if (previewRows.length < PREVIEW_MAX) previewRows.push(preview);
      continue;
    }

    let variationId: number | null = null;
    const rawVar = unquoteCsvCell(cell(cols, map.variacao)).trim();
    if (rawVar !== "") {
      const n = parseInt(rawVar, 10);
      if (Number.isNaN(n) || n < 0) {
        pushError({ row: rowNum, field: "Variacao", message: "Variacao deve ser número inteiro ou vazio" });
        preview.error = "Variacao inválida";
        if (previewRows.length < PREVIEW_MAX) previewRows.push(preview);
        continue;
      }
      variationId = n;
    }

    const promocaoRaw = unquoteCsvCell(cell(cols, map.promocao)).trim();
    const margemRaw = unquoteCsvCell(cell(cols, map.margem)).trim();
    const promocao = promocaoRaw !== "" ? parseDecimalBr(promocaoRaw) : Number.NaN;
    const margem = margemRaw !== "" ? parseDecimalBr(margemRaw) : Number.NaN;

    const hasPromocao = promocaoRaw !== "" && Number.isFinite(promocao) && promocao >= 0;
    const hasMargem = margemRaw !== "" && Number.isFinite(margem);

    if (promocaoRaw !== "" && !hasPromocao) {
      pushError({
        row: rowNum,
        field: "Preço Calculado",
        message: "Preço Calculado inválido (use vírgula para decimais, ex: 99,90)",
      });
      preview.error = "Preço Calculado inválido";
      if (previewRows.length < PREVIEW_MAX) previewRows.push(preview);
      continue;
    }

    if (margemRaw !== "" && !hasMargem) {
      pushError({ row: rowNum, field: "Margem %", message: "Margem % inválida (ex: 25 ou 25,5)" });
      preview.error = "Margem % inválida";
      if (previewRows.length < PREVIEW_MAX) previewRows.push(preview);
      continue;
    }

    if (!hasPromocao && !hasMargem) {
      pushError({
        row: rowNum,
        field: "Preço Calculado/Margem %",
        message: "Informe Preço Calculado ou Margem % para atualizar o anúncio",
      });
      preview.error = "Preço Calculado ou Margem % obrigatório";
      if (previewRows.length < PREVIEW_MAX) previewRows.push(preview);
      continue;
    }

    const mode: PrecosImportUpdateMode = hasPromocao ? "promocao" : "margem";
    preview.mode = mode;

    const key = listingKey(itemId, variationId);
    if (seenKeys.has(key)) {
      pushError({ row: rowNum, field: "MLB", message: "MLB + Variacao duplicado no arquivo" });
      preview.error = "Duplicado no CSV";
      if (previewRows.length < PREVIEW_MAX) previewRows.push(preview);
      continue;
    }
    seenKeys.add(key);

    preview.valid = true;
    if (previewRows.length < PREVIEW_MAX) previewRows.push(preview);

    validItems.push({
      item_id: itemId,
      variation_id: variationId,
      mode,
      ...(hasPromocao ? { promocao: Math.round(promocao * 100) / 100 } : {}),
      ...(hasMargem && !hasPromocao ? { margem_percent: Math.round(margem * 100) / 100 } : {}),
    });
  }

  result.errors = errors;
  result.errors_truncated = errors.length >= ERRORS_MAX;
  result.valid_rows = validItems.length;
  result.error_rows = result.total_rows - validItems.length;
  result.preview = previewRows;
  result.valid_items = validItems;
  result.ok = result.headerError == null;
  return result;
}
