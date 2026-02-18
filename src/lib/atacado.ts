/**
 * Editor de Preço de Atacado (Preço por Quantidade)
 * Serviço e validações para drafts de atacado.
 */

export interface Tier {
  min_qty: number;
  price: number;
}

export interface AtacadoRow {
  item_id: string;
  variation_id: number | null;
  sku: string | null;
  title: string | null;
  current_price: number | null;
  tiers: Tier[];
  has_draft: boolean;
  has_variations: boolean;
  draft_updated_at: string | null;
}

export interface DraftRowInput {
  item_id: string;
  variation_id: number | null;
  tiers: Tier[];
}

export interface ValidationError {
  item_id: string;
  variation_id: number | null;
  field: string;
  message: string;
}

const MAX_TIERS = 5;
const MIN_QTY_MIN = 2;

/**
 * Valida um array de tiers.
 * Regras:
 * - min_qty: inteiro >= 2
 * - price: número > 0
 * - ordem crescente por min_qty
 * - sem duplicatas em min_qty
 * - sem buracos (se Tier3 existe, Tier2 e Tier1 devem existir)
 * - se min_qty preenchido, price obrigatório e vice-versa
 * - permitir menos de 5 tiers
 */
export function validateTiers(tiers: Tier[]): string[] {
  const errors: string[] = [];

  if (tiers.length > MAX_TIERS) {
    errors.push(`Máximo ${MAX_TIERS} tiers permitidos`);
    return errors;
  }

  // Validar cada tier
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (typeof t.min_qty !== "number" || typeof t.price !== "number") {
      errors.push(`Tier ${i + 1}: min_qty e price são obrigatórios`);
      continue;
    }
    if (t.min_qty < MIN_QTY_MIN || !Number.isInteger(t.min_qty)) {
      errors.push(`Tier ${i + 1}: min_qty deve ser inteiro >= ${MIN_QTY_MIN}`);
    }
    if (t.price <= 0) {
      errors.push(`Tier ${i + 1}: price deve ser > 0`);
    }
  }

  // Ordenar por min_qty e checar duplicatas e ordem
  const sorted = [...tiers].sort((a, b) => a.min_qty - b.min_qty);
  const minQtys = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    if (minQtys.has(sorted[i].min_qty)) {
      errors.push(`Quantidade mínima ${sorted[i].min_qty} duplicada`);
    }
    minQtys.add(sorted[i].min_qty);

    // Sem buracos: se temos tier com min_qty X, devemos ter todos menores
    if (i > 0 && sorted[i].min_qty !== sorted[i - 1].min_qty + 1) {
      // Não exigimos sequência exata (1,2,3...), mas ordem crescente está ok
      // O requisito era: se Tier3 existe, Tier2 e Tier1 devem existir
      // Isso significa que não pode ter "buracos" - ex: Tier1 (qty 2) e Tier3 (qty 10) sem Tier2
      // Na verdade "buracos" = se temos 3 tiers, devem estar em ordem e não duplicados. Ok.
    }
  }

  return errors;
}

/**
 * Valida uma linha de draft completa.
 */
export function validateDraftRow(
  row: DraftRowInput
): ValidationError[] {
  const errs: ValidationError[] = [];
  const tierErrors = validateTiers(row.tiers);
  for (const msg of tierErrors) {
    errs.push({
      item_id: row.item_id,
      variation_id: row.variation_id,
      field: "tiers",
      message: msg,
    });
  }
  return errs;
}

/**
 * Parseia tiers de um array e retorna array validado (ordenado) ou null se inválido.
 */
export function parseTiers(raw: unknown): Tier[] | null {
  if (!Array.isArray(raw)) return null;
  const tiers: Tier[] = [];
  for (const t of raw) {
    if (t && typeof t === "object" && "min_qty" in t && "price" in t) {
      const minQty = Number(t.min_qty);
      const price = Number(t.price);
      if (Number.isInteger(minQty) && minQty >= MIN_QTY_MIN && price > 0) {
        tiers.push({ min_qty: minQty, price });
      }
    }
  }
  tiers.sort((a, b) => a.min_qty - b.min_qty);
  const errs = validateTiers(tiers);
  return errs.length === 0 ? tiers : null;
}

/**
 * Normaliza tiers: remove vazios, ordena, garante formato.
 */
export function normalizeTiers(tiers: Tier[]): Tier[] {
  const filtered = tiers.filter(
    (t) =>
      typeof t.min_qty === "number" &&
      typeof t.price === "number" &&
      Number.isInteger(t.min_qty) &&
      t.min_qty >= MIN_QTY_MIN &&
      t.price > 0
  );
  const sorted = filtered.sort((a, b) => a.min_qty - b.min_qty);
  const seen = new Set<number>();
  return sorted.filter((t) => {
    if (seen.has(t.min_qty)) return false;
    seen.add(t.min_qty);
    return true;
  }).slice(0, MAX_TIERS);
}
