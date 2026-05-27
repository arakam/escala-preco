"use client";

import Link from "next/link";
import Image from "next/image";
import { Open_Sans } from "next/font/google";
import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AdmintyIconBoxes,
  AdmintyIconCurrency,
  AdmintyIconHome,
  AdmintyIconMegaphone,
  AdmintyIconMenu,
  AdmintyIconPromo,
  AdmintyIconSettings,
  AdmintyIconShoppingCart,
  AdmintyIconTag,
  AdmintyIconWallet,
} from "@/components/adminty-nav-icons";
import { OnboardingProvider, useOnboarding } from "@/contexts/onboarding-context";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MlCommunicationsBell } from "@/components/MlCommunicationsBell";
import { isPrecoAtacadoAllowed, navBlockedHref } from "@/lib/onboarding-gating";

const admintyUiFont = Open_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const STORAGE_KEY = "escalapreco_dashboard_account_id";
const ADMINTY_SIDEBAR_COLLAPSED_KEY = "escalapreco_adminty_sidebar_collapsed";
const IS_NEXT_DEV = process.env.NODE_ENV === "development";

interface MLAccount {
  id: string;
  ml_user_id: number;
  ml_nickname: string | null;
}

function AppLayoutFallback() {
  return (
    <div className={`min-h-screen bg-[#ecf0f5] antialiased ${admintyUiFont.className}`}>
      <aside className="fixed left-0 top-0 hidden h-full w-64 flex-col border-r border-black/10 shadow-xl md:flex" style={{ backgroundColor: "var(--adminty-sidebar, #404e67)" }}>
        <div className="flex min-h-[5rem] items-center border-b border-white/10 px-3 py-2.5">
          <Image
            src="/logo.png"
            alt="Escala Preço"
            width={360}
            height={100}
            className="h-auto w-[10.5rem] max-w-full object-contain object-left brightness-0 invert"
          />
        </div>
        <div className="space-y-2 p-4">
          <div className="h-8 animate-pulse rounded bg-white/10" />
          <div className="h-8 animate-pulse rounded bg-white/10" />
          <div className="h-8 animate-pulse rounded bg-white/10" />
        </div>
      </aside>
      <div className="min-h-screen md:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200/90 bg-white px-4 shadow-sm">
          <div>
            <div className="mb-1 h-2 w-20 animate-pulse rounded bg-slate-200" />
            <div className="h-3 w-32 animate-pulse rounded bg-slate-200" />
          </div>
          <div className="h-7 w-36 animate-pulse rounded-full bg-slate-100" />
        </header>
        <main className="px-3 py-4 sm:px-5 sm:py-6">
          <div className="h-24 w-full animate-pulse rounded border border-slate-200 bg-white shadow-sm" />
        </main>
      </div>
    </div>
  );
}

function navItemActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const APP_PAGE_TITLES: Record<string, string> = {
  anuncios: "Anúncios",
  atacado: "Atacado",
  produtos: "Produtos",
  precos: "Preço",
  promocoes: "Promoções",
  configuracao: "Configuração",
  vendas: "Vendas",
  historico: "Histórico",
  recebimento: "Recebimento",
};

function appPageSection(pathname: string | null): string | null {
  if (!pathname) return null;
  const parts = pathname.split("?")[0]?.split("#")[0]?.replace(/\/$/, "").split("/").filter(Boolean) ?? [];
  if (parts[0] !== "app") return null;
  if (parts[1] === "dev") return parts[2] ?? null;
  return parts[1] ?? null;
}

function appPageTitle(pathname: string | null) {
  if (!pathname || pathname === "/app" || pathname.startsWith("/app?")) return "Início";
  const section = appPageSection(pathname);
  if (section && APP_PAGE_TITLES[section]) return APP_PAGE_TITLES[section];
  return "Painel";
}

