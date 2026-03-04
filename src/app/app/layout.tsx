 "use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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

          {/* Navegação desktop */}
          <nav className="hidden items-center gap-1 md:flex">
            <NavLink href="/app" label="Início">
              <HomeIcon />
            </NavLink>
            <NavLink href="/app/anuncios" label="Anúncios">
              <MegaphoneIcon />
            </NavLink>
            <NavLink href="/app/atacado" label="Atacado">
              <BoxesIcon />
            </NavLink>
            <NavLink href="/app/produtos" label="Produtos">
              <TagIcon />
            </NavLink>
            <NavLink href="/app/precos" label="Preço">
              <PriceIcon />
            </NavLink>
            <NavLink href="/app/configuracao" label="Configuração">
              <SettingsIcon />
            </NavLink>
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="ml-2 inline-flex items-center gap-2 rounded-app bg-white/5 px-3 py-2 text-sm font-medium text-white/90 backdrop-blur transition hover:bg-white/15 hover:text-orange-100"
              >
                <LogoutIcon />
                <span>Sair</span>
              </button>
            </form>
          </nav>

          {/* Botão mobile */}
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

        {/* Menu mobile */}
        {isMenuOpen && (
          <div className="border-t border-primary-darker/40 bg-primary-darker/95 backdrop-blur md:hidden">
            <nav className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-3">
              <MobileNavLink href="/app" onClick={() => setIsMenuOpen(false)}>
                <HomeIcon />
                <span>Início</span>
              </MobileNavLink>
              <MobileNavLink href="/app/anuncios" onClick={() => setIsMenuOpen(false)}>
                <MegaphoneIcon />
                <span>Anúncios</span>
              </MobileNavLink>
              <MobileNavLink href="/app/atacado" onClick={() => setIsMenuOpen(false)}>
                <BoxesIcon />
                <span>Atacado</span>
              </MobileNavLink>
              <MobileNavLink href="/app/produtos" onClick={() => setIsMenuOpen(false)}>
                <TagIcon />
                <span>Produtos</span>
              </MobileNavLink>
              <MobileNavLink href="/app/precos" onClick={() => setIsMenuOpen(false)}>
                <PriceIcon />
                <span>Preço</span>
              </MobileNavLink>
              <MobileNavLink href="/app/configuracao" onClick={() => setIsMenuOpen(false)}>
                <SettingsIcon />
                <span>Configuração</span>
              </MobileNavLink>
              <form action="/api/auth/logout" method="post" className="pt-1">
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-app bg-white/10 px-3 py-2 text-sm font-medium text-orange-100 backdrop-blur transition hover:bg-white/20"
                >
                  <LogoutIcon />
                  <span>Sair</span>
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
        {children}
      </main>
    </div>
  );
}

type NavLinkProps = {
  href: string;
  label: string;
  children: React.ReactNode;
};

function NavLink({ href, label, children }: NavLinkProps) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
    >
      <span className="inline-flex h-4 w-4 items-center justify-center text-white/80">
        {children}
      </span>
      <span>{label}</span>
    </Link>
  );
}

type MobileNavLinkProps = {
  href: string;
  children: React.ReactNode;
  onClick?: () => void;
};

function MobileNavLink({ href, children, onClick }: MobileNavLinkProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-3 rounded-app px-3 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
    >
      <span className="inline-flex h-4 w-4 items-center justify-center text-white/80">
        {children}
      </span>
      {children && (
        <span className="text-sm font-medium text-white/95">
          {/* O texto vem no children (ícone + label) */}
        </span>
      )}
    </Link>
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

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M10 5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-2h2v1h5V6h-5v1h-2V5z"
        className="fill-white/80"
      />
      <path
        d="M5.3 8.3a1 1 0 0 1 1.4 0L9 10.59V9h2v6H9v-1.59l-2.3 2.29a1 1 0 1 1-1.4-1.42L6.59 12 5.3 10.71a1 1 0 0 1 0-1.41z"
        className="fill-white/90"
      />
    </svg>
  );
}
