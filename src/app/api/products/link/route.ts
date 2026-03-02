import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("link_ml_items_to_products", {
    p_user_id: user.id,
  });

  if (error) {
    console.error("Erro ao vincular produtos:", error);
    return NextResponse.json(
      { error: "Erro ao vincular produtos aos anúncios" },
      { status: 500 }
    );
  }

  const result = data?.[0] ?? { items_linked: 0, variations_linked: 0 };

  return NextResponse.json({
    success: true,
    items_linked: result.items_linked,
    variations_linked: result.variations_linked,
    total_linked: result.items_linked + result.variations_linked,
  });
}
