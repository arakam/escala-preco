const BILLING_ORDER_DETAILS_URL =
  "https://api.mercadolibre.com/billing/integration/group/ML/order/details";

const BATCH_SIZE = 30;

export type MlBillingPaymentInfo = {
  payment_id: number;
  date_approved: string | null;
  date_created: string | null;
  money_release_date: string | null;
  money_release_days: number | null;
  money_release_status: string | null;
  payment_method_id: string | null;
  payment_type_id: string | null;
  status: string | null;
  status_details: string | null;
  tax_details: Array<{ original_amount?: number; refunded_amount?: number; tax_status?: string }>;
};

export type MlBillingSaleFee = {
  gross: number;
  net: number;
  rebate: number;
  discount: number;
  discount_reason: string | null;
};

export type MlBillingOrderDetail = {
  order_id: string;
  payment_info: MlBillingPaymentInfo[];
  sale_fee: MlBillingSaleFee | null;
};

export type FetchMlBillingResult = {
  byOrderId: Map<string, MlBillingOrderDetail>;
  error: string | null;
  forbidden: boolean;
  batches_ok: number;
  batches_failed: number;
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parsePaymentInfo(raw: unknown): MlBillingPaymentInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const payment_id = num(p.payment_id);
  if (payment_id == null) return null;

  const tax_details: MlBillingPaymentInfo["tax_details"] = [];
  if (Array.isArray(p.tax_details)) {
    for (const t of p.tax_details) {
      if (!t || typeof t !== "object") continue;
      const o = t as Record<string, unknown>;
      tax_details.push({
        original_amount: num(o.original_amount) ?? undefined,
        refunded_amount: num(o.refunded_amount) ?? undefined,
        tax_status: o.tax_status != null ? String(o.tax_status) : undefined,
      });
    }
  }

  return {
    payment_id,
    date_approved: p.date_approved != null ? String(p.date_approved) : null,
    date_created: p.date_created != null ? String(p.date_created) : null,
    money_release_date: p.money_release_date != null ? String(p.money_release_date) : null,
    money_release_days: num(p.money_release_days),
    money_release_status: p.money_release_status != null ? String(p.money_release_status) : null,
    payment_method_id: p.payment_method_id != null ? String(p.payment_method_id) : null,
    payment_type_id: p.payment_type_id != null ? String(p.payment_type_id) : null,
    status: p.status != null ? String(p.status) : null,
    status_details: p.status_details != null ? String(p.status_details) : null,
    tax_details,
  };
}

function parseSaleFee(raw: unknown): MlBillingSaleFee | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const gross = num(s.gross);
  const net = num(s.net);
  if (gross == null && net == null) return null;
  return {
    gross: gross ?? net ?? 0,
    net: net ?? gross ?? 0,
    rebate: num(s.rebate) ?? 0,
    discount: num(s.discount) ?? 0,
    discount_reason: s.discount_reason != null ? String(s.discount_reason) : null,
  };
}

function parseBillingOrderResult(raw: unknown): MlBillingOrderDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const orderIdRaw = o.order_id ?? o.id;
  if (orderIdRaw == null || orderIdRaw === "") return null;
  const order_id = String(orderIdRaw).trim();

  const payment_info: MlBillingPaymentInfo[] = [];
  if (Array.isArray(o.payment_info)) {
    for (const p of o.payment_info) {
      const parsed = parsePaymentInfo(p);
      if (parsed) payment_info.push(parsed);
    }
  }

  return {
    order_id,
    payment_info,
    sale_fee: parseSaleFee(o.sale_fee),
  };
}

async function fetchBillingBatch(
  accessToken: string,
  orderIds: string[]
): Promise<{ ok: boolean; status: number; details: MlBillingOrderDetail[]; body: string }> {
  const url = new URL(BILLING_ORDER_DETAILS_URL);
  url.searchParams.set("order_ids", orderIds.join(","));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, details: [], body: body.slice(0, 300) };
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, status: res.status, details: [], body: "JSON inválido" };
  }

  const details: MlBillingOrderDetail[] = [];
  const results = (json as { results?: unknown }).results;
  if (Array.isArray(results)) {
    for (const row of results) {
      const parsed = parseBillingOrderResult(row);
      if (parsed) details.push(parsed);
    }
  }
  return { ok: true, status: res.status, details, body: "" };
}

/** Busca faturamento por pedido (ML Billing). Falha parcial não interrompe demais lotes. */
export async function fetchMlBillingOrderDetails(
  accessToken: string,
  orderIds: string[]
): Promise<FetchMlBillingResult> {
  const byOrderId = new Map<string, MlBillingOrderDetail>();
  if (orderIds.length === 0) {
    return { byOrderId, error: null, forbidden: false, batches_ok: 0, batches_failed: 0 };
  }

  const unique = Array.from(new Set(orderIds.map((id) => String(id).trim()).filter(Boolean)));
  let forbidden = false;
  let batches_ok = 0;
  let batches_failed = 0;
  let lastError: string | null = null;

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const chunk = unique.slice(i, i + BATCH_SIZE);
    const batch = await fetchBillingBatch(accessToken, chunk);
    if (!batch.ok) {
      batches_failed += 1;
      if (batch.status === 403) forbidden = true;
      lastError = `Billing HTTP ${batch.status}: ${batch.body || "erro"}`;
      continue;
    }
    batches_ok += 1;
    for (const d of batch.details) {
      byOrderId.set(d.order_id, d);
    }
  }

  return {
    byOrderId,
    error: batches_ok === 0 && batches_failed > 0 ? lastError : null,
    forbidden,
    batches_ok,
    batches_failed,
  };
}
