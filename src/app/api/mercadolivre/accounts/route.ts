import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const { data: accounts, error } = await supabase
    .from("ml_accounts")
    .select("id, ml_user_id, ml_nickname, site_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[ML accounts] list error:", error);
    return NextResponse.json({ error: "Erro ao listar contas" }, { status: 500 });
  }
  return NextResponse.json({ accounts: accounts ?? [] });
}
