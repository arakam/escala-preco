/**
 * Abas do painel de promoções do Mercado Livre (Seller Center), mapeadas para `type` + `status`.
 * A API não expõe essas categorias; agrupamos no app após GET /seller-promotions/users/{id}.
 */

import { normalizeMlPromotionTypeCode } from "@/lib/mercadolivre/ml-promotion-types";
import type { MlSellerCampaignRow } from "@/lib/mercadolivre/fetch-seller-campaigns";

export type MlPromotionUiCategoryId =
  | "sugeridas"
  | "eventos"
  | "menos_tarifas"
  | "dod_lightning"
  | "meios_pagamento"
  | "criadas_voce";

export type MlPromotionUiCategory = {
  id: MlPromotionUiCategoryId;
  /** Rótulo curto (aba). */
  label: string;
  /** Descrição na UI. */
  description: string;
  /** Tipos `type` do ML nesta aba (vazio = regra por status em `sugeridas`). */
  types: readonly string[];
};

export const ML_PROMOTION_UI_CATEGORIES: readonly MlPromotionUiCategory[] = [
  {
    id: "sugeridas",
    label: "Sugeridas",
    description: "Convites e campanhas ainda não em vigência (pendentes ou com prazo de aceite).",
    types: [],
  },
  {
    id: "eventos",
    label: "Eventos comerciais",
    description: "Campanhas tradicionais e com participação do Mercado Livre.",
    types: ["DEAL", "MARKETPLACE_CAMPAIGN"],
  },
  {
    id: "menos_tarifas",
    label: "Menos tarifas de venda",
    description: "Co-participação, preço competitivo e descontos pré-acordados.",
    types: ["SMART", "PRICE_MATCHING", "PRICE_MATCHING_MELI_ALL", "PRE_NEGOTIATED"],
  },
  {
    id: "dod_lightning",
    label: "Oferta do dia e relâmpago",
    description: "Ofertas do dia (DOD) e relâmpago (LIGHTNING).",
    types: ["DOD", "LIGHTNING"],
  },
  {
    id: "meios_pagamento",
    label: "Meios de pagamento",
    description: "Promoções ligadas a meios de pagamento (ex.: BANK).",
    types: ["BANK"],
  },
  {
    id: "criadas_voce",
    label: "Criadas por você",
    description: "Campanhas e descontos criados pelo vendedor.",
    types: ["SELLER_CAMPAIGN", "PRICE_DISCOUNT", "SELLER_COUPON_CAMPAIGN", "VOLUME"],
  },
] as const;

const CATEGORY_BY_ID = new Map(ML_PROMOTION_UI_CATEGORIES.map((c) => [c.id, c]));

export function getMlPromotionUiCategory(id: string | null | undefined): MlPromotionUiCategory | null {
  if (!id) return null;
  return CATEGORY_BY_ID.get(id as MlPromotionUiCategoryId) ?? null;
}

export function parseMlPromotionUiCategoryId(raw: string | null | undefined): MlPromotionUiCategoryId {
  const id = String(raw ?? "").trim() as MlPromotionUiCategoryId;
  return getMlPromotionUiCategory(id) ? id : "eventos";
}

function parseDeadlineMs(iso: string | null): number | null {
  if (!iso?.trim()) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function isSuggestedCampaign(c: MlSellerCampaignRow, nowMs: number): boolean {
  const st = c.status.toLowerCase();
  if (st === "pending" || st === "candidate" || st === "programmed") return true;
  if (st === "finished" || st === "inactive") return false;
  const deadline = parseDeadlineMs(c.deadline_date);
  if (deadline != null && deadline > nowMs) return true;
  if (st !== "started" && st !== "active") return true;
  return false;
}

/** Campanha pertence à aba (equivalente ao Seller Center). */
export function campaignBelongsToUiCategory(
  c: MlSellerCampaignRow,
  category: MlPromotionUiCategory,
  nowMs = Date.now()
): boolean {
  const type = normalizeMlPromotionTypeCode(c.type) || c.type.trim().toUpperCase();

  if (category.id === "sugeridas") {
    return isSuggestedCampaign(c, nowMs);
  }

  if (category.types.length === 0) return false;

  if (category.types.includes(type)) return true;

  // BANK e variantes
  if (category.id === "meios_pagamento" && type.startsWith("BANK")) return true;

  return false;
}

export function filterCampaignsByUiCategory(
  campaigns: MlSellerCampaignRow[],
  category: MlPromotionUiCategory,
  nowMs = Date.now()
): MlSellerCampaignRow[] {
  return campaigns.filter((c) => campaignBelongsToUiCategory(c, category, nowMs));
}
