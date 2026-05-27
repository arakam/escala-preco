import { redirect } from "next/navigation";
import { RecebimentoDevPage } from "@/components/dev/RecebimentoDevPage";
import { isDevEnvironment } from "@/lib/dev-only";

/** Tela modelo de Recebimento — apenas `npm run dev` (não disponível em produção). */
export default function DevRecebimentoPage() {
  if (!isDevEnvironment()) {
    redirect("/app");
  }
  return <RecebimentoDevPage />;
}
