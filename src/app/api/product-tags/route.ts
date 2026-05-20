import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listUserTagsWithCounts, normalizeTagName } from "@/lib/product-tags";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const tags = await listUserTagsWithCounts(supabase, user.id);
    return NextResponse.json({ tags });
  } catch (e) {
    console.error("Erro ao listar tags:", e);
    return NextResponse.json({ error: "Erro ao listar tags" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
    .insert({ user_id: user.id, name })
    .select("id, name, user_id, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from("product_tags")
        .select("id, name, user_id, created_at")
        .eq("user_id", user.id)
        .ilike("name", name)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({ tag: existing });
      }
      return NextResponse.json({ error: "Já existe uma tag com este nome" }, { status: 409 });
    }
    console.error("Erro ao criar tag:", error);
    return NextResponse.json({ error: "Erro ao criar tag" }, { status: 500 });
  }

  return NextResponse.json({ tag }, { status: 201 });
}
