import Link from "next/link";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link href="/app" className="font-semibold text-gray-900">
            EscalaPreço
          </Link>
          <nav className="flex gap-4">
            <Link href="/app" className="text-gray-600 hover:text-gray-900">
              Início
            </Link>
            <Link href="/app/anuncios" className="text-gray-600 hover:text-gray-900">
              Anúncios
            </Link>
            <Link href="/app/configuracao" className="text-gray-600 hover:text-gray-900">
              Configuração
            </Link>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="text-gray-600 hover:text-gray-900">
                Sair
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4">{children}</main>
    </div>
  );
}
