/**
 * Mesma regra da tela Preços / Promoções.
 *
 * **Valor bruto** = preço usado no cálculo (`result.price`): em Preços é o valor da coluna Promoção;
 * em Promoções é o preço da promoção.
 *
 * - **vai_receber:** valor bruto − taxa ML − frete (+ subsídio ML, quando informado).
 * - **net_amount:** `vai_receber − imposto − taxa extra − desp. fixas` — usar lucro: `net_amount − custo`.
 */
export interface FullPricingBreakdown {
  price: number;
  fee: number;
  shipping_cost: number;
  tax_amount: number;
  extra_fee_amount: number;
  fixed_expenses_amount: number;
  /** Subsídio ML (R$), ex. original_price × meli_percentage / 100 — somado em vai_receber. */
  meli_fee_subsidy: number;
  /** Bruto − taxa ML − frete + subsídio ML. */
  vai_receber: number;
  /** Após imposto, taxa extra e desp. fixas (base para lucro com custo). */
  net_amount: number;
}

export function calculateFullPricing(
  tax_percent: number | null,
  extra_fee_percent: number | null,
  fixed_expenses: number | null,
  result: {
    price: number;
    fee: number;
    shipping_cost: number;
    meli_fee_subsidy?: number | null;
  }
): FullPricingBreakdown {
  const taxAmount = tax_percent ? (result.price * tax_percent) / 100 : 0;
  const extraFeeAmount = extra_fee_percent ? (result.price * extra_fee_percent) / 100 : 0;
  const fixedExpensesAmount =
    fixed_expenses != null && fixed_expenses > 0 ? fixed_expenses : 0;
  const meliSubsidyRaw = result.meli_fee_subsidy != null ? Number(result.meli_fee_subsidy) : 0;
  const meli_fee_subsidy =
    Number.isFinite(meliSubsidyRaw) && meliSubsidyRaw > 0
      ? Math.round(meliSubsidyRaw * 100) / 100
      : 0;
  const vaiReceber = result.price - result.fee - result.shipping_cost + meli_fee_subsidy;
  const netAmount =
    vaiReceber - taxAmount - extraFeeAmount - fixedExpensesAmount;

  return {
    price: result.price,
    fee: result.fee,
    shipping_cost: result.shipping_cost,
    tax_amount: Math.round(taxAmount * 100) / 100,
    extra_fee_amount: Math.round(extraFeeAmount * 100) / 100,
    fixed_expenses_amount: Math.round(fixedExpensesAmount * 100) / 100,
    meli_fee_subsidy,
    vai_receber: Math.round(vaiReceber * 100) / 100,
    net_amount: Math.round(netAmount * 100) / 100,
  };
}
