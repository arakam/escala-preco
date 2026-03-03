export interface SalesForItem {
  quantity: number;
  orders: number;
}

const BATCH_SIZE = 10;

/**
 * Chama a API de orders do ML e retorna quantidade vendida e número de pedidos para o item.
 * Considera apenas pedidos com status "paid".
 */
async function fetchSalesForItem(
  accessToken: string,
  sellerId: number,
  itemId: string,
  dateFrom: string,
  dateTo: string
): Promise<SalesForItem> {
  const url = new URL("https://api.mercadolibre.com/orders/search");
  url.searchParams.set("seller", String(sellerId));
  url.searchParams.set("item", itemId);
  url.searchParams.set("date_created.from", dateFrom);
  url.searchParams.set("date_created.to", dateTo);
  url.searchParams.set("limit", "51"); // API ML: máximo 51 para orders/search

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.warn(`[ml/sales] orders/search ${res.status} for ${itemId}:`, errText.slice(0, 200));
    return { quantity: 0, orders: 0 };
  }

  let data: {
    results?: Array<{
      status?: string;
      order_items?: Array<{ item?: { id?: string }; quantity?: number }>;
    }>;
  };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return { quantity: 0, orders: 0 };
  }

  const results = data.results ?? [];
  let quantity = 0;
  let orders = 0;
  for (const order of results) {
    if (order.status !== "paid") continue;
    const items = order.order_items ?? [];
    let orderHasItem = false;
    for (const oi of items) {
      if (oi.item?.id === itemId && typeof oi.quantity === "number") {
        quantity += oi.quantity;
        orderHasItem = true;
      }
    }
    if (orderHasItem) orders += 1;
  }
  return { quantity, orders };
}

export interface SalesMaps {
  sales: Record<string, number>;
  orders: Record<string, number>;
}

/**
 * Obtém mapas de vendas e pedidos para uma lista de itens.
 * Usado por páginas/rotas que precisam ordenar por vendas (últimos 30 dias).
 */
export async function getSalesMap(
  accessToken: string,
  sellerId: number,
  itemIds: string[],
  dateFrom: string,
  dateTo: string
): Promise<SalesMaps> {
  const sales: Record<string, number> = {};
  const orders: Record<string, number> = {};
  const unique = Array.from(new Set(itemIds));
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((id) =>
        fetchSalesForItem(accessToken, sellerId, id, dateFrom, dateTo)
      )
    );
    batch.forEach((id, j) => {
      sales[id] = results[j].quantity;
      orders[id] = results[j].orders;
    });
  }
  return { sales, orders };
}

