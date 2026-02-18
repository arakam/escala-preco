import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-bold">EscalaPreço</h1>
      <p className="text-gray-600">Integração com Mercado Livre</p>
      <div className="flex gap-4">
        <Link
          href="/auth/login"
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Entrar
        </Link>
        <Link
          href="/auth/register"
          className="rounded border border-gray-300 px-4 py-2 hover:bg-gray-100"
        >
          Cadastrar
        </Link>
      </div>
    </main>
  );
}
