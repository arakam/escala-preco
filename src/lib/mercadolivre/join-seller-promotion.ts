/**
 * Participar em promoções via POST /seller-promotions/items/{item_id}?app_version=v2
 * @see https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas
 */

export const JOIN_WITHOUT_DEAL_PRICE = new Set([
  "MARKETPLACE_CAMPAIGN",
  "SMART",
  "VOLUME",
  "PRE_NEGOTIATED",
  "PRICE_MATCHING",
  "UNHEALTHY_STOCK",
]);

export function requiresDealPriceForPromotionType(promotionType: string): boolean {
  const t = promotionType.trim().toUpperCase();
  return t ? !JOIN_WITHOUT_DEAL_PRICE.has(t) : true;
}

export type JoinSellerPromotionInput = {
  item_id: string;
  promotion_id: string;
  promotion_type: string;
  deal_price?: number | null;
};

export type JoinSellerPromotionBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string };

export function buildSellerPromotionJoinBody(
  promotionId: string,
  promotionType: string,
  dealPrice?: number | null
): JoinSellerPromotionBodyResult {
  const pid = promotionId.trim();
  const ptype = promotionType.trim();
  if (!pid || !ptype) {
    return { ok: false, error: "promotion_id e promotion_type são obrigatórios." };
  }

  const body: Record<string, unknown> = {
    promotion_id: pid,
    promotion_type: ptype,
  };

  if (!JOIN_WITHOUT_DEAL_PRICE.has(ptype)) {
    const n = dealPrice != null ? Number(dealPrice) : NaN;
    if (!Number.isFinite(n) || n <= 0) {
      return {
        ok: false,
        error: `Preço da promoção obrigatório para campanhas do tipo ${ptype}.`,
      };
    }
    body.deal_price = n;
  }

  return { ok: true, body };
}

export type JoinSellerPromotionItemResult =
  | { item_id: string; promotion_id: string; status: "ok" }
  | { item_id: string; promotion_id: string; status: "error"; error: string };

export async function postSellerPromotionJoin(
  itemId: string,
  accessToken: string,
  joinBody: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const id = encodeURIComponent(String(itemId).trim());
  const url = `https://api.mercadolibre.com/seller-promotions/items/${id}?app_version=v2`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(joinBody),
  });

  const text = await res.text().catch(() => "");
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }

  if (res.ok) return { ok: true };

  const message =
    (json &&
      String(
        json.message ?? json.error ?? json.error_message ?? json.cause ?? ""
      ).trim()) ||
    (text ? text.slice(0, 300) : "") ||
    `status ${res.status}`;

  return { ok: false, status: res.status, message };
}
