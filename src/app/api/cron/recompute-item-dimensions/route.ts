import { recomputeItemDimensionsFromRawJson } from "@/lib/mercadolivre/recompute-item-dimensions";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET|POST /api/cron/recompute-item-dimensions
 * Recalcula peso/medidas em ml_items a partir do raw_json (correção gramas → kg).
 * Authorization: Bearer <CRON_SECRET>
 * Query: dry_run=1 (apenas conta quantos seriam alterados)
 */
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET não configurado" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim();
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dry_run") === "1";

  try {
    const result = await recomputeItemDimensionsFromRawJson({ dryRun });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    console.info("[cron recompute-item-dimensions]", { dryRun, ...result });
    return NextResponse.json({ ok: true, dry_run: dryRun, ...result });
  } catch (e) {
    console.error("[cron recompute-item-dimensions]", e);
    return NextResponse.json({ error: "Erro ao recalcular dimensões" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
