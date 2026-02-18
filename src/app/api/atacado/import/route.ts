import { createClient } from "@/lib/supabase/server";
import { parseWholesaleCsv } from "@/lib/atacado-import-csv";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/atacado/import
 * multipart/form-data: file (CSV)
 * Parseia com delimitador FIXO ";", valida cabeçalho exato, NÃO salva.
 * Retorna preview (primeiras 20 linhas), contadores e erros por linha.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
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
  const result = parseWholesaleCsv(buffer);

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
    errors: result.errors,
    preview: result.preview,
  });
}
