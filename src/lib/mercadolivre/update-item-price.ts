import { putItem } from "@/lib/mercadolivre/client";

export type UpdateItemPriceOnMlResult =
  | { ok: true; price: number; warnings: string[] }
  | { ok: false; error: string; status: number };

function extractMlErrorMessage(json: unknown, fallback: string): string {
  if (!json || typeof json !== "object") return fallback;
  const o = json as Record<string, unknown>;
  const msg = o.message ?? o.error ?? o.error_message;
  if (typeof msg === "string" && msg.trim()) return msg.trim();
  if (Array.isArray(o.cause) && o.cause.length > 0) {
    const first = o.cause[0] as Record<string, unknown>;
    if (typeof first.message === "string" && first.message.trim()) return first.message.trim();
  }
  return fallback;
}

function extractWarnings(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const warnings = (data as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) return [];
  return warnings
    .map((w) => {
      if (typeof w === "string") return w;
      if (w && typeof w === "object" && typeof (w as { message?: string }).message === "string") {
        return (w as { message: string }).message;
      }
      return null;
    })
    .filter((s): s is string => !!s && s.trim().length > 0);
}

/**
 * Atualiza o preço standard do anúncio no Mercado Livre (PUT /items/{id}).
 * Referência: https://developers.mercadolivre.com.br/pt_br/produto-sincronizacao-de-publicacoes
 */
export async function updateItemPriceOnMl(
  itemId: string,
  accessToken: string,
  price: number,
  variationId?: number | null
): Promise<UpdateItemPriceOnMlResult> {
  const itemIdClean = itemId.trim().toUpperCase();
  const rounded = Math.round(Number(price) * 100) / 100;
  if (!Number.isFinite(rounded) || rounded <= 0) {
    return { ok: false, error: "Preço inválido", status: 400 };
  }

  const body: Record<string, unknown> =
    variationId != null && variationId > 0
      ? { variations: [{ id: variationId, price: rounded }] }
      : { price: rounded };

  const result = await putItem(itemIdClean, accessToken, body);
  if (!result.ok) {
    const message = extractMlErrorMessage(result.json, `Erro ao atualizar preço (HTTP ${result.status})`);
    return { ok: false, error: message, status: result.status };
  }

  return { ok: true, price: rounded, warnings: extractWarnings(result.data) };
}
