"use client";

import React, { useCallback, useEffect, useState } from "react";

export interface ScenarioRow {
  label: string;
  unitPrice: number;
  fee: number;
  freightPlaceholder: string;
  net: number;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

interface ReceivableModalProps {
  open: boolean;
  onClose: () => void;
  accountId: string;
  listingTypeId: string | null;
  categoryId: string | null;
  scenarios: { label: string; unitPrice: number }[];
  onFetchFees: (prices: number[]) => Promise<{ price: number; fee: number; net: number }[] | null>;
}

export function ReceivableModal({
  open,
  onClose,
  accountId,
  listingTypeId,
  categoryId,
  scenarios,
  onFetchFees,
}: ReceivableModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ScenarioRow[]>([]);

  const fetchAndSet = useCallback(async () => {
    if (!listingTypeId || scenarios.length === 0) {
      setRows([]);
      if (scenarios.length === 0) setError("Nenhum preço para simular.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const prices = scenarios.map((s) => s.unitPrice);
      const results = await onFetchFees(prices);
      if (!results || results.length !== scenarios.length) {
        setError("Não foi possível obter as taxas. Tente novamente.");
        setRows([]);
        return;
      }
      setRows(
        scenarios.map((s, i) => ({
          label: s.label,
          unitPrice: s.unitPrice,
          fee: results[i].fee,
          freightPlaceholder: "—",
          net: results[i].net,
        }))
      );
    } catch (e) {
      setError("Erro ao simular. Tente novamente.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [listingTypeId, scenarios, onFetchFees]);

  useEffect(() => {
    if (open && accountId && scenarios.length > 0) {
      fetchAndSet();
    } else if (!open) {
      setRows([]);
      setError(null);
    }
  }, [open, accountId, scenarios, fetchAndSet]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden onClick={onClose} />
      <div
        className="relative z-10 w-full max-w-md rounded-lg border border-stroke bg-card shadow-xl dark:border-slate-600"
        role="dialog"
        aria-labelledby="receivable-title"
      >
        <div className="flex items-center justify-between border-b border-stroke px-4 py-3 dark:border-slate-600">
          <h2 id="receivable-title" className="text-lg font-semibold text-fg-strong">
            Recebível por unidade (est.)
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-fg-muted hover:bg-gray-100 hover:text-fg dark:hover:bg-slate-700"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-3">
          {!listingTypeId ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Tipo de anúncio não disponível para esta linha. Sincronize os anúncios.
            </p>
          ) : loading ? (
            <p className="text-sm text-fg-muted">Carregando…</p>
          ) : error ? (
            <div>
              <p className="mb-2 text-sm text-red-700 dark:text-red-300">{error}</p>
              <button
                type="button"
                onClick={fetchAndSet}
                className="rounded bg-gray-200 px-3 py-1.5 text-sm font-medium text-fg-strong hover:bg-gray-300 dark:bg-slate-600 dark:text-slate-100 dark:hover:bg-slate-500"
              >
                Tentar novamente
              </button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stroke dark:border-slate-600">
                      <th className="p-2 text-left font-medium text-fg">Cenário</th>
                      <th className="p-2 text-right font-medium text-fg">Preço unitário</th>
                      <th className="p-2 text-right font-medium text-fg">Taxa ML (est.)</th>
                      <th className="p-2 text-right font-medium text-fg">Frete</th>
                      <th className="p-2 text-right font-medium text-fg">Você recebe (est.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-b border-stroke/80 dark:border-slate-700">
                        <td className="p-2 text-fg-strong">{r.label}</td>
                        <td className="p-2 text-right font-mono">{formatBRL(r.unitPrice)}</td>
                        <td className="p-2 text-right font-mono text-amber-700 dark:text-amber-300">{formatBRL(r.fee)}</td>
                        <td className="p-2 text-right text-fg-muted">{r.freightPlaceholder}</td>
                        <td className="p-2 text-right font-mono font-medium text-emerald-700 dark:text-emerald-400">{formatBRL(r.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-fg-muted">
                Estimativa por unidade. Frete e promoções não incluídos.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
