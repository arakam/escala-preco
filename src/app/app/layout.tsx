import Link from "next/link";
import Image from "next/image";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="border-b border-slate-600 bg-slate-800">
        <div className="flex h-9 w-full items-center justify-between px-4 py-1">
          <Link href="/app" className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="Escala Preço"
              width={220}
              height={62}
              className="h-7 w-auto object-contain brightness-0 invert"
            />
          </Link>
          <nav className="flex items-center gap-5">
            <Link href="/app" className="text-sm font-medium text-slate-300 transition hover:text-white">
              Início
            </Link>
            <Link href="/app/anuncios" className="text-sm font-medium text-slate-300 transition hover:text-white">
              Anúncios
            </Link>
            <Link href="/app/atacado" className="text-sm font-medium text-slate-300 transition hover:text-white">
              Atacado
            </Link>
            <Link href="/app/configuracao" className="text-sm font-medium text-slate-300 transition hover:text-white">
              Configuração
            </Link>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="text-sm font-medium text-slate-300 transition hover:text-orange-300">
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
