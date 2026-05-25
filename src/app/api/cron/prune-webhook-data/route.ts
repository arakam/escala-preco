import { createServiceClient } from "@/lib/supabase/service";
import { pruneWebhookData } from "@/lib/mercadolivre/webhook-data-retention";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET|POST /api/cron/prune-webhook-data
 * Remove webhooks e alertas de promoção antigos (retenção 7d / 30d).
 * Protegido por CRON_SECRET no header Authorization: Bearer <secret>.
 *
 * Agende diariamente (ex.: Vercel Cron em vercel.json, cron do SO ou Supabase pg_cron).
 */
async function handlePrune(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET não configurado" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim();
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch (e) {
    console.error("[cron prune-webhook-data] service client:", e);
    return NextResponse.json({ error: "Servidor não configurado" }, { status: 503 });
  }

  try {
    const result = await pruneWebhookData(supabase);
    console.info("[cron prune-webhook-data]", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron prune-webhook-data]", e);
    return NextResponse.json({ error: "Erro ao limpar dados de webhook" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handlePrune(request);
}

export async function POST(request: NextRequest) {
  return handlePrune(request);
}
