import Link from "next/link";
import Image from "next/image";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex min-h-[4.5rem] max-w-7xl items-center justify-between px-4 py-3">
          <Link href="/app" className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="Escala Preço"
              width={220}
              height={62}
              className="h-12 w-auto object-contain sm:h-14"
            />
          </Link>
          <nav className="flex items-center gap-6">
            <Link href="/app" className="text-sm font-medium text-gray-600 transition hover:text-brand-blue">
              Início
            </Link>
            <Link href="/app/anuncios" className="text-sm font-medium text-gray-600 transition hover:text-brand-blue">
              Anúncios
            </Link>
            <Link href="/app/atacado" className="text-sm font-medium text-gray-600 transition hover:text-brand-blue">
              Atacado
            </Link>
            <Link href="/app/configuracao" className="text-sm font-medium text-gray-600 transition hover:text-brand-blue">
              Configuração
            </Link>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="text-sm font-medium text-gray-600 transition hover:text-brand-orange">
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
