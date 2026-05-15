"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingEmailConfirm, setPendingEmailConfirm] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPendingEmailConfirm(false);
    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (err) {
        setError(err.message || "Erro ao cadastrar. Tente outro email.");
        return;
      }
      if (data.session) {
        window.location.assign("/app");
        return;
      }
      setPendingEmailConfirm(true);
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
        <h1
          className={`text-xl font-semibold text-fg-strong ${pendingEmailConfirm ? "mb-4" : "mb-1"}`}
        >
          {pendingEmailConfirm ? "Confirme seu email" : "Cadastrar"}
        </h1>
        {!pendingEmailConfirm && (
          <p className="mb-4 text-sm leading-relaxed text-fg-muted">
            Você receberá um email com um link para confirmar o cadastro antes de poder entrar.
          </p>
        )}
        {pendingEmailConfirm ? (
          <div className="flex flex-col gap-4">
            <div
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 shadow-sm dark:border-amber-800/80 dark:bg-amber-950/40 dark:text-amber-100"
            >
              <p className="font-semibold text-amber-950 dark:text-amber-50">
                Próximo passo: confirme o cadastro no email
              </p>
              <p className="mt-2 leading-relaxed text-amber-900/95 dark:text-amber-100/90">
                Enviamos um link para{" "}
                <span className="font-medium break-all">{email.trim()}</span>. Abra a mensagem e
                confirme para ativar a conta. Se não aparecer em alguns minutos, confira a pasta de
                spam ou lixo eletrônico.
              </p>
            </div>
            <Link
              href="/auth/login"
              className="btn btn-primary w-full py-2.5 text-center font-medium"
            >
              Ir para o login
            </Link>
          </div>
        ) : (
          <>
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
                  Senha (mín. 6 caracteres)
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="input mt-1 focus:border-brand-blue focus:ring-brand-blue dark:focus:border-brand-blue-light dark:focus:ring-brand-blue-light"
                />
              </div>
              {error && (
                <p className="rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary mt-2 w-full py-2.5 font-medium disabled:opacity-50"
              >
                {loading ? "Cadastrando…" : "Cadastrar"}
              </button>
            </form>
            <p className="mt-4 text-center text-sm text-fg">
              Já tem conta?{" "}
              <Link
                href="/auth/login"
                className="font-medium text-brand-blue hover:text-brand-blue-light hover:underline dark:text-blue-400 dark:hover:text-blue-300"
              >
                Entrar
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
