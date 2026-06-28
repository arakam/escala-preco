"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ML_MAX_CAMPAIGN_DISCOUNT_PERCENT, ML_MIN_CAMPAIGN_DISCOUNT_PERCENT } from "./precos-table-utils";

type BulkModalBusyRef = { current: boolean };

export function PrecosBulkDiscountModal({
  open,
  busyRef,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busyRef: BulkModalBusyRef;
  onClose: () => void;
  onConfirm: (percentInput: string) => void | Promise<void>;
}) {
  const [percentInput, setPercentInput] = useState(String(ML_MIN_CAMPAIGN_DISCOUNT_PERCENT));
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      setPercentInput(String(ML_MIN_CAMPAIGN_DISCOUNT_PERCENT));
    }
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => !busyRef.current && onClose()}
      />
      <div className="relative w-full max-w-md rounded-lg bg-card p-6 shadow-xl dark:border dark:border-slate-600">
        <h2 className="mb-2 text-lg font-semibold">Desconto em massa (selecionados)</h2>
        <p className="mb-4 text-xs text-fg-muted">
          Defina o desconto de promoção para os itens selecionados. Mínimo {ML_MIN_CAMPAIGN_DISCOUNT_PERCENT}% (regra ML) e máximo {ML_MAX_CAMPAIGN_DISCOUNT_PERCENT}% para modalidades configuráveis pelo seller (LIGHTNING, DOD, SELLER_CAMPAIGN, DEAL e PRICE_DISCOUNT). Ao aplicar, o modal fecha e a taxa é estimada pela referência do cache (sem listing_prices por item); use <strong>Recalcular taxa e frete</strong> (menu Ações) se quiser alinhar ao ML.
        </p>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void onConfirm(percentInput);
          }}
        >
          <div>
            <label className="mb-1 block text-sm text-fg">Desconto desejado (%)</label>
            <input
              type="text"
              inputMode="decimal"
              value={percentInput}
              onChange={(e) => setPercentInput(e.target.value)}
              className="input w-full py-2 text-sm"
              placeholder={`Ex.: ${ML_MIN_CAMPAIGN_DISCOUNT_PERCENT} ou 12,5`}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary px-4 py-2 text-sm"
              disabled={busyRef.current}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busyRef.current}
              className="btn btn-primary text-sm disabled:opacity-50"
            >
              Aplicar nos selecionados
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

export function PrecosBulkMarginModal({
  open,
  busyRef,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busyRef: BulkModalBusyRef;
  onClose: () => void;
  onConfirm: (percentInput: string) => void | Promise<void>;
}) {
  const [percentInput, setPercentInput] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      setPercentInput("");
    }
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => !busyRef.current && onClose()}
      />
      <div className="relative w-full max-w-md rounded-lg bg-card p-6 shadow-xl dark:border dark:border-slate-600">
        <h2 className="mb-2 text-lg font-semibold">Margem nos selecionados</h2>
        <p className="mb-4 text-xs text-fg-muted">
          Aplica a mesma margem líquida desejada (valor a receber − custo, sobre o preço calculado) em todos os anúncios marcados que tenham custo e tipo de listagem. Processamento em lote no servidor (taxa de referência + frete em tabela, até 3 passadas por faixa de frete). Confira depois com <strong>Recalcular taxa e frete</strong> (menu Ações) se quiser alinhar a taxa exata do ML.
        </p>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void onConfirm(percentInput);
          }}
        >
          <div>
            <label className="mb-1 block text-sm text-fg">Margem líquida desejada (%)</label>
            <input
              type="text"
              inputMode="decimal"
              value={percentInput}
              onChange={(e) => setPercentInput(e.target.value)}
              className="input w-full py-2 text-sm"
              placeholder="Ex.: 18 ou 12,5"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary px-4 py-2 text-sm"
              disabled={busyRef.current}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busyRef.current}
              className="btn btn-primary text-sm disabled:opacity-50"
            >
              Aplicar nos selecionados
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
