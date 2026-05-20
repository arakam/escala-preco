import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeTagName } from "@/lib/product-tags";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const name = normalizeTagName(body.name ?? "");
  if (!name) {
    return NextResponse.json({ error: "Nome da tag é obrigatório" }, { status: 400 });
  }

  const { data: tag, error } = await supabase
    .from("product_tags")
    .update({ name })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, name, user_id, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Já existe uma tag com este nome" }, { status: 409 });
    }
    console.error("Erro ao renomear tag:", error);
    return NextResponse.json({ error: "Erro ao renomear tag" }, { status: 500 });
  }

  if (!tag) {
    return NextResponse.json({ error: "Tag não encontrada" }, { status: 404 });
  }

  return NextResponse.json({ tag });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { error } = await supabase
    .from("product_tags")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("Erro ao excluir tag:", error);
    return NextResponse.json({ error: "Erro ao excluir tag" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
