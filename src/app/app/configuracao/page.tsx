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

interface ShippingCostRange {
  id: number;
  weight_min_kg: number;
  weight_max_kg: number | null;
  weight_label: string;
  cost_0_to_18: number;
  cost_19_to_48: number;
  cost_49_to_78: number;
  cost_79_to_99: number;
  cost_100_to_119: number;
  cost_120_to_149: number;
  cost_150_to_199: number;
  cost_200_plus: number;
}

interface SellerReputation {
  level_id: string | null;
  power_seller_status: string | null;
  real_level?: string;
  protection_end_date?: string;
  transactions: {
    canceled: number;
    completed: number;
    period: string;
    ratings: {
      negative: number;
      neutral: number;
      positive: number;
    };
    total: number;
  };
  metrics: {
    sales: {
      period: string;
      completed: number;
    };
    claims: {
      period: string;
      rate: number;
      value: number;
    };
    delayed_handling_time: {
      period: string;
      rate: number;
      value: number;
    };
    cancellations: {
      period: string;
      rate: number;
      value: number;
    };
  };
}

interface ReputationData {
  user_id: number;
  nickname: string;
  reputation: SellerReputation;
}

function getReputationColor(levelId: string | null): { bg: string; text: string; label: string } {
  if (!levelId) return { bg: "bg-gray-100", text: "text-gray-600", label: "Sem reputação" };
  
  if (levelId.includes("green")) return { bg: "bg-green-100", text: "text-green-800", label: "Verde" };
  if (levelId.includes("yellow")) return { bg: "bg-yellow-100", text: "text-yellow-800", label: "Amarelo" };
  if (levelId.includes("orange")) return { bg: "bg-orange-100", text: "text-orange-800", label: "Laranja" };
  if (levelId.includes("red")) return { bg: "bg-red-100", text: "text-red-800", label: "Vermelho" };
  
  return { bg: "bg-gray-100", text: "text-gray-600", label: levelId };
}

function getMercadoLiderLabel(status: string | null): { bg: string; text: string; label: string } | null {
  if (!status) return null;
  
  switch (status.toLowerCase()) {
    case "platinum":
      return { bg: "bg-gradient-to-r from-slate-200 to-slate-300", text: "text-slate-800", label: "MercadoLíder Platinum" };
    case "gold":
      return { bg: "bg-gradient-to-r from-yellow-200 to-yellow-300", text: "text-yellow-800", label: "MercadoLíder Gold" };
    case "silver":
      return { bg: "bg-gradient-to-r from-gray-200 to-gray-300", text: "text-gray-700", label: "MercadoLíder" };
    default:
      return null;
  }
}

function formatPercent(value: number): string {
  return (value * 100).toFixed(1).replace(".", ",") + "%";
}

