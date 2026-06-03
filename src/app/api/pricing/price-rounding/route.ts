import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_PRICE_ROUNDING,
  normalizePriceRoundingConfig,
  PRICE_ROUNDING_PREFERENCE_KEY,
  type PriceRoundingConfig,
} from "@/lib/pricing/price-rounding";

/**
 * GET — arredondamento do Preço Final (conta do usuário).
 * PUT — body: { enabled: boolean, targetCents: number }
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_preferences")
    .select("value")
    .eq("user_id", user.id)
    .eq("preference_key", PRICE_ROUNDING_PREFERENCE_KEY)
    .maybeSingle();

  if (error) {
    console.error("[price-rounding GET]", error);
    return NextResponse.json({ error: "Erro ao carregar arredondamento" }, { status: 500 });
  }

  const config = data?.value
    ? normalizePriceRoundingConfig(data.value as Partial<PriceRoundingConfig>)
    : { ...DEFAULT_PRICE_ROUNDING };

  return NextResponse.json({ config });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: Partial<PriceRoundingConfig>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const config = normalizePriceRoundingConfig(body);
  const now = new Date().toISOString();

  const { error } = await supabase.from("user_preferences").upsert(
    {
      user_id: user.id,
      preference_key: PRICE_ROUNDING_PREFERENCE_KEY,
      value: config,
      updated_at: now,
    },
    { onConflict: "user_id,preference_key" }
  );

  if (error) {
    console.error("[price-rounding PUT]", error);
    return NextResponse.json({ error: "Erro ao salvar arredondamento" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, config });
}
