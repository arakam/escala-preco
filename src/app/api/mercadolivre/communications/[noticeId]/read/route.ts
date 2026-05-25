import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * PATCH /api/mercadolivre/communications/[noticeId]/read
 * Marca uma comunicação como lida (notice_id do Mercado Livre).
 */
export async function PATCH(
  _request: Request,
  context: { params: Promise<{ noticeId: string }> }
) {
  const { noticeId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("ml_communication_notices")
    .update({ read_at: now, updated_at: now })
    .eq("user_id", user.id)
    .eq("notice_id", noticeId)
    .is("read_at", null)
    .select("id, notice_id, read_at")
    .maybeSingle();

  if (error) {
    console.error("[ML communications/read]:", error);
    return NextResponse.json({ error: "Erro ao marcar como lida" }, { status: 500 });
  }

  if (!data) {
    const { data: existing } = await supabase
      .from("ml_communication_notices")
      .select("id, notice_id, read_at")
      .eq("user_id", user.id)
      .eq("notice_id", noticeId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: "Comunicação não encontrada" }, { status: 404 });
    }

    return NextResponse.json({ notice: existing, already_read: true });
  }

  const { count } = await supabase
    .from("ml_communication_notices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null);

  return NextResponse.json({
    notice: data,
    unread_count: count ?? 0,
  });
}
