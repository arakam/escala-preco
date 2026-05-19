"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { parseAuthHashError } from "@/lib/auth/parse-hash-error";

function AuthCallbackInner() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hashErr = parseAuthHashError();
    if (hashErr) {
      setError(hashErr);
      return;
    }

    const next = searchParams.get("next") ?? "/auth/reset-password";
    const safeNext =
      next.startsWith("/") && !next.startsWith("//") ? next : "/auth/reset-password";

    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type");
    const code = searchParams.get("code");

    if ((tokenHash && type) || code) {
      const q = new URLSearchParams({ next: safeNext });
      if (tokenHash && type) {
        q.set("token_hash", tokenHash);
        q.set("type", type);
      } else if (code) {
        q.set("code", code);
      }
      window.location.replace(`/api/auth/confirm?${q.toString()}`);
      return;
    }

    setError("Link inválido ou incompleto. Solicite um novo email de recuperação.");
  }, [searchParams]);

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
        {!error ? (
          <p className="text-center text-fg-muted">Validando link…</p>
        ) : (
          <>
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
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
          </>
        )}
      </div>
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-canvas">
          <p className="text-fg-muted">Carregando…</p>
        </main>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}
