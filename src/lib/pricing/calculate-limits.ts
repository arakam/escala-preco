/**
 * Tamanho dos lotes HTTP/servidor para cálculo de taxa e margem na grade de Preços.
 * Sem teto fixo no total de linhas: o cliente e o servidor processam em sequência (500 por vez).
 * Importação CSV usa PRICING_IMPORT_CONFIRM_CLIENT_BATCH_SIZE.
 */
export const PRICING_CALCULATE_CLIENT_BATCH_SIZE = 500;
/** Confirmação da importação CSV em Preços: várias requisições sem limite total de linhas. */
export const PRICING_IMPORT_CONFIRM_CLIENT_BATCH_SIZE = 500;
