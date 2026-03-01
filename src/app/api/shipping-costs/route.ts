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

  const { data: costs, error } = await supabase
    .from("ml_shipping_cost_ranges")
    .select("*")
    .order("weight_min_kg", { ascending: true });

  if (error) {
    console.error("[Shipping costs] list error:", error);
    return NextResponse.json({ error: "Erro ao listar custos de frete" }, { status: 500 });
  }

  return NextResponse.json({ costs: costs ?? [] });
}
