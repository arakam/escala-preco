/**
 * Nome de campanha do vendedor (seller-promotions / SELLER_CAMPAIGN).
 * A API do Mercado Livre costuma rejeitar acentos e outros caracteres especiais (ex.: ç, ã).
 */
export const ML_SELLER_CAMPAIGN_NAME_REGEX = /^[a-zA-Z0-9 _-]+$/;

export function sanitizeMlSellerCampaignNameInput(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9 _-]/g, "");
}

export function isValidMlSellerCampaignName(name: string): boolean {
  const t = name.trim();
  return t.length > 0 && ML_SELLER_CAMPAIGN_NAME_REGEX.test(t);
}

export const ML_SELLER_CAMPAIGN_NAME_HINT =
  "Use apenas letras sem acento (A–Z), números, espaço, hífen (-) ou sublinhado (_).";
