"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

function parseHashError(): string | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hash.replace(/^#/, "");
  if (!h.includes("error=")) return null;
  const p = new URLSearchParams(h);
  const code = p.get("error_code");
  const desc = p.get("error_description");
  if (code === "otp_expired") {
    return "Este link expirou ou já foi usado (às vezes o antivírus ou o email corporativo abre o link antes de você). Solicite um novo email em Recuperar senha.";
  }
  return desc?.replace(/\+/g, " ") || "Não foi possível validar o link.";
}

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [hashError, setHashError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const hashErr = parseHashError();
    if (hashErr) {
      setHashError(hashErr);
      return;
    }

    const supabase = createClient();
    let cancelled = false;

    async function bootstrap() {
      const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
      const tokenHash = search?.get("token_hash");
      const otpType = search?.get("type");
      if (tokenHash && otpType) {
        const q = new URLSearchParams({ token_hash: tokenHash, type: otpType, next: "/auth/reset-password" });
        window.location.replace(`/auth/confirm?${q.toString()}`);
        return;
      }

      const authCode = search?.get("code");
      if (authCode) {
        const { error } = await supabase.auth.exchangeCodeForSession(authCode);
        if (cancelled) return;
        if (error) {
          setHashError(error.message || "Link inválido.");
          return;
        }
        window.history.replaceState(null, "", window.location.pathname);
        setReady(true);
        return;
      }

      const raw = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
      if (raw) {
        const p = new URLSearchParams(raw);
        const access_token = p.get("access_token");
        const refresh_token = p.get("refresh_token");
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (cancelled) return;
          if (error) {
            setHashError(error.message || "Link inválido.");
            return;
          }
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
          setReady(true);
          return;
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        setReady(true);
        return;
      }

      await new Promise((r) => setTimeout(r, 2500));
      if (cancelled) return;
      const { data: { session: s2 } } = await supabase.auth.getSession();
      if (s2) {
        setReady(true);
        return;
      }
      setHashError(
        "Não foi possível validar o link. Peça um novo em Recuperar senha e abra o email em até alguns minutos."
      );
    }

    void bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setReady(true);
        setHashError(null);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== password2) {
      setError("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) {
        setError(err.message || "Não foi possível atualizar a senha.");
        return;
      }
      window.location.assign("/app");
    } catch (unknownErr) {
      setError(
        unknownErr instanceof Error ? unknownErr.message : "Erro inesperado. Tente novamente."
      );
    } finally {
      setLoading(false);
    }
  }

  if (hashError) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-canvas p-4">
        <div className="w-full max-w-sm rounded-lg border border-stroke bg-card p-6 shadow-sm dark:border-slate-600">
          <div className="mb-6 flex justify-center">
            <Image
              src="/logo.png"
              alt="Escala Preço"
              width={400}
              height={112}
              className="h-28 w-auto object-contain sm:h-32"
              priority
            />
          </div>
          <p className="text-sm text-red-700 dark:text-red-300">{hashError}</p>
          <Link
            href="/auth/forgot-password"
            className="mt-4 inline-block font-medium text-brand-blue hover:underline dark:text-blue-400"
          >
            Solicitar novo link
          </Link>
          <p className="mt-4 text-center text-sm text-fg">
            <Link href="/auth/login" className="text-fg-muted hover:underline">
              Voltar ao login
            </Link>
          </p>
        </div>
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-canvas p-4">
        <div className="w-full max-w-sm rounded-lg border border-stroke bg-card p-6 text-center shadow-sm dark:border-slate-600">
          <p className="text-fg-muted">Validando link…</p>
        </div>
      </main>
    );
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
        <h1 className="mb-4 text-xl font-semibold text-fg-strong">Nova senha</h1>
        <p className="mb-4 text-sm text-fg-muted">Defina uma nova senha para sua conta.</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="password" className="label">
              Nova senha
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
          <div>
            <label htmlFor="password2" className="label">
              Confirmar senha
            </label>
            <input
              id="password2"
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
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
            {loading ? "Salvando…" : "Salvar senha"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-fg">
          <Link href="/auth/login" className="font-medium text-brand-blue hover:underline dark:text-blue-400">
            Cancelar
          </Link>
        </p>
      </div>
    </main>
  );
}
