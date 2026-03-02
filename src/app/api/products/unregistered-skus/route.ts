import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const limitParam = parseInt(searchParams.get("limit") || "100", 10);

  const { data, error } = await supabase.rpc("get_unregistered_skus", {
    p_user_id: user.id,
  });

  if (error) {
    console.error("Erro ao buscar SKUs não cadastrados:", error);
    return NextResponse.json(
      { error: "Erro ao buscar SKUs não cadastrados" },
      { status: 500 }
    );
  }

  const skus = (data ?? []).slice(0, limitParam);

  return NextResponse.json({
    skus,
    total: data?.length ?? 0,
  });
}
