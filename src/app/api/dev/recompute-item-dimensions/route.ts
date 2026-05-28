import { recomputeItemDimensionsFromRawJson } from "@/lib/mercadolivre/recompute-item-dimensions";
import { isDevEnvironment } from "@/lib/dev-only";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/dev/recompute-item-dimensions?dry_run=1
 * Recalcula peso/medidas dos anúncios (apenas development).
 */
export async function POST(request: NextRequest) {
  if (!isDevEnvironment()) {
    return NextResponse.json({ error: "Não disponível" }, { status: 404 });
  }

  const dryRun = request.nextUrl.searchParams.get("dry_run") === "1";

  try {
    const result = await recomputeItemDimensionsFromRawJson({ dryRun });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, dry_run: dryRun, ...result });
  } catch (e) {
    console.error("[dev recompute-item-dimensions]", e);
    return NextResponse.json({ error: "Erro ao recalcular dimensões" }, { status: 500 });
  }
}
