/**
 * Limites do endpoint POST /api/pricing/calculate.
 * O cliente envia em lotes menores para reduzir risco de timeout; o servidor aceita até MAX_ITEMS por requisição.
 */
export const PRICING_CALCULATE_MAX_ITEMS_PER_REQUEST = 2000;
export const PRICING_CALCULATE_CLIENT_BATCH_SIZE = 100;
