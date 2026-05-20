import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchTagsGroupedByProductId,
  normalizeTagName,
  setProductTagsByNames,
} from "@/lib/product-tags";

export async function GET(
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

  const { data: product } = await supabase
    .from("products")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!product) {
    return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
  }

  try {
    const map = await fetchTagsGroupedByProductId(supabase, [id]);
    return NextResponse.json({ tags: map.get(id) ?? [] });
  } catch (e) {
    console.error("Erro ao buscar tags do produto:", e);
    return NextResponse.json({ error: "Erro ao buscar tags" }, { status: 500 });
  }
}

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

  const { data: product } = await supabase
    .from("products")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!product) {
    return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
  }

  let body: { tag_names?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tagNames = (body.tag_names ?? [])
    .map((n) => normalizeTagName(String(n)))
    .filter(Boolean);

  try {
    await setProductTagsByNames(supabase, user.id, id, tagNames);
    const map = await fetchTagsGroupedByProductId(supabase, [id]);
    return NextResponse.json({ tags: map.get(id) ?? [] });
  } catch (e) {
    console.error("Erro ao salvar tags do produto:", e);
    return NextResponse.json({ error: "Erro ao salvar tags" }, { status: 500 });
  }
}
