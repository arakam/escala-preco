import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import { runWithConcurrency } from "@/lib/mercadolivre/client";

type CampaignItemInput = {
  item_id: string;
  variation_id?: number | null;
};

type CreateSellerCampaignBody = {
  name: string;
  /**
   * Datas em formato local (YYYY-MM-DD ou YYYY-MM-DDTHH:mm:ss).
   * A API do ML considera sempre início/fim do dia.
   */
  start_date: string;
  finish_date: string;
  items: CampaignItemInput[];
};

type ItemApplyResult =
  | { item_id: string; variation_id: number | null; status: "ok"; price: number }
  | { item_id: string; variation_id: number | null; status: "skipped_no_planned_price" }
  | { item_id: string; variation_id: number | null; status: "error"; error: string };

/**
 * POST /api/mercadolivre/seller-campaigns
 *
 * Cria uma campanha do vendedor (SELLER_CAMPAIGN) no Mercado Livre
 * e adiciona itens usando o planned_price salvo em planned_prices
 * como deal_price.
 *
 * Body:
 * {
 *   name: string;
 *   start_date: string;   // "2026-03-05" ou "2026-03-05T00:00:00"
 *   finish_date: string;  // idem
 *   items: [{ item_id: "MLB...", variation_id?: number | null }]
 * }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: CreateSellerCampaignBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const name = (body.name || "").trim();
  const startDateRaw = (body.start_date || "").trim();
  const finishDateRaw = (body.finish_date || "").trim();
  const items = Array.isArray(body.items) ? body.items : [];

  if (!name) {
    return NextResponse.json({ error: "Nome da campanha é obrigatório" }, { status: 400 });
  }
  if (!startDateRaw || !finishDateRaw) {
    return NextResponse.json({ error: "Datas de início e fim são obrigatórias" }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "Envie pelo menos um item em items" }, { status: 400 });
  }

  // Normaliza datas para o formato esperado pela doc (local, com horário)
  function normalizeDate(dateStr: string, isStart: boolean): string {
    // Se já vier com "T", apenas retorna
    if (dateStr.includes("T")) {
      return dateStr;
    }
    // Assume formato YYYY-MM-DD
    return isStart ? `${dateStr}T00:00:00` : `${dateStr}T00:00:00`;
  }

  const startDate = normalizeDate(startDateRaw, true);
  const finishDate = normalizeDate(finishDateRaw, false);

  // Validação básica de período (máx 30 dias, start >= hoje).
  // Se passar de 30 dias aqui, deixamos a API do ML rejeitar se houver outra regra mais restritiva.
  try {
    const now = new Date();
    const start = new Date(startDate);
    const finish = new Date(finishDate);
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (start.getTime() < new Date(now.toDateString()).getTime()) {
      return NextResponse.json(
        { error: "Data de início não pode ser anterior a hoje" },
        { status: 400 }
      );
    }

    if (finish.getTime() < start.getTime()) {
      return NextResponse.json(
        { error: "Data de término não pode ser anterior à data de início" },
        { status: 400 }
      );
    }

    const diffDays = Math.ceil((finish.getTime() - start.getTime()) / oneDayMs) + 1;
    if (diffDays > 30) {
      return NextResponse.json(
        { error: "Período máximo da campanha é de 30 dias" },
        { status: 400 }
      );
    }
  } catch {
    // Se der erro ao parsear, deixa a API do ML validar
  }

  // Localiza a conta ML do usuário
  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Configuração do servidor incompleta (Supabase)" },
      { status: 500 }
    );
  }

  const adminSupabase = createSupabaseClient(supabaseUrl, supabaseServiceKey);

  // Busca tokens da conta e garante access_token válido
  const { data: tokenData, error: tokenError } = await adminSupabase
    .from("ml_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("account_id", account.id)
    .single();

  if (tokenError || !tokenData) {
    return NextResponse.json({ error: "Token do Mercado Livre não encontrado" }, { status: 404 });
  }

  const token = tokenData as {
    access_token: string;
    refresh_token: string;
    expires_at: string;
  };

  const accessToken = await getValidAccessToken(
    account.id,
    token.access_token,
    token.refresh_token,
    token.expires_at,
    adminSupabase
  );

  if (!accessToken) {
    return NextResponse.json(
      { error: "Falha ao obter access_token válido do Mercado Livre" },
      { status: 401 }
    );
  }

  // Carrega planned_prices para os itens informados
  const normalizedItems = items
    .map((i) => ({
      item_id: (i.item_id || "").trim().toUpperCase(),
      variation_id: i.variation_id == null ? -1 : Number(i.variation_id),
    }))
    .filter((i) => i.item_id);

  if (normalizedItems.length === 0) {
    return NextResponse.json(
      { error: "Nenhum item válido (item_id obrigatório)" },
      { status: 400 }
    );
  }

  const uniqueItemIds = Array.from(new Set(normalizedItems.map((i) => i.item_id)));

  const { data: plannedRows, error: plannedError } = await adminSupabase
    .from("planned_prices")
    .select("item_id, variation_id, planned_price")
    .eq("account_id", account.id)
    .in("item_id", uniqueItemIds);

  if (plannedError) {
    console.error("[seller-campaigns] erro ao carregar planned_prices:", plannedError);
    return NextResponse.json(
      { error: "Erro ao carregar preços planejados" },
      { status: 500 }
    );
  }

  const plannedMap = new Map<string, number>();
  for (const row of plannedRows || []) {
    const key = `${String(row.item_id).toUpperCase()}:${
      row.variation_id == null || row.variation_id === -1 ? -1 : Number(row.variation_id)
    }`;
    plannedMap.set(key, Number(row.planned_price));
  }

  // Cria a campanha no Mercado Livre
  let campaignId: string | null = null;
  try {
    const res = await fetch(
      "https://api.mercadolibre.com/seller-promotions/promotions?app_version=v2",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          promotion_type: "SELLER_CAMPAIGN",
          name,
          sub_type: "FLEXIBLE_PERCENTAGE",
          start_date: startDate,
          finish_date: finishDate,
        }),
      }
    );

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // ignore parse error, mantemos text para debug
    }

    if (!res.ok) {
      const message =
        (json && (json.message || json.error || json.error_message)) ||
        `Erro ao criar campanha (status ${res.status})`;
      console.error("[seller-campaigns] erro ao criar campanha:", res.status, text);
      return NextResponse.json(
        {
          error: "Falha ao criar campanha no Mercado Livre",
          details: message,
        },
        { status: 400 }
      );
    }

    campaignId = json?.id ?? null;
    if (!campaignId) {
      console.error("[seller-campaigns] resposta sem id de campanha:", json);
      return NextResponse.json(
        { error: "Campanha criada, mas sem ID retornado pelo Mercado Livre" },
        { status: 500 }
      );
    }
  } catch (e) {
    console.error("[seller-campaigns] exceção ao criar campanha:", e);
    return NextResponse.json(
      { error: "Erro de rede ao criar campanha no Mercado Livre" },
      { status: 502 }
    );
  }

  // Para cada item, envia POST /seller-promotions/items/{ITEM_ID} com deal_price = planned_price
  const applyResults = await runWithConcurrency(
    normalizedItems,
    5,
    async (item): Promise<ItemApplyResult> => {
      const key = `${item.item_id}:${item.variation_id}`;
      const plannedPrice = plannedMap.get(key);

      if (plannedPrice == null || Number.isNaN(plannedPrice)) {
        return {
          item_id: item.item_id,
          variation_id: item.variation_id === -1 ? null : item.variation_id,
          status: "skipped_no_planned_price",
        };
      }

      try {
        const res = await fetch(
          `https://api.mercadolibre.com/seller-promotions/items/${item.item_id}?app_version=v2`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              promotion_id: campaignId,
              promotion_type: "SELLER_CAMPAIGN",
              deal_price: plannedPrice,
            }),
          }
        );

        const text = await res.text();
        let json: any = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          // ignore
        }

        if (!res.ok) {
          const message =
            (json && (json.message || json.error || json.error_message)) ||
            `status ${res.status}`;
          console.error(
            "[seller-campaigns] erro ao adicionar item à campanha:",
            item.item_id,
            message
          );
          return {
            item_id: item.item_id,
            variation_id: item.variation_id === -1 ? null : item.variation_id,
            status: "error",
            error: message,
          };
        }

        return {
          item_id: item.item_id,
          variation_id: item.variation_id === -1 ? null : item.variation_id,
          status: "ok",
          price: plannedPrice,
        };
      } catch (e) {
        console.error(
          "[seller-campaigns] exceção ao adicionar item à campanha:",
          item.item_id,
          e
        );
        return {
          item_id: item.item_id,
          variation_id: item.variation_id === -1 ? null : item.variation_id,
          status: "error",
          error: "Erro de rede ao adicionar item à campanha",
        };
      }
    }
  );

  const okCount = applyResults.filter((r) => r.status === "ok").length;
  const skippedCount = applyResults.filter(
    (r) => r.status === "skipped_no_planned_price"
  ).length;
  const errorCount = applyResults.filter((r) => r.status === "error").length;

  return NextResponse.json({
    campaign: {
      id: campaignId,
      name,
      start_date: startDate,
      finish_date: finishDate,
    },
    summary: {
      requested_items: normalizedItems.length,
      applied: okCount,
      skipped_no_planned_price: skippedCount,
      errors: errorCount,
    },
    items: applyResults,
  });
}

