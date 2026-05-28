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

type MlAttribute = {
  id?: string;
  value_name?: string | null;
  value_struct?: { number?: number; unit?: string } | null;
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

function gramsToKg(grams: number): number {
  return Math.round((grams / 1000) * 10000) / 10000;
}

function findAttr(attributes: unknown, id: string): MlAttribute | undefined {
  if (!Array.isArray(attributes)) return undefined;
  return (attributes as MlAttribute[]).find((a) => a.id === id);
}

/** Converte valor + unidade do ML para kg (atributos number_unit). */
function weightKgFromUnit(number: number, unitRaw: string | undefined | null): number | null {
  if (!Number.isFinite(number)) return null;
  const unit = (unitRaw ?? "").toLowerCase().trim();
  if (unit === "g" || unit === "gram" || unit === "grams") return gramsToKg(number);
  if (unit === "kg" || unit === "kilogram" || unit === "kilograms") return number;
  if (unit === "mg") return gramsToKg(number / 1000);
  if (unit === "mcg") return gramsToKg(number / 1_000_000);
  if (unit === "lb") return Math.round(number * 0.453592 * 10000) / 10000;
  if (unit === "oz") return Math.round(number * 0.0283495 * 10000) / 10000;
  return null;
}

/** Interpreta value_name como peso (ex.: "340 g", "1.5 kg"). */
function weightKgFromValueName(valueName: string | null | undefined): number | null {
  if (!valueName?.trim()) return null;
  const s = valueName.trim().toLowerCase().replace(",", ".");
  const m =
    s.match(/^(-?\d+(?:\.\d+)?)\s*(mcg|mg|g|kg|oz|lb)\s*$/i) ??
    s.match(/(-?\d+(?:\.\d+)?)\s*(kg|g|mg|mcg|oz|lb)\b/i);
  if (!m) {
    const n = parseNumeric(s);
    return n != null && n > 0 ? n : null;
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return weightKgFromUnit(n, m[2]) ?? (m[2] ? null : n);
}

function weightKgFromAttribute(attr: MlAttribute, options: { forceGrams: boolean }): number | null {
  const struct = attr.value_struct;
  if (struct && typeof struct.number === "number" && Number.isFinite(struct.number)) {
    if (options.forceGrams) return gramsToKg(struct.number);
    const fromUnit = weightKgFromUnit(struct.number, struct.unit);
    if (fromUnit != null) return fromUnit;
    return struct.number;
  }
  if (options.forceGrams) {
    const n = parseNumeric(attr.value_name);
    return n != null ? gramsToKg(n) : null;
  }
  return weightKgFromValueName(attr.value_name);
}

/** Peso em gramas: shipping.dimensions (último segmento) ou SELLER_PACKAGE_WEIGHT; fallback PACKAGE_WEIGHT com unidade. */
export function extractWeightKgFromMlPayload(payload: {
  shipping?: unknown;
  attributes?: unknown;
}): number | null {
  if (payload.shipping && typeof payload.shipping === "object") {
    const dims = (payload.shipping as { dimensions?: unknown }).dimensions;
    if (typeof dims === "string" && dims.trim()) {
      const parts = dims.split(",").map((p) => p.trim());
      if (parts.length >= 2) {
        const weightRaw = parseNumeric(parts[1]);
        if (weightRaw != null) return gramsToKg(weightRaw);
      }
    }
  }

  const attrs = payload.attributes;
  const seller = findAttr(attrs, "SELLER_PACKAGE_WEIGHT");
  if (seller) {
    const w = weightKgFromAttribute(seller, { forceGrams: true });
    if (w != null) return w;
  }

  for (const id of ["PACKAGE_WEIGHT", "WEIGHT", "PRODUCT_WEIGHT"] as const) {
    const attr = findAttr(attrs, id);
    if (!attr) continue;
    const w = weightKgFromAttribute(attr, { forceGrams: false });
    if (w != null) return w;
  }

  return null;
}

const SELLER_SIZE_ATTR: Record<"height_cm" | "width_cm" | "length_cm", string> = {
  height_cm: "SELLER_PACKAGE_HEIGHT",
  width_cm: "SELLER_PACKAGE_WIDTH",
  length_cm: "SELLER_PACKAGE_LENGTH",
};

const PACKAGE_SIZE_ATTR: Record<"height_cm" | "width_cm" | "length_cm", string[]> = {
  height_cm: ["PACKAGE_HEIGHT", "HEIGHT"],
  width_cm: ["PACKAGE_WIDTH", "WIDTH"],
  length_cm: ["PACKAGE_LENGTH", "LENGTH", "PACKAGE_DEPTH", "DEPTH"],
};

function sizeCmFromAttribute(attr: MlAttribute): number | null {
  const struct = attr.value_struct;
  if (struct && typeof struct.number === "number" && Number.isFinite(struct.number)) {
    return struct.number;
  }
  return parseNumeric(attr.value_name);
}

function extractSizeDimensionsFromAttributes(attributes: unknown): Pick<
  ItemDimensions,
  "height_cm" | "width_cm" | "length_cm"
> {
  const out: Pick<ItemDimensions, "height_cm" | "width_cm" | "length_cm"> = {
    height_cm: null,
    width_cm: null,
    length_cm: null,
  };
  if (!Array.isArray(attributes)) return out;

  const attrs = attributes as MlAttribute[];
  const findByIds = (ids: string[]) => attrs.find((a) => a.id && ids.includes(a.id));

  for (const field of ["height_cm", "width_cm", "length_cm"] as const) {
    const sellerAttr = findAttr(attrs, SELLER_SIZE_ATTR[field]);
    if (sellerAttr) {
      const n = sizeCmFromAttribute(sellerAttr);
      if (n != null) {
        out[field] = n;
        continue;
      }
    }
    const pkgAttr = findByIds(PACKAGE_SIZE_ATTR[field]);
    if (pkgAttr) {
      const n = sizeCmFromAttribute(pkgAttr);
      if (n != null) out[field] = n;
    }
  }
  return out;
}

function extractSizeDimensionsFromShipping(shipping: unknown): Pick<
  ItemDimensions,
  "height_cm" | "width_cm" | "length_cm"
> {
  const out: Pick<ItemDimensions, "height_cm" | "width_cm" | "length_cm"> = {
    height_cm: null,
    width_cm: null,
    length_cm: null,
  };
  if (!shipping || typeof shipping !== "object") return out;
  const dims = (shipping as { dimensions?: unknown }).dimensions;
  if (typeof dims !== "string" || !dims.trim()) return out;

  const parts = dims.split(",").map((p) => p.trim());
  if (parts.length < 1) return out;
  const sizeTokens = parts[0].split(/x/i).map((t) => parseNumeric(t.trim()));
  if (sizeTokens.length < 3 || sizeTokens.some((t) => t == null)) return out;

  const [height, width, length] = sizeTokens as [number, number, number];
  return { height_cm: height, width_cm: width, length_cm: length };
}

export function mergeDimensions(...sources: ItemDimensions[]): ItemDimensions {
  const out: ItemDimensions = { ...EMPTY };
  for (const src of sources) {
    if (out.height_cm == null && src.height_cm != null) out.height_cm = src.height_cm;
    if (out.width_cm == null && src.width_cm != null) out.width_cm = src.width_cm;
    if (out.length_cm == null && src.length_cm != null) out.length_cm = src.length_cm;
    if (out.weight_kg == null && src.weight_kg != null) out.weight_kg = src.weight_kg;
  }
  return out;
}

/** Medidas da variação; campos ausentes (ex. sem PACKAGE_*) vêm do item pai. */
export function resolveVariationDimensions(
  variation: MLVariationDetail,
  parent: ItemDimensions
): ItemDimensions {
  return mergeDimensions(extractVariationDimensions(variation), parent);
}

/** Extrai medidas e peso do payload do item ML. */
export function extractItemDimensions(item: MLItemDetail): ItemDimensions {
  const weight_kg = extractWeightKgFromMlPayload({
    shipping: item.shipping,
    attributes: (item as { attributes?: unknown }).attributes,
  });
  const fromAttrs = extractSizeDimensionsFromAttributes(
    (item as { attributes?: unknown }).attributes
  );
  const fromShipping = extractSizeDimensionsFromShipping(item.shipping);
  return mergeDimensions(
    { ...EMPTY, weight_kg },
    { ...EMPTY, ...fromAttrs },
    { ...EMPTY, ...fromShipping }
  );
}

/** Dimensões de variação (atributos da variação + peso com mesma prioridade do item). */
export function extractVariationDimensions(variation: MLVariationDetail): ItemDimensions {
  const weight_kg = extractWeightKgFromMlPayload({ attributes: variation.attributes });
  const sizes = extractSizeDimensionsFromAttributes(variation.attributes);
  return { weight_kg, ...sizes };
}
