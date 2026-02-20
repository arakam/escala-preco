"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (err) {
      setError(err.message || "Erro ao cadastrar. Tente outro email.");
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
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
        <h1 className="mb-4 text-xl font-semibold text-gray-900">Cadastrar</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
              placeholder="seu@email.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Senha (mín. 6 caracteres)
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-gray-900 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
          {error && (
            <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded bg-brand-blue py-2 font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
          >
            {loading ? "Cadastrando…" : "Cadastrar"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-600">
          Já tem conta?{" "}
          <Link href="/auth/login" className="font-medium text-brand-blue hover:text-brand-blue-dark hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
