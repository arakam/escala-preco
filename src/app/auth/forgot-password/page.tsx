"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { getAppOrigin } from "@/lib/app-url";

function ForgotForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const linkErr = searchParams.get("erro") === "link";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const origin = getAppOrigin();
      /** Passa por /auth/confirm para trocar code/token_hash por sessão em cookie (PKCE). */
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${origin}/auth/confirm?next=/auth/reset-password`,
      });
      if (err) {
        setError(err.message || "Não foi possível enviar o email. Tente de novo.");
        return;
      }
      setInfo(
        "Se existir uma conta com este email, enviamos um link de recuperação. Confira a caixa de entrada e o spam."
      );
    } catch (unknownErr) {
      setError(
        unknownErr instanceof Error ? unknownErr.message : "Erro inesperado. Tente novamente."
      );
    } finally {
      setLoading(false);
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
        <h1 className="mb-1 text-xl font-semibold text-fg-strong">Recuperar senha</h1>
        <p className="mb-4 text-sm text-fg-muted">
          Informe seu email. Você receberá um link para criar uma nova senha.
        </p>
        {linkErr && (
          <p className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            O link expirou ou já foi usado. Solicite um novo email abaixo.
          </p>
        )}
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
          {error && (
            <p className="rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
          {info && (
            <p className="rounded bg-green-50 p-2 text-sm text-green-800 dark:bg-green-950/40 dark:text-green-200">
              {info}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary mt-2 w-full py-2.5 font-medium disabled:opacity-50"
          >
            {loading ? "Enviando…" : "Enviar link"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-fg">
          <Link
            href="/auth/login"
            className="font-medium text-brand-blue hover:text-brand-blue-light hover:underline dark:text-blue-400 dark:hover:text-blue-300"
          >
            Voltar ao login
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-canvas">
          <p className="text-fg-muted">Carregando…</p>
        </main>
      }
    >
      <ForgotForm />
    </Suspense>
  );
}
