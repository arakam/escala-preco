"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface MLAccountRow {
  id: string;
  ml_user_id: number;
  ml_nickname: string | null;
  site_id: string | null;
  created_at: string;
}

function ConfiguracaoContent() {
  const [accounts, setAccounts] = useState<MLAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/mercadolivre/accounts");
    if (res.ok) {
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    const message = searchParams.get("message");
    if (connected === "1") {
      window.history.replaceState({}, "", "/app/configuracao");
      setLoading(true);
      loadAccounts().finally(() => setLoading(false));
    }
    if (error) {
      const reason = searchParams.get("reason");
      const defaultMessages: Record<string, string> = {
        cookie_missing:
          "Cookie de sessão não encontrado. Ao autorizar no Mercado Livre, não feche a aba do EscalaPreço e volte na mesma aba. Em produção, use a mesma URL (ex.: https://escalapreco.unityerp.app) em todo o fluxo.",
        state_invalid: "Segurança: state inválido. Tente conectar novamente.",
        redirect_uri_or_code:
          "A Redirect URI do seu app no Mercado Livre deve ser EXATAMENTE: " +
          (typeof window !== "undefined" ? `${window.location.origin}/api/mercadolivre/callback` : "sua URL + /api/mercadolivre/callback") +
          " — sem barra no final. Verifique no painel developers.mercadolivre.com.br.",
        token_exchange: "Falha ao trocar o código por token. Verifique Client ID, Secret e Redirect URI no .env e no app ML.",
        env_missing: "Configuração do servidor incompleta (variáveis de ambiente).",
        network: "Erro de rede. Tente novamente.",
        me_failed: "Não foi possível obter seus dados do Mercado Livre. Tente de novo.",
        db_error: "Erro ao salvar no banco. Verifique permissões (RLS) no Supabase.",
        already_connected: "Apenas uma conta do Mercado Livre é permitida por login.",
      };
      const text = message || defaultMessages[reason || ""] || "Falha ao conectar com o Mercado Livre. Verifique: 1) Redirect URI no app ML = sua URL + /api/mercadolivre/callback; 2) Não fechar a aba antes de autorizar.";
      window.history.replaceState({}, "", "/app/configuracao");
      alert(text);
    }
  }, [searchParams, loadAccounts]);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-gray-500">Carregando…</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h1 className="mb-4 text-xl font-semibold">Configuração</h1>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Mercado Livre</h2>
        <p className="mb-4 text-gray-600">
          Conecte sua conta do Mercado Livre para sincronizar anúncios e gerenciar preços.
        </p>

        {accounts.length === 0 ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-200 text-amber-800">
                !
              </span>
              <div>
                <p className="font-medium text-amber-800">Não conectado</p>
                <p className="text-sm text-amber-700">
                  Nenhuma conta do Mercado Livre está conectada. Clique abaixo para autorizar.
                </p>
              </div>
            </div>
            <a
              href="/api/mercadolivre/auth"
              className="inline-flex w-fit items-center gap-2 rounded bg-yellow-400 px-4 py-2 font-medium text-gray-900 hover:bg-yellow-500"
            >
              Conectar conta Mercado Livre
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-200 text-green-800">
                ✓
              </span>
              <div>
                <p className="font-medium text-green-800">Conectado</p>
                <p className="text-sm text-green-700">
                  Conta do Mercado Livre conectada.
                </p>
              </div>
            </div>
            <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
              {accounts.map((acc) => (
                <li key={acc.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <span className="font-medium">{acc.ml_nickname || `ID ${acc.ml_user_id}`}</span>
                    {acc.site_id && (
                      <span className="ml-2 text-sm text-gray-500">({acc.site_id})</span>
                    )}
                  </div>
                  <span className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
                    Ativo
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

export default function ConfiguracaoPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <p className="text-gray-500">Carregando…</p>
        </div>
      }
    >
      <ConfiguracaoContent />
    </Suspense>
  );
}
