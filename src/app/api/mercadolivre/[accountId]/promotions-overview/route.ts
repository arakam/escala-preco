import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/** Sincronização completa de promoções pode levar vários minutos em contas grandes. */
export const maxDuration = 300;
import {
  PROMOTIONS_OVERVIEW_PAGE_SIZE,
  parsePromotionsLinkFilter,
  parsePromotionsOverviewFilters,
  readPromotionsCache,
  refreshPromotionsCache,
} from "@/lib/mercadolivre/promotions-cache";

/**
 * GET: lê snapshot salvo em promotions_cache_rows (página + busca).
 * POST: atualiza o snapshot no ML + recalcula taxas e grava no cache.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { accountId } = await params;
  if (!accountId) {
    return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });
  }

  const { data: account } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const linkFilter = parsePromotionsLinkFilter(searchParams.get("linked"));
  const extraFilters = parsePromotionsOverviewFilters(searchParams);

  try {
    const { rows, total, snapshot_at } = await readPromotionsCache(
      supabase,
      accountId,
      user.id,
      page,
      search,
      linkFilter,
      extraFilters
    );

    return NextResponse.json({
      rows,
      total,
      page,
      page_size: PROMOTIONS_OVERVIEW_PAGE_SIZE,
      snapshot_at,
      cache_hit: rows.length > 0,
    });
  } catch (e) {
    console.error("[promotions-overview] GET", e);
    return NextResponse.json({ error: "Erro ao ler cache de promoções" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { accountId } = await params;
  if (!accountId) {
    return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });
  }

  const { data: account } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const linkFilter = parsePromotionsLinkFilter(searchParams.get("linked"));

  try {
    const { rows, total, snapshot_at } = await refreshPromotionsCache({
      supabase,
      accountId,
      userId: user.id,
      page,
      search,
      linkFilter,
      refreshScope: "all",
    });

    return NextResponse.json({
      rows,
      total,
      page,
      page_size: PROMOTIONS_OVERVIEW_PAGE_SIZE,
      snapshot_at,
      cache_hit: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao atualizar promoções";
    console.error("[promotions-overview] POST", e);
    const status =
      msg.includes("Token") || msg.includes("access token") ? 401 : msg.includes("não encontrada") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
