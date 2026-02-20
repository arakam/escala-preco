import Link from "next/link";
import Image from "next/image";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="overflow-visible border-b border-blue-800/50 bg-gradient-to-r from-blue-900 via-[#2563eb] to-blue-800">
        <div className="flex h-14 w-full items-center justify-between px-4 py-2">
          <Link href="/app" className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="Escala Preço"
              width={360}
              height={100}
              className="h-16 w-auto object-contain brightness-0 invert sm:h-[4.5rem]"
            />
          </Link>
          <nav className="flex items-center gap-5">
            <Link href="/app" className="text-sm font-medium text-blue-100 transition hover:text-white">
              Início
            </Link>
            <Link href="/app/anuncios" className="text-sm font-medium text-blue-100 transition hover:text-white">
              Anúncios
            </Link>
            <Link href="/app/atacado" className="text-sm font-medium text-blue-100 transition hover:text-white">
              Atacado
            </Link>
            <Link href="/app/configuracao" className="text-sm font-medium text-blue-100 transition hover:text-white">
              Configuração
            </Link>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="text-sm font-medium text-blue-100 transition hover:text-orange-200">
                Sair
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="w-full px-4 py-4">{children}</main>
    </div>
  );
}
