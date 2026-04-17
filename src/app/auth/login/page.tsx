"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const redirectRaw = searchParams.get("redirect") ?? "/app";

  /** Evita open redirect; só caminhos relativos ao site. */
  function safeRedirect(path: string): string {
    const p = path.trim();
    if (p.startsWith("/") && !p.startsWith("//")) return p;
    return "/app";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    let willNavigate = false;
    try {
      const supabase = createClient();
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (err) {
        setError(err.message || "Erro ao entrar. Verifique email e senha.");
        return;
      }
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        setError(
          "A sessão não foi gravada no navegador. Limpe os cookies de localhost ou tente outro navegador."
        );
        return;
      }
      /*
       * Navegação completa: após login os cookies de sessão precisam ir no próximo request.
       * router.push() (SPA) costuma chegar ao /app antes do middleware enxergar a sessão → loop no login.
       */
      const next = safeRedirect(redirectRaw);
      willNavigate = true;
      window.location.assign(next);
    } catch (unknownErr) {
      setError(
        unknownErr instanceof Error
          ? unknownErr.message
          : "Erro inesperado ao entrar. Verifique o console (F12)."
      );
    } finally {
      if (!willNavigate) setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm rounded-lg border border-stroke bg-card p-6 shadow-sm dark:border-slate-600">
        <div className="mb-8 flex justify-center">
          <Image
            src="/logo.png"
            alt="Escala Preço"
            width={400}
            height={112}
            className="h-32 w-auto object-contain sm:h-40"
            priority
          />
        </div>
        <h1 className="mb-4 text-xl font-semibold text-fg-strong">Entrar</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input mt-1 focus:border-brand-blue focus:ring-brand-blue dark:focus:border-brand-blue-light dark:focus:ring-brand-blue-light"
              placeholder="seu@email.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="label">
              Senha
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="input mt-1 focus:border-brand-blue focus:ring-brand-blue dark:focus:border-brand-blue-light dark:focus:ring-brand-blue-light"
            />
          </div>
          {error && (
            <p className="rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded bg-brand-blue py-2 font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-fg">
          Não tem conta?{" "}
          <Link href="/auth/register" className="font-medium text-brand-blue hover:text-brand-blue-light hover:underline dark:text-blue-400 dark:hover:text-blue-300">
            Cadastrar
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-canvas"><p className="text-fg-muted">Carregando…</p></main>}>
      <LoginForm />
    </Suspense>
  );
}
