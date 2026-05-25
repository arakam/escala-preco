import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * POST /api/mercadolivre/communications/read-all
 * Marca todas as comunicações do usuário como lidas.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("ml_communication_notices")
    .update({ read_at: now, updated_at: now })
    .eq("user_id", user.id)
    .is("read_at", null);

  if (error) {
    console.error("[ML communications/read-all]:", error);
    return NextResponse.json({ error: "Erro ao marcar todas como lidas" }, { status: 500 });
  }

  return NextResponse.json({ unread_count: 0 });
}
