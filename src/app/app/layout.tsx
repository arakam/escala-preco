import Link from "next/link";
import Image from "next/image";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--body-bg)" }}>
      <header className="overflow-visible border-b border-primary-darker/50 bg-gradient-to-r from-primary-darker via-primary to-primary-dark">
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
          <nav className="flex items-center gap-1">
            <Link href="/app" className="rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white">
              Início
            </Link>
            <Link href="/app/anuncios" className="rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white">
              Anúncios
            </Link>
            <Link href="/app/atacado" className="rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white">
              Atacado
            </Link>
            <Link href="/app/produtos" className="rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white">
              Produtos
            </Link>
            <Link href="/app/precos" className="rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white">
              Preço
            </Link>
            <Link href="/app/configuracao" className="rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white">
              Configuração
            </Link>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-orange-200">
                Sair
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="w-full px-4 py-6" style={{ color: "var(--body-text)" }}>{children}</main>
    </div>
  );
}
