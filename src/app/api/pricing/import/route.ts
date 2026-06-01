import { getRouteAuth } from "@/lib/supabase/route-auth";
import { parsePrecosImportCsv } from "@/lib/precos-import-csv";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

/**
 * POST /api/pricing/import
 * multipart/form-data: file (CSV)
 * Parseia com delimitador ";", identifica colunas pelo cabeçalho (MLB, Promocao, Margem %). NÃO salva.
 */
export async function POST(request: NextRequest) {
  const auth = await getRouteAuth();
  if (!auth) {
    return NextResponse.json(
      { error: "Sessão expirada. Atualize a página e faça login novamente." },
      { status: 401 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Corpo multipart inválido" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Envie o arquivo CSV no campo 'file'" }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const result = parsePrecosImportCsv(buffer);

  if (result.headerError) {
    return NextResponse.json({
      ok: false,
      total_rows: result.total_rows,
      valid_rows: 0,
      error_rows: 0,
      errors: [{ row: 0, field: "header", message: result.headerError }],
      preview: [],
    });
  }

  return NextResponse.json({
    ok: true,
    total_rows: result.total_rows,
    valid_rows: result.valid_rows,
    error_rows: result.error_rows,
    errors_truncated: result.errors_truncated,
    errors: result.errors,
    preview: result.preview,
    valid_items: result.valid_items,
  });
}
