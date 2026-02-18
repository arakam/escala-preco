import Link from "next/link";

export default function AppHomePage() {
  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold">Área logada</h1>
      <p className="mb-4 text-gray-600">
        Bem-vindo. Conecte sua conta do Mercado Livre para sincronizar anúncios.
      </p>
      <Link
        href="/app/mercadolivre"
        className="inline-block rounded bg-yellow-400 px-4 py-2 font-medium text-gray-900 hover:bg-yellow-500"
      >
        Ir para Mercado Livre
      </Link>
    </div>
  );
}