function AdmintyDashboardShell({
  children,
  accountLabel,
  isMenuOpen,
  setIsMenuOpen,
  pathname,
  allowAnuncios,
  allowProdutos,
  allowPrecoAtacado,
  produtosBlocked,
  precoAtacadoBlocked,
  mlConnected,
}: {
  children: React.ReactNode;
  accountLabel: string;
  isMenuOpen: boolean;
  setIsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pathname: string | null;
  allowAnuncios: boolean;
  allowProdutos: boolean;
  allowPrecoAtacado: boolean;
  produtosBlocked: string;
  precoAtacadoBlocked: string;
  mlConnected: boolean;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const pageTitle = appPageTitle(pathname);

  useEffect(() => {
    try {
      const v = localStorage.getItem(ADMINTY_SIDEBAR_COLLAPSED_KEY);
      if (v === "1") setSidebarCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(ADMINTY_SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const sidebarLink = (active: boolean, blocked: boolean) => {
    const layout = sidebarCollapsed
      ? "gap-3 border-l-[3px] py-2.5 pl-[13px] pr-3 md:justify-center md:gap-0 md:border-l-0 md:px-2 md:py-2.5 md:pl-2 md:pr-2"
      : "gap-3 border-l-[3px] py-2.5 pl-[15px] pr-4";
    const base = `flex items-center ${layout} text-[14px] font-normal leading-[1.45] tracking-normal transition-colors`;
    const activeCollapsed = sidebarCollapsed && active ? "md:rounded-md md:bg-black/25" : "";
    if (blocked) {
      return `${base} border-transparent text-white/40 hover:bg-white/5 hover:text-white/60 md:hover:bg-white/5 ${activeCollapsed}`;
    }
    if (active) {
      return `${base} border-[#01a9ac] bg-black/20 font-medium text-white ${activeCollapsed}`;
    }
    return `${base} border-transparent text-white/80 hover:bg-white/10 hover:text-white ${activeCollapsed}`;
  };

  const labelClass = sidebarCollapsed ? "md:sr-only" : "";

  return (
    <div
      className={`adminty-shell relative min-h-screen bg-[#ecf0f5] text-slate-800 antialiased dark:bg-slate-950 dark:text-slate-100 ${admintyUiFont.className}`}
    >
      {isMenuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-slate-900/50 md:hidden"
          aria-label="Fechar menu"
          onClick={() => setIsMenuOpen(false)}
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-40 flex h-full w-64 flex-col border-r border-black/10 shadow-xl transition-[transform,width] duration-200 ease-out md:translate-x-0 ${
          sidebarCollapsed ? "md:w-16" : "md:w-64"
        } ${isMenuOpen ? "translate-x-0" : "-translate-x-full"}`}
        style={{ backgroundColor: "var(--adminty-sidebar, #404e67)" }}
      >
        <div
          className={`flex min-h-[5rem] shrink-0 items-center border-b border-white/10 px-3 py-2.5 sm:min-h-[5.25rem] ${
            sidebarCollapsed ? "md:min-h-[4.25rem] md:justify-center md:px-2 md:py-2" : "gap-2"
          }`}
        >
          <Link
            href="/app"
            className={`flex min-w-0 items-center ${sidebarCollapsed ? "flex-1 md:hidden" : "min-w-0 flex-1"}`}
            onClick={() => setIsMenuOpen(false)}
          >
            <Image
              src="/logo.png"
              alt="Escala Preço"
              width={360}
              height={100}
              className="h-auto w-[10.5rem] max-w-full object-contain object-left brightness-0 invert"
            />
          </Link>
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            className={`hidden rounded border border-white/15 bg-white/5 p-2 text-white shadow-sm transition hover:bg-white/15 md:inline-flex ${
              sidebarCollapsed ? "md:mx-auto" : "shrink-0"
            }`}
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
            title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
          >
            <AdmintyIconMenu />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">
          <Link
            href="/app"
            onClick={() => setIsMenuOpen(false)}
            className={sidebarLink(navItemActive(pathname, "/app"), false)}
            title={sidebarCollapsed ? "Início" : undefined}
          >
            <AdmintyIconHome />
            <span className={labelClass}>Início</span>
          </Link>
          {allowAnuncios ? (
            <Link
              href="/app/anuncios"
              onClick={() => setIsMenuOpen(false)}
              className={sidebarLink(navItemActive(pathname, "/app/anuncios"), false)}
              title={sidebarCollapsed ? "Anúncios" : undefined}
            >
              <AdmintyIconMegaphone />
              <span className={labelClass}>Anúncios</span>
            </Link>
          ) : (
            <Link
              href="/app/configuracao"
              onClick={() => setIsMenuOpen(false)}
              className={sidebarLink(false, true)}
              title={
                sidebarCollapsed
                  ? "Anúncios — conecte o ML em Configuração"
                  : "Passo 1: conecte sua conta do Mercado Livre em Configuração."
              }
            >
              <AdmintyIconMegaphone />
              <span className={labelClass}>Anúncios</span>
            </Link>
          )}
          {allowPrecoAtacado ? (
            <Link
              href="/app/atacado"
              onClick={() => setIsMenuOpen(false)}
              className={sidebarLink(navItemActive(pathname, "/app/atacado"), false)}
              title={sidebarCollapsed ? "Atacado" : undefined}
            >
              <AdmintyIconBoxes />
              <span className={labelClass}>Atacado</span>
            </Link>
          ) : (
            <Link
              href={precoAtacadoBlocked}
              onClick={() => setIsMenuOpen(false)}
              className={sidebarLink(false, true)}
              title={
                sidebarCollapsed
                  ? "Atacado — disponível após sincronizar"
                  : "Disponível após sincronizar anúncios e importar produtos."
              }
            >
              <AdmintyIconBoxes />
              <span className={labelClass}>Atacado</span>
            </Link>
          )}
          {allowProdutos ? (
            <Link
              href="/app/produtos"
              onClick={() => setIsMenuOpen(false)}
              className={sidebarLink(navItemActive(pathname, "/app/produtos"), false)}
              title={sidebarCollapsed ? "Produtos" : undefined}
            >
              <AdmintyIconTag />
              <span className={labelClass}>Produtos</span>
            </Link>
          ) : (
            <Link
              href={produtosBlocked}
              onClick={() => setIsMenuOpen(false)}
              className={sidebarLink(false, true)}
              title={
                sidebarCollapsed
                  ? "Produtos — ver requisitos"
                  : !mlConnected
                    ? "Conecte o Mercado Livre antes de gerenciar produtos."
                    : "Sincronize os anúncios antes de importar produtos."
              }
            >
              <AdmintyIconTag />
              <span className={labelClass}>Produtos</span>
            </Link>
          )}
          {allowPrecoAtacado ? (
            <Link
              href="/app/precos"
              onClick={() => setIsMenuOpen(false)}
              className={sidebarLink(navItemActive(pathname, "/app/precos"), false)}
              title={sidebarCollapsed ? "Preço" : undefined}
            >
              <AdmintyIconCurrency />
              <span className={labelClass}>Preço</span>
            </Link>
          ) : (
            <Link
              href={precoAtacadoBlocked}
              onClick={() => setIsMenuOpen(false)}
              className={sidebarLink(false, true)}
              title={
                sidebarCollapsed
                  ? "Preço — disponível após sincronizar"
                  : "Disponível após sincronizar anúncios e importar produtos."
              }
            >
              <AdmintyIconCurrency />
              <span className={labelClass}>Preço</span>
            </Link>
          )}
          {allowPrecoAtacado ? (
            <Link
              href="/app/promocoes"
              onClick={() => setIsMenuOpen(false)}
              className={sidebarLink(navItemActive(pathname, "/app/promocoes"), false)}
              title={sidebarCollapsed ? "Promoções" : undefined}
            >
              <AdmintyIconPromo />
              <span className={labelClass}>Promoções</span>
            </Link>
          ) : (
            <Link
              href={precoAtacadoBlocked}
              onClick={() => setIsMenuOpen(false)}
              className={sidebarLink(false, true)}
              title={
                sidebarCollapsed
                  ? "Promoções — disponível após sincronizar"
                  : "Disponível após sincronizar anúncios e importar produtos."
              }
            >
              <AdmintyIconPromo />
              <span className={labelClass}>Promoções</span>
            </Link>
          )}
          {allowPrecoAtacado ? (
            <Link
              href="/app/vendas"
              onClick={() => setIsMenuOpen(false)}
              className={sidebarLink(navItemActive(pathname, "/app/vendas"), false)}
              title={sidebarCollapsed ? "Vendas" : undefined}
            >
              <AdmintyIconShoppingCart />
              <span className={labelClass}>Vendas</span>
            </Link>
          ) : (
            <Link
              href={precoAtacadoBlocked}
              onClick={() => setIsMenuOpen(false)}
              className={sidebarLink(false, true)}
              title={
                sidebarCollapsed
                  ? "Vendas — disponível após sincronizar"
                  : "Disponível após sincronizar anúncios e importar produtos."
              }
            >
              <AdmintyIconShoppingCart />
              <span className={labelClass}>Vendas</span>
            </Link>
          )}
          <Link
            href="/app/configuracao"
            onClick={() => setIsMenuOpen(false)}
            className={sidebarLink(navItemActive(pathname, "/app/configuracao"), false)}
            title={sidebarCollapsed ? "Configuração" : undefined}
          >
            <AdmintyIconSettings />
            <span className={labelClass}>Configuração</span>
          </Link>
          {IS_NEXT_DEV ? (
            <Link
              href="/app/dev/recebimento"
              onClick={() => setIsMenuOpen(false)}
              className={sidebarLink(navItemActive(pathname, "/app/dev/recebimento"), false)}
              title={sidebarCollapsed ? "Recebimento (dev)" : undefined}
            >
              <AdmintyIconWallet />
              <span className={labelClass}>
                Recebimento
                <span className="ml-1 rounded bg-violet-500/30 px-1 text-[10px] font-medium text-violet-100">
                  dev
                </span>
              </span>
            </Link>
          ) : null}
        </nav>

        <div className={`shrink-0 border-t border-white/10 p-3 ${sidebarCollapsed ? "md:px-2 md:py-2" : ""}`}>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className={`flex w-full items-center justify-center rounded border border-white/15 bg-white/5 py-2 text-[14px] font-normal tracking-normal text-white/90 transition hover:bg-white/10 hover:text-white ${
                sidebarCollapsed ? "md:px-0" : ""
              }`}
              title={sidebarCollapsed ? "Sair" : undefined}
            >
              <span className={labelClass}>Sair</span>
            </button>
          </form>
        </div>
      </aside>

      <div className={`flex min-h-screen flex-1 flex-col transition-[padding] duration-200 ease-out ${sidebarCollapsed ? "md:pl-16" : "md:pl-64"}`}>
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200/90 bg-white px-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setIsMenuOpen((o) => !o)}
              className="btn btn-icon btn-sm btn-outline-secondary md:hidden"
              aria-label={isMenuOpen ? "Fechar menu" : "Abrir menu"}
              aria-expanded={isMenuOpen}
            >
              {isMenuOpen ? <CloseIconDark /> : <MenuIconDark />}
            </button>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                Navegação
              </p>
              <p className="truncate text-[15px] font-normal leading-tight text-slate-800 dark:text-slate-100">
                <span className="text-slate-500 dark:text-slate-400">Painel</span>
                <span className="mx-1.5 font-light text-slate-300 dark:text-slate-600">/</span>
                <span className="font-semibold" style={{ color: "var(--adminty-accent, #01a9ac)" }}>
                  {pageTitle}
                </span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {accountLabel && (
              <span className="hidden max-w-[200px] truncate rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[13px] font-medium text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 md:inline-block">
                {accountLabel}
              </span>
            )}
            <MlCommunicationsBell />
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 px-3 py-4 sm:px-5 sm:py-6" style={{ color: "var(--body-text)" }}>
          <Suspense fallback={<div className="min-h-24 animate-pulse rounded-lg bg-white/80 shadow-sm" />}>
            {children}
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function CloseIconDark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        className="stroke-slate-700"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MenuIconDark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        className="stroke-slate-700"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AppShell({
  children,
  accountLabel,
  isMenuOpen,
  setIsMenuOpen,
  admintyShell,
}: {
  children: React.ReactNode;
  accountLabel: string;
  isMenuOpen: boolean;
  setIsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  admintyShell: boolean;
}) {
  const pathname = usePathname();
  const { status, loading } = useOnboarding();

  const allowAnuncios = !loading && !!status?.ml_connected;
  const allowProdutos = !loading && !!status?.ml_connected && !!status?.listings_synced;
  const allowPrecoAtacado = isPrecoAtacadoAllowed(status, loading);

  const produtosBlocked = navBlockedHref(
    status ?? { ml_connected: false, listings_synced: false, products_imported: false }
  );
  const precoAtacadoBlocked = produtosBlocked;

  if (admintyShell) {
    return (
      <AdmintyDashboardShell
        accountLabel={accountLabel}
        isMenuOpen={isMenuOpen}
        setIsMenuOpen={setIsMenuOpen}
        pathname={pathname}
        allowAnuncios={allowAnuncios}
        allowProdutos={allowProdutos}
        allowPrecoAtacado={allowPrecoAtacado}
        produtosBlocked={produtosBlocked}
        precoAtacadoBlocked={precoAtacadoBlocked}
        mlConnected={!!status?.ml_connected}
      >
        {children}
      </AdmintyDashboardShell>
    );
  }

  const gatedActive =
    "inline-flex items-center gap-2 rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white";
  const gatedBlocked =
    "inline-flex items-center gap-2 rounded-app px-3 py-2 text-sm font-medium text-white/45 transition hover:bg-white/5 hover:text-white/65";

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--body-bg)" }}>
      <header className="sticky top-0 z-30 overflow-visible border-b border-primary-darker/50 bg-gradient-to-r from-primary-darker via-primary to-primary-dark shadow-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/app" className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="Escala Preço"
              width={360}
              height={100}
              className="h-10 w-auto object-contain brightness-0 invert sm:h-14"
            />
          </Link>

          {accountLabel && (
            <div className="hidden max-w-[180px] truncate md:block">
              <span className="rounded-app border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-medium text-white backdrop-blur">
                {accountLabel}
              </span>
            </div>
          )}

          <nav className="hidden items-center gap-1 md:flex">
            <Link href="/app" className={gatedActive}>
              <span className="inline-flex h-4 w-4 items-center justify-center text-white/80">
                <HomeIcon />
              </span>
              <span>Início</span>
            </Link>
            {allowAnuncios ? (
              <Link href="/app/anuncios" className={gatedActive}>
                <span className="inline-flex h-4 w-4 items-center justify-center text-white/80">
                  <MegaphoneIcon />
                </span>
                <span>Anúncios</span>
              </Link>
            ) : (
              <Link
                href="/app/configuracao"
                className={gatedBlocked}
                title="Passo 1: conecte sua conta do Mercado Livre em Configuração."
              >
                <span className="inline-flex h-4 w-4 items-center justify-center text-white/50">
                  <MegaphoneIcon />
                </span>
                <span>Anúncios</span>
              </Link>
            )}
            {allowPrecoAtacado ? (
              <Link href="/app/atacado" className={gatedActive}>
                <span className="inline-flex h-4 w-4 items-center justify-center text-white/80">
                  <BoxesIcon />
                </span>
                <span>Atacado</span>
              </Link>
            ) : (
              <Link
                href={precoAtacadoBlocked}
                className={gatedBlocked}
                title="Disponível após sincronizar anúncios e importar produtos."
              >
                <span className="inline-flex h-4 w-4 items-center justify-center text-white/50">
                  <BoxesIcon />
                </span>
                <span>Atacado</span>
              </Link>
            )}
            {allowProdutos ? (
              <Link href="/app/produtos" className={gatedActive}>
                <span className="inline-flex h-4 w-4 items-center justify-center text-white/80">
                  <TagIcon />
                </span>
                <span>Produtos</span>
              </Link>
            ) : (
              <Link
                href={produtosBlocked}
                className={gatedBlocked}
                title={
                  !status?.ml_connected
                    ? "Conecte o Mercado Livre antes de gerenciar produtos."
                    : "Sincronize os anúncios antes de importar produtos."
                }
              >
                <span className="inline-flex h-4 w-4 items-center justify-center text-white/50">
                  <TagIcon />
                </span>
                <span>Produtos</span>
              </Link>
            )}
            {allowPrecoAtacado ? (
              <Link href="/app/precos" className={gatedActive}>
                <span className="inline-flex h-4 w-4 items-center justify-center text-white/80">
                  <PriceIcon />
                </span>
                <span>Preço</span>
              </Link>
            ) : (
              <Link
                href={precoAtacadoBlocked}
                className={gatedBlocked}
                title="Disponível após sincronizar anúncios e importar produtos."
              >
                <span className="inline-flex h-4 w-4 items-center justify-center text-white/50">
                  <PriceIcon />
                </span>
                <span>Preço</span>
              </Link>
            )}
            {allowPrecoAtacado ? (
              <Link href="/app/promocoes" className={gatedActive}>
                <span className="inline-flex h-4 w-4 items-center justify-center text-white/80">
                  <PromoIcon />
                </span>
                <span>Promoções</span>
              </Link>
            ) : (
              <Link
                href={precoAtacadoBlocked}
                className={gatedBlocked}
                title="Disponível após sincronizar anúncios e importar produtos."
              >
                <span className="inline-flex h-4 w-4 items-center justify-center text-white/50">
                  <PromoIcon />
                </span>
                <span>Promoções</span>
              </Link>
            )}
            <Link href="/app/configuracao" className={gatedActive}>
              <span className="inline-flex h-4 w-4 items-center justify-center text-white/80">
                <SettingsIcon />
              </span>
              <span>Configuração</span>
            </Link>
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="ml-2 rounded-app border border-white/20 bg-white/5 px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/15 hover:text-white"
              >
                Sair
              </button>
            </form>
          </nav>

          <button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            className="inline-flex items-center justify-center rounded-app p-2 text-white/90 ring-primary-light transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 md:hidden"
            aria-label="Abrir menu"
            aria-expanded={isMenuOpen}
          >
            {isMenuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>

        {isMenuOpen && (
          <div className="border-t border-primary-darker/40 bg-primary-darker/95 backdrop-blur md:hidden">
            {accountLabel && (
              <div className="mx-auto w-full max-w-6xl px-4 pt-3 pb-2">
                <span className="text-xs font-medium text-white/70">Conta Mercado Livre</span>
                <p className="truncate rounded-app border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-white backdrop-blur">
                  {accountLabel}
                </p>
              </div>
            )}
            <nav className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-3">
              <Link
                href="/app"
                onClick={() => setIsMenuOpen(false)}
                className="flex items-center gap-3 rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
              >
                <span className="inline-flex h-4 w-4 items-center justify-center text-white/80">
                  <HomeIcon />
                </span>
                <span>Início</span>
              </Link>
              {allowAnuncios ? (
                <Link
                  href="/app/anuncios"
                  onClick={() => setIsMenuOpen(false)}
                  className="flex items-center gap-3 rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center text-white/80">
                    <MegaphoneIcon />
                  </span>
                  <span>Anúncios</span>
                </Link>
              ) : (
                <Link
                  href="/app/configuracao"
                  onClick={() => setIsMenuOpen(false)}
                  className="flex items-center gap-3 rounded-app px-3 py-2 text-sm font-medium text-white/45 transition hover:bg-white/5 hover:text-white/65"
                  title="Passo 1: conecte sua conta do Mercado Livre em Configuração."
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center text-white/50">
                    <MegaphoneIcon />
                  </span>
                  <span>Anúncios</span>
                </Link>
              )}
              {allowPrecoAtacado ? (
                <Link
                  href="/app/atacado"
                  onClick={() => setIsMenuOpen(false)}
                  className="flex items-center gap-3 rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center text-white/80">
                    <BoxesIcon />
                  </span>
                  <span>Atacado</span>
                </Link>
              ) : (
                <Link
                  href={precoAtacadoBlocked}
                  onClick={() => setIsMenuOpen(false)}
                  className="flex items-center gap-3 rounded-app px-3 py-2 text-sm font-medium text-white/45 transition hover:bg-white/5 hover:text-white/65"
                  title="Disponível após sincronizar anúncios e importar produtos."
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center text-white/50">
                    <BoxesIcon />
                  </span>
                  <span>Atacado</span>
                </Link>
              )}
              {allowProdutos ? (
                <Link
                  href="/app/produtos"
                  onClick={() => setIsMenuOpen(false)}
                  className="flex items-center gap-3 rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center text-white/80">
                    <TagIcon />
                  </span>
                  <span>Produtos</span>
                </Link>
              ) : (
                <Link
                  href={produtosBlocked}
                  onClick={() => setIsMenuOpen(false)}
                  className="flex items-center gap-3 rounded-app px-3 py-2 text-sm font-medium text-white/45 transition hover:bg-white/5 hover:text-white/65"
                  title={
                    !status?.ml_connected
                      ? "Conecte o Mercado Livre antes de gerenciar produtos."
                      : "Sincronize os anúncios antes de importar produtos."
                  }
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center text-white/50">
                    <TagIcon />
                  </span>
                  <span>Produtos</span>
                </Link>
              )}
              {allowPrecoAtacado ? (
                <Link
                  href="/app/precos"
                  onClick={() => setIsMenuOpen(false)}
                  className="flex items-center gap-3 rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center text-white/80">
                    <PriceIcon />
                  </span>
                  <span>Preço</span>
                </Link>
              ) : (
                <Link
                  href={precoAtacadoBlocked}
                  onClick={() => setIsMenuOpen(false)}
                  className="flex items-center gap-3 rounded-app px-3 py-2 text-sm font-medium text-white/45 transition hover:bg-white/5 hover:text-white/65"
                  title="Disponível após sincronizar anúncios e importar produtos."
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center text-white/50">
                    <PriceIcon />
                  </span>
                  <span>Preço</span>
                </Link>
              )}
              {allowPrecoAtacado ? (
                <Link
                  href="/app/promocoes"
                  onClick={() => setIsMenuOpen(false)}
                  className="flex items-center gap-3 rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center text-white/80">
                    <PromoIcon />
                  </span>
                  <span>Promoções</span>
                </Link>
              ) : (
                <Link
                  href={precoAtacadoBlocked}
                  onClick={() => setIsMenuOpen(false)}
                  className="flex items-center gap-3 rounded-app px-3 py-2 text-sm font-medium text-white/45 transition hover:bg-white/5 hover:text-white/65"
                  title="Disponível após sincronizar anúncios e importar produtos."
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center text-white/50">
                    <PromoIcon />
                  </span>
                  <span>Promoções</span>
                </Link>
              )}
              <Link
                href="/app/configuracao"
                onClick={() => setIsMenuOpen(false)}
                className="flex items-center gap-3 rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
              >
                <span className="inline-flex h-4 w-4 items-center justify-center text-white/80">
                  <SettingsIcon />
                </span>
                <span>Configuração</span>
              </Link>
              <form action="/api/auth/logout" method="post" className="pt-1">
                <button
                  type="submit"
                  className="w-full rounded-app border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/20"
                >
                  Sair
                </button>
              </form>
            </nav>
          </div>
        )}
      </header>

      <main
        className="w-full px-3 py-4 sm:px-4 sm:py-6"
        style={{ color: "var(--body-text)" }}
      >
        <Suspense fallback={<div className="min-h-24 animate-pulse rounded-app bg-stroke/50" />}>
          {children}
        </Suspense>
      </main>
    </div>
  );
}

function AppLayoutInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [accounts, setAccounts] = useState<MLAccount[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/mercadolivre/accounts");
    if (res.ok) {
      const data = await res.json();
      const list = data.accounts ?? [];
      setAccounts(list);
      if (list.length > 0 && !accountId) {
        const fromUrl = searchParams.get("accountId");
        const fromStorage =
          typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        const next = fromUrl ?? fromStorage ?? list[0].id;
        setAccountId(next);
        if (typeof window !== "undefined" && next) {
          localStorage.setItem(STORAGE_KEY, next);
        }
      }
    }
  }, [accountId, searchParams]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    const fromUrl = searchParams.get("accountId");
    if (fromUrl && fromUrl !== accountId) setAccountId(fromUrl);
  }, [searchParams]);

  // Sincroniza URL com a conta salva quando a página não tem accountId (ex.: /app/anuncios)
  useEffect(() => {
    if (!accountId || !pathname) return;
    const inUrl = searchParams.get("accountId");
    if (inUrl === accountId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("accountId", accountId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só queremos rodar quando accountId/pathname mudam, não searchParams
  }, [accountId, pathname]);

  const currentAccount = accounts.find((a) => a.id === accountId);
  const accountLabel = currentAccount
    ? currentAccount.ml_nickname || `Conta ${currentAccount.ml_user_id}` || currentAccount.id.slice(0, 8)
    : "";

  const admintyShell = true;

  return (
    <OnboardingProvider accountId={accountId}>
      <AppShell
        accountLabel={accountLabel}
        isMenuOpen={isMenuOpen}
        setIsMenuOpen={setIsMenuOpen}
        admintyShell={admintyShell}
      >
        {children}
      </AppShell>
    </OnboardingProvider>
  );
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<AppLayoutFallback />}>
      <AppLayoutInner>{children}</AppLayoutInner>
    </Suspense>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M4 11.5L12 4l8 7.5V20a1 1 0 0 1-1 1h-4.5a.5.5 0 0 1-.5-.5V15h-4v5.5a.5.5 0 0 1-.5.5H5a1 1 0 0 1-1-1v-8.5z"
        className="fill-white/90"
      />
    </svg>
  );
}

function MegaphoneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M3 10.5v3a1 1 0 0 0 1.3.95l2.7-.9V18a1 1 0 0 0 1 1h1.5a1 1 0 0 0 .97-.76L12 14.5l6.7 2.23A1 1 0 0 0 20 15.78V5.72a1 1 0 0 0-1.3-.95L11.3 7.5H7a1 1 0 0 0-.32.05l-2.38.79A1 1 0 0 0 3 9.29v1.21z"
        className="fill-white/90"
      />
    </svg>
  );
}

function BoxesIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"
        className="fill-white/90"
      />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M3 5a2 2 0 0 1 2-2h5.586a2 2 0 0 1 1.414.586l7.414 7.414a2 2 0 0 1 0 2.828l-4.172 4.172a2 2 0 0 1-2.828 0L5.586 13A2 2 0 0 1 5 11.586V5z"
        className="fill-white/90"
      />
      <circle cx="8" cy="8" r="1.5" className="fill-primary-light" />
    </svg>
  );
}

function PriceIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M12 3a1 1 0 0 1 1 1v1.07A4.5 4.5 0 0 1 16.5 9H15a2.5 2.5 0 0 0-5 0c0 1.1.72 1.79 2.24 2.21l1.52.43C16 12.4 18 14.06 18 17a5 5 0 0 1-4 4.9V22a1 1 0 0 1-2 0v-.99A4.5 4.5 0 0 1 7.5 17H9a2.5 2.5 0 0 0 5 0c0-1.16-.74-1.9-2.38-2.34l-1.44-.4C8 13.7 6 11.98 6 9a5 5 0 0 1 4-4.9V4a1 1 0 0 1 1-1z"
        className="fill-white/90"
      />
    </svg>
  );
}

function PromoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M7 4h10l-1 5H8L7 4zm0 7h10l-2.2 9H9.2L7 11zm2.5 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"
        className="fill-white/90"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5z"
        className="fill-white/90"
      />
      <path
        d="M4.93 6.14a1 1 0 0 1 1.37-.36l1.06.61a6.9 6.9 0 0 1 1.77-.73l.2-1.23A1 1 0 0 1 10.32 3h3.36a1 1 0 0 1 .99.83l.2 1.23a6.9 6.9 0 0 1 1.77.73l1.06-.61a1 1 0 0 1 1.37.36l1.68 2.91a1 1 0 0 1-.25 1.29l-.99.78c.04.25.06.51.06.76s-.02.51-.06.76l.99.78a1 1 0 0 1 .25 1.29l-1.68 2.91a1 1 0 0 1-1.37.36l-1.06-.61a6.9 6.9 0 0 1-1.77.73l-.2 1.23a1 1 0 0 1-.99.83h-3.36a1 1 0 0 1-.99-.83l-.2-1.23a6.9 6.9 0 0 1-1.77-.73l-1.06.61a1 1 0 0 1-1.37-.36L3.25 15a1 1 0 0 1 .25-1.29l.99-.78A6.8 6.8 0 0 1 4.5 12c0-.25.02-.51.06-.76l-.99-.78A1 1 0 0 1 3.25 9l1.68-2.86z"
        className="fill-white/70"
      />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        className="stroke-white/90"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        className="stroke-white/90"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