function ConfiguracaoContent() {
  const [accounts, setAccounts] = useState<MLAccountRow[]>([]);
  const [shippingCosts, setShippingCosts] = useState<ShippingCostRange[]>([]);
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [shippingLoading, setShippingLoading] = useState(true);
  const [reputationLoading, setReputationLoading] = useState(true);
  const searchParams = useSearchParams();

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/mercadolivre/accounts");
    if (res.ok) {
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    }
    setLoading(false);
  }, []);

  const loadShippingCosts = useCallback(async () => {
    const res = await fetch("/api/shipping-costs");
    if (res.ok) {
      const data = await res.json();
      setShippingCosts(data.costs ?? []);
    }
    setShippingLoading(false);
  }, []);

  const loadReputation = useCallback(async () => {
    const res = await fetch("/api/mercadolivre/reputation");
    if (res.ok) {
      const data = await res.json();
      setReputation(data);
    }
    setReputationLoading(false);
  }, []);

  useEffect(() => {
    loadAccounts();
    loadShippingCosts();
    loadReputation();
  }, [loadAccounts, loadShippingCosts, loadReputation]);

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

      {accounts.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-medium text-gray-900">Reputação do Vendedor</h2>
          <p className="mb-4 text-gray-600">
            Métricas de qualidade da sua conta no Mercado Livre.
          </p>

          {reputationLoading ? (
            <p className="text-gray-500">Carregando reputação…</p>
          ) : !reputation ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-amber-800">Não foi possível carregar a reputação.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                {(() => {
                  const repColor = getReputationColor(reputation.reputation.level_id);
                  return (
                    <span className={`rounded-full px-4 py-2 text-sm font-semibold ${repColor.bg} ${repColor.text}`}>
                      Reputação: {repColor.label}
                    </span>
                  );
                })()}
                {(() => {
                  const mlStatus = getMercadoLiderLabel(reputation.reputation.power_seller_status);
                  return mlStatus ? (
                    <span className={`rounded-full px-4 py-2 text-sm font-semibold ${mlStatus.bg} ${mlStatus.text}`}>
                      {mlStatus.label}
                    </span>
                  ) : null;
                })()}
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-sm text-gray-500">Vendas Concluídas</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">
                    {reputation.reputation.metrics.sales.completed}
                  </p>
                  <p className="text-xs text-gray-400">
                    Período: {reputation.reputation.metrics.sales.period}
                  </p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-sm text-gray-500">Taxa de Reclamações</p>
                  <p className={`mt-1 text-2xl font-bold ${
                    reputation.reputation.metrics.claims.rate <= 0.02 ? "text-green-600" :
                    reputation.reputation.metrics.claims.rate <= 0.045 ? "text-yellow-600" :
                    reputation.reputation.metrics.claims.rate <= 0.08 ? "text-orange-600" : "text-red-600"
                  }`}>
                    {formatPercent(reputation.reputation.metrics.claims.rate)}
                  </p>
                  <p className="text-xs text-gray-400">
                    {reputation.reputation.metrics.claims.value} reclamações
                  </p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-sm text-gray-500">Atrasos no Envio</p>
                  <p className={`mt-1 text-2xl font-bold ${
                    reputation.reputation.metrics.delayed_handling_time.rate <= 0.10 ? "text-green-600" :
                    reputation.reputation.metrics.delayed_handling_time.rate <= 0.18 ? "text-yellow-600" :
                    reputation.reputation.metrics.delayed_handling_time.rate <= 0.22 ? "text-orange-600" : "text-red-600"
                  }`}>
                    {formatPercent(reputation.reputation.metrics.delayed_handling_time.rate)}
                  </p>
                  <p className="text-xs text-gray-400">
                    {reputation.reputation.metrics.delayed_handling_time.value} envios atrasados
                  </p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-sm text-gray-500">Taxa de Cancelamentos</p>
                  <p className={`mt-1 text-2xl font-bold ${
                    reputation.reputation.metrics.cancellations.rate <= 0.015 ? "text-green-600" :
                    reputation.reputation.metrics.cancellations.rate <= 0.035 ? "text-yellow-600" :
                    reputation.reputation.metrics.cancellations.rate <= 0.04 ? "text-orange-600" : "text-red-600"
                  }`}>
                    {formatPercent(reputation.reputation.metrics.cancellations.rate)}
                  </p>
                  <p className="text-xs text-gray-400">
                    {reputation.reputation.metrics.cancellations.value} cancelamentos
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <h3 className="mb-3 text-sm font-medium text-gray-900">Qualificações dos Compradores</h3>
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-green-600">Positivas</span>
                      <span className="font-medium">{formatPercent(reputation.reputation.transactions.ratings.positive)}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full bg-green-500"
                        style={{ width: `${reputation.reputation.transactions.ratings.positive * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-gray-500">Neutras</span>
                      <span className="font-medium">{formatPercent(reputation.reputation.transactions.ratings.neutral)}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full bg-gray-400"
                        style={{ width: `${reputation.reputation.transactions.ratings.neutral * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-red-600">Negativas</span>
                      <span className="font-medium">{formatPercent(reputation.reputation.transactions.ratings.negative)}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full bg-red-500"
                        style={{ width: `${reputation.reputation.transactions.ratings.negative * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-xs text-gray-500">
                  Total histórico: {reputation.reputation.transactions.total} transações
                  ({reputation.reputation.transactions.completed} concluídas, {reputation.reputation.transactions.canceled} canceladas)
                </p>
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="text-sm text-blue-800">
                  <strong>Limites para MercadoLíder (MLB):</strong>
                </p>
                <ul className="mt-2 grid gap-2 text-xs text-blue-700 sm:grid-cols-3">
                  <li>Reclamações: ≤ 1%</li>
                  <li>Cancelamentos: ≤ 0,5%</li>
                  <li>Atrasos: ≤ 6%</li>
                </ul>
              </div>

              <p className="text-xs text-gray-500">
                Fonte:{" "}
                <a
                  href="https://developers.mercadolivre.com.br/pt_br/reputacao-de-vendedores"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  developers.mercadolivre.com.br
                </a>
              </p>
            </div>
          )}
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Tabela de Frete - Mercado Livre</h2>
        <p className="mb-4 text-gray-600">
          Custos de envio para MercadoLíderes e vendedores com reputação verde.
          Válido para Agências ML, Envios com Coleta e Full.
        </p>

        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm text-blue-800">
            <strong>Regras de frete grátis (válido a partir de 2 de março de 2026):</strong>
          </p>
          <ul className="mt-2 list-inside list-disc text-sm text-blue-700">
            <li>Produtos de R$ 19 a R$ 78,99: frete grátis padrão oferecido pelo ML</li>
            <li>Produtos ≥ R$ 79: você oferece frete grátis e rápido</li>
            <li>Produtos &lt; R$ 19: custo máximo é metade do preço do produto</li>
          </ul>
        </div>

        {shippingLoading ? (
          <p className="text-gray-500">Carregando tabela de frete…</p>
        ) : shippingCosts.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-amber-800">
              Tabela de frete não encontrada. Execute a migration 008_ml_shipping_costs.sql no Supabase.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="whitespace-nowrap px-3 py-3 text-left font-semibold text-gray-900">
                    Peso
                  </th>
                  <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-900">
                    R$ 0-18
                  </th>
                  <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-900">
                    R$ 19-48
                  </th>
                  <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-900">
                    R$ 49-78
                  </th>
                  <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-900">
                    R$ 79-99
                  </th>
                  <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-900">
                    R$ 100-119
                  </th>
                  <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-900">
                    R$ 120-149
                  </th>
                  <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-900">
                    R$ 150-199
                  </th>
                  <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-900">
                    ≥ R$ 200
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {shippingCosts.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">
                      {row.weight_label}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-600">
                      R$ {Number(row.cost_0_to_18).toFixed(2).replace(".", ",")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-600">
                      R$ {Number(row.cost_19_to_48).toFixed(2).replace(".", ",")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-600">
                      R$ {Number(row.cost_49_to_78).toFixed(2).replace(".", ",")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-600">
                      R$ {Number(row.cost_79_to_99).toFixed(2).replace(".", ",")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-600">
                      R$ {Number(row.cost_100_to_119).toFixed(2).replace(".", ",")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-600">
                      R$ {Number(row.cost_120_to_149).toFixed(2).replace(".", ",")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-600">
                      R$ {Number(row.cost_150_to_199).toFixed(2).replace(".", ",")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-600">
                      R$ {Number(row.cost_200_plus).toFixed(2).replace(".", ",")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-gray-500">
          Fonte:{" "}
          <a
            href="https://www.mercadolivre.com.br/ajuda/custos-envio-reputacao-verde-sem-reputacao_48392"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            mercadolivre.com.br/ajuda/custos-envio-reputacao-verde-sem-reputacao_48392
          </a>
        </p>
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
