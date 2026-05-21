import { redirect } from "next/navigation";

/** Redireciona rota antiga de desenvolvimento para a tela pública de vendas. */
export default function DevVendasRedirectPage() {
  redirect("/app/vendas");
}
