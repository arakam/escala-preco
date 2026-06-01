/** Modelo de dados para a tela Recebimento (protótipo / integração futura ML Billing + MP). */

export type RecebimentoReleaseStatus = "released" | "pending" | "scheduled";

export type RecebimentoRow = {
  ml_order_id: string;
  payment_id: number;
  payment_status: string;
  payment_status_detail: string | null;
  payment_method_id: string;
  payment_type_id: string;
  date_approved: string;
  money_release_date: string;
  money_release_days: number;
  money_release_status: RecebimentoReleaseStatus;
  transaction_amount: number;
  marketplace_fee_gross: number;
  marketplace_fee_net: number;
  marketplace_fee_rebate: number;
  shipping_cost: number;
  taxes_amount: number;
  coupon_amount: number;
  net_to_receive: number;
  installments: number;
  item_title: string;
  data_source: "orders" | "billing" | "mixed";
};

export type RecebimentoApiMeta = {
  orders_loaded: number;
  billing_batches_ok: number;
  billing_batches_failed: number;
  billing_forbidden: boolean;
  billing_error: string | null;
  orders_from_api: number;
};

export type RecebimentoDaySummary = {
  date: string;
  released_total: number;
  scheduled_total: number;
  pending_total: number;
  /** Soma líquida de tudo com liberação na data de referência */
  total_net: number;
  row_count: number;
};
