import type { MLItemDetail, MLVariationDetail } from "./client";

export interface ItemDimensions {
  weight_kg: number | null;
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
}

const EMPTY: ItemDimensions = {
  weight_kg: null,
  height_cm: null,
  width_cm: null,
  length_cm: null,
};

function parseNumeric(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(",", ".").trim();
    const m = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Valores do ML em shipping.dimensions costumam vir em gramas; atributos podem vir em kg. */
function gramsToKg(value: number, forceFromGrams = false): number {
  if (forceFromGrams || value > 500) return Math.round((value / 1000) * 10000) / 10000;
  return value;
}

function parseShippingDimensions(shipping: unknown): ItemDimensions {
  if (!shipping || typeof shipping !== "object") return { ...EMPTY };
  const dims = (shipping as { dimensions?: unknown }).dimensions;
  if (typeof dims !== "string" || !dims.trim()) return { ...EMPTY };

  const parts = dims.split(",").map((p) => p.trim());
  if (parts.length < 2) return { ...EMPTY };

  const sizePart = parts[0];
  const weightRaw = parseNumeric(parts[1]);
  const sizeTokens = sizePart.split(/x/i).map((t) => parseNumeric(t.trim()));
  if (sizeTokens.length < 3 || sizeTokens.some((t) => t == null)) {
    return {
      ...EMPTY,
      weight_kg: weightRaw != null ? gramsToKg(weightRaw, true) : null,
    };
  }

  const [height, width, length] = sizeTokens as [number, number, number];
  return {
    height_cm: height,
    width_cm: width,
    length_cm: length,
    weight_kg: weightRaw != null ? gramsToKg(weightRaw, true) : null,
  };
}

type MlAttribute = {
  id?: string;
  value_name?: string | null;
  value_struct?: { number?: number; unit?: string } | null;
};

const DIM_ATTR: Record<keyof Omit<ItemDimensions, never>, string[]> = {
  height_cm: ["PACKAGE_HEIGHT", "HEIGHT", "SELLER_PACKAGE_HEIGHT"],
  width_cm: ["PACKAGE_WIDTH", "WIDTH", "SELLER_PACKAGE_WIDTH"],
  length_cm: ["PACKAGE_LENGTH", "LENGTH", "SELLER_PACKAGE_LENGTH", "PACKAGE_DEPTH", "DEPTH"],
  weight_kg: ["PACKAGE_WEIGHT", "WEIGHT", "SELLER_PACKAGE_WEIGHT", "PRODUCT_WEIGHT"],
};

function attrValue(attr: MlAttribute): number | null {
  const struct = attr.value_struct;
  if (struct && typeof struct.number === "number" && Number.isFinite(struct.number)) {
    const unit = (struct.unit ?? "").toLowerCase();
    if (attr.id && DIM_ATTR.weight_kg.includes(attr.id) && (unit === "g" || unit === "gram" || unit === "grams")) {
      return gramsToKg(struct.number, true);
    }
    return struct.number;
  }
  return parseNumeric(attr.value_name);
}

function parseAttributesDimensions(attributes: unknown): ItemDimensions {
  if (!Array.isArray(attributes)) return { ...EMPTY };
  const attrs = attributes as MlAttribute[];
  const out: ItemDimensions = { ...EMPTY };

  for (const [field, ids] of Object.entries(DIM_ATTR) as [keyof ItemDimensions, string[]][]) {
    const attr = attrs.find((a) => a.id && ids.includes(a.id));
    if (!attr) continue;
    let n = attrValue(attr);
    if (n == null) continue;
    if (field === "weight_kg" && n > 500) n = gramsToKg(n, true);
    out[field] = n;
  }
  return out;
}

function mergeDimensions(...sources: ItemDimensions[]): ItemDimensions {
  const out: ItemDimensions = { ...EMPTY };
  for (const src of sources) {
    if (out.height_cm == null && src.height_cm != null) out.height_cm = src.height_cm;
    if (out.width_cm == null && src.width_cm != null) out.width_cm = src.width_cm;
    if (out.length_cm == null && src.length_cm != null) out.length_cm = src.length_cm;
    if (out.weight_kg == null && src.weight_kg != null) out.weight_kg = src.weight_kg;
  }
  return out;
}

/** Extrai medidas e peso do payload do item ML (shipping.dimensions e atributos PACKAGE_*). */
export function extractItemDimensions(item: MLItemDetail): ItemDimensions {
  const fromShipping = parseShippingDimensions(item.shipping);
  const fromAttrs = parseAttributesDimensions(
    (item as { attributes?: unknown }).attributes
  );
  return mergeDimensions(fromShipping, fromAttrs);
}

/** Dimensões de variação (atributos da variação). */
export function extractVariationDimensions(variation: MLVariationDetail): ItemDimensions {
  return parseAttributesDimensions(variation.attributes);
}
