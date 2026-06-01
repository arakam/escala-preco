"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  STOCK_COMPARE_OPS,
  stockCompareLabel,
  type StockCompareOp,
} from "@/lib/mercadolivre/item-tags";
import type { ProductTag } from "@/lib/db/types";

const ML_MIN_CAMPAIGN_DISCOUNT_PERCENT = 5;

export type PrecosFiltersValues = {
  search: string;
  skuFilter: string;
  supplierFilter: string;
  statusFilter: string;
  linkFilter: "all" | "linked" | "unlinked";
  fullOnly: boolean;
  filterTagIds: string[];
  sales30dOpFilter: StockCompareOp | "";
  sales30dQtyFilter: string;
  costOpFilter: StockCompareOp | "";
  costQtyFilter: string;
  discountOpFilter: StockCompareOp | "";
  discountQtyFilter: string;
  semPromoMlAtiva: boolean;
  profitOpFilter: StockCompareOp | "";
  profitQtyFilter: string;
};

type PrecosFiltersDraft = PrecosFiltersValues;

function draftFromApplied(applied: PrecosFiltersValues): PrecosFiltersDraft {
  return {
    search: applied.search,
    skuFilter: applied.skuFilter,
    supplierFilter: applied.supplierFilter,
    statusFilter: applied.statusFilter,
    linkFilter: applied.linkFilter,
    fullOnly: applied.fullOnly,
    filterTagIds: [...applied.filterTagIds],
    sales30dOpFilter: applied.sales30dOpFilter,
    sales30dQtyFilter: applied.sales30dQtyFilter,
    costOpFilter: applied.costOpFilter,
    costQtyFilter: applied.costQtyFilter,
    discountOpFilter: applied.discountOpFilter,
    discountQtyFilter: applied.discountQtyFilter,
    semPromoMlAtiva: applied.semPromoMlAtiva,
    profitOpFilter: applied.profitOpFilter,
    profitQtyFilter: applied.profitQtyFilter,
  };
}

const EMPTY_DRAFT: PrecosFiltersDraft = draftFromApplied({
  search: "",
  skuFilter: "",
  supplierFilter: "",
  statusFilter: "",
  linkFilter: "all",
  fullOnly: false,
  filterTagIds: [],
  sales30dOpFilter: "",
  sales30dQtyFilter: "",
  costOpFilter: "",
  costQtyFilter: "",
  discountOpFilter: "",
  discountQtyFilter: "",
  semPromoMlAtiva: false,
  profitOpFilter: "",
  profitQtyFilter: "",
});

type PrecosFiltersModalProps = {
  open: boolean;
  onClose: () => void;
  applied: PrecosFiltersValues;
  allTags: ProductTag[];
  onApply: (values: PrecosFiltersValues) => void;
  onClearAll: () => void;
};

export function PrecosFiltersModal({
  open,
  onClose,
  applied,
  allTags,
  onApply,
  onClearAll,
}: PrecosFiltersModalProps) {
  const [draft, setDraft] = useState<PrecosFiltersDraft>(EMPTY_DRAFT);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setDraft(draftFromApplied(applied));
  }, [open, applied]);

  const toggleDraftFilterTag = useCallback((tagId: string) => {
    setDraft((prev) => ({
      ...prev,
      filterTagIds: prev.filterTagIds.includes(tagId)
        ? prev.filterTagIds.filter((id) => id !== tagId)
        : [...prev.filterTagIds, tagId],
    }));
  }, []);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      onApply({
        ...draft,
        search: draft.search.trim(),
        skuFilter: draft.skuFilter.trim(),
        supplierFilter: draft.supplierFilter.trim(),
        sales30dQtyFilter: draft.sales30dQtyFilter.trim(),
        costQtyFilter: draft.costQtyFilter.trim(),
        discountQtyFilter: draft.discountQtyFilter.trim(),
        profitQtyFilter: draft.profitQtyFilter.trim(),
      });
    },
    [draft, onApply]
  );

  const handleClear = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    onClearAll();
  }, [onClearAll]);

  if (!open || !mounted) return null;

  const panel = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Filtros"
    >
      <div className="modal-panel-filters" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-600">
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Filtros</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Busca, anúncio, tags, métricas e promoção — use as seções abaixo.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-200 px-2 py-1 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:border-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label="Fechar filtros"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="modal-panel-filters-body space-y-6">
            <section>
              <p className="modal-panel-filters-section-title">Identificação</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Buscar
                  </label>
                  <input
                    type="text"
                    value={draft.search}
                    onChange={(e) => setDraft((p) => ({ ...p, search: e.target.value }))}
                    placeholder="Título ou MLB…"
                    className="input"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">SKU</label>
                  <input
                    type="text"
                    value={draft.skuFilter}
                    onChange={(e) => setDraft((p) => ({ ...p, skuFilter: e.target.value }))}
                    placeholder="Filtrar por SKU…"
                    className="input font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Fornecedor
                  </label>
                  <input
                    type="text"
                    value={draft.supplierFilter}
                    onChange={(e) => setDraft((p) => ({ ...p, supplierFilter: e.target.value }))}
                    placeholder="Nome ou parte do fornecedor…"
                    className="input"
                  />
                </div>
              </div>
            </section>

            <section>
              <p className="modal-panel-filters-section-title">Anúncio</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Status</label>
                  <select
                    value={draft.statusFilter}
                    onChange={(e) => setDraft((p) => ({ ...p, statusFilter: e.target.value }))}
                    className="input text-xs font-medium"
                  >
                    <option value="">Todos os status</option>
                    <option value="active">Ativo</option>
                    <option value="paused">Pausado</option>
                    <option value="closed">Fechado</option>
                    <option value="under_review">Em revisão</option>
                    <option value="inactive">Inativo</option>
                    <option value="deleted">Removido</option>
                    <option value="not_yet_active">Aguardando ativação</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Vínculo MLB → produto
                  </label>
                  <select
                    value={draft.linkFilter}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        linkFilter: e.target.value as "all" | "linked" | "unlinked",
                      }))
                    }
                    className="input text-xs font-medium"
                  >
                    <option value="all">Todos</option>
                    <option value="linked">Só vinculados</option>
                    <option value="unlinked">Só não vinculados</option>
                  </select>
                </div>
                <div className="flex items-end sm:col-span-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={draft.fullOnly}
                      onChange={(e) => setDraft((p) => ({ ...p, fullOnly: e.target.checked }))}
                      className="rounded border-slate-300"
                    />
                    Mostrar somente anúncios Full
                  </label>
                </div>
              </div>
            </section>

            {allTags.length > 0 && (
              <section>
                <p className="modal-panel-filters-section-title">
                  Tags do produto vinculado (qualquer uma)
                </p>
                <div className="flex flex-wrap gap-2 rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-600 dark:bg-slate-800/40">
                  {allTags.map((t) => (
                    <label
                      key={t.id}
                      className={`cursor-pointer rounded border px-2 py-1 text-xs ${
                        draft.filterTagIds.includes(t.id)
                          ? "border-[#0d6efd] bg-[#0d6efd]/10 text-[#0d6efd]"
                          : "border-slate-200 bg-card text-slate-700 dark:border-slate-600 dark:text-slate-200"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={draft.filterTagIds.includes(t.id)}
                        onChange={() => toggleDraftFilterTag(t.id)}
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
              </section>
            )}

            <section>
              <p className="modal-panel-filters-section-title">Métricas</p>
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-600 dark:bg-slate-800/30">
                  <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">Vendas 30d</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    <div>
                      <label
                        htmlFor="precos-sales30d-op"
                        className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                      >
                        Condição
                      </label>
                      <select
                        id="precos-sales30d-op"
                        value={draft.sales30dOpFilter}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            sales30dOpFilter: e.target.value as StockCompareOp | "",
                          }))
                        }
                        className="input w-full"
                      >
                        <option value="">Sem filtro de vendas 30d</option>
                        {STOCK_COMPARE_OPS.map((op) => (
                          <option key={op} value={op}>
                            {stockCompareLabel(op)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="precos-sales30d-qty"
                        className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                      >
                        Quantidade
                      </label>
                      <input
                        id="precos-sales30d-qty"
                        type="number"
                        min={0}
                        step={1}
                        value={draft.sales30dQtyFilter}
                        onChange={(e) => setDraft((p) => ({ ...p, sales30dQtyFilter: e.target.value }))}
                        disabled={!draft.sales30dOpFilter}
                        placeholder={draft.sales30dOpFilter ? "Ex.: 1" : "Escolha a condição"}
                        className="input w-full disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </div>
                    {draft.sales30dOpFilter && draft.sales30dQtyFilter.trim() === "" && (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        Informe a quantidade para aplicar o filtro de vendas 30d.
                      </p>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-600 dark:bg-slate-800/30">
                  <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">Custo (R$)</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    <div>
                      <label
                        htmlFor="precos-cost-op"
                        className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                      >
                        Condição
                      </label>
                      <select
                        id="precos-cost-op"
                        value={draft.costOpFilter}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            costOpFilter: e.target.value as StockCompareOp | "",
                          }))
                        }
                        className="input w-full"
                      >
                        <option value="">Sem filtro de custo</option>
                        {STOCK_COMPARE_OPS.map((op) => (
                          <option key={op} value={op}>
                            {stockCompareLabel(op)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="precos-cost-qty"
                        className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                      >
                        Quantidade
                      </label>
                      <input
                        id="precos-cost-qty"
                        type="number"
                        min={0}
                        step={0.01}
                        value={draft.costQtyFilter}
                        onChange={(e) => setDraft((p) => ({ ...p, costQtyFilter: e.target.value }))}
                        disabled={!draft.costOpFilter}
                        placeholder={draft.costOpFilter ? "Ex.: 50,00" : "Escolha a condição"}
                        className="input w-full disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </div>
                    {draft.costOpFilter && draft.costQtyFilter.trim() === "" && (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        Informe a quantidade para aplicar o filtro de custo.
                      </p>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-600 dark:bg-slate-800/30">
                  <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">Lucratividade</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    <div>
                      <label
                        htmlFor="precos-profit-op"
                        className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                      >
                        Condição
                      </label>
                      <select
                        id="precos-profit-op"
                        value={draft.profitOpFilter}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            profitOpFilter: e.target.value as StockCompareOp | "",
                          }))
                        }
                        className="input w-full"
                      >
                        <option value="">Sem filtro de lucratividade</option>
                        {STOCK_COMPARE_OPS.map((op) => (
                          <option key={op} value={op}>
                            {stockCompareLabel(op)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="precos-profit-qty"
                        className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                      >
                        Quantidade (%)
                      </label>
                      <input
                        id="precos-profit-qty"
                        type="number"
                        min={0}
                        step={1}
                        value={draft.profitQtyFilter}
                        onChange={(e) => setDraft((p) => ({ ...p, profitQtyFilter: e.target.value }))}
                        disabled={!draft.profitOpFilter}
                        placeholder={draft.profitOpFilter ? "Ex.: 20" : "Escolha a condição"}
                        className="input w-full disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </div>
                    {draft.profitOpFilter && draft.profitQtyFilter.trim() === "" && (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        Informe a quantidade para aplicar o filtro de lucratividade.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section>
              <p className="modal-panel-filters-section-title">Promoção</p>
              <div className="space-y-3">
                <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-600 dark:bg-slate-800/30">
                  <p className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Desconto (% entre Preço ML e Promoção)
                  </p>
                  <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
                    Ex.: sem desconto = igual a <strong>0</strong>; abaixo do mínimo de campanha ML = menor que{" "}
                    <strong>{ML_MIN_CAMPAIGN_DISCOUNT_PERCENT}</strong>.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="precos-discount-op"
                        className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                      >
                        Condição
                      </label>
                      <select
                        id="precos-discount-op"
                        value={draft.discountOpFilter}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            discountOpFilter: e.target.value as StockCompareOp | "",
                          }))
                        }
                        className="input w-full"
                      >
                        <option value="">Sem filtro de desconto</option>
                        {STOCK_COMPARE_OPS.map((op) => (
                          <option key={op} value={op}>
                            {stockCompareLabel(op)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="precos-discount-qty"
                        className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                      >
                        Desconto (%)
                      </label>
                      <input
                        id="precos-discount-qty"
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        value={draft.discountQtyFilter}
                        onChange={(e) => setDraft((p) => ({ ...p, discountQtyFilter: e.target.value }))}
                        disabled={!draft.discountOpFilter}
                        placeholder={draft.discountOpFilter ? "Ex.: 0 ou 5" : "Escolha a condição"}
                        className="input w-full disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </div>
                    {draft.discountOpFilter && draft.discountQtyFilter.trim() === "" && (
                      <p className="text-xs text-amber-700 dark:text-amber-300 sm:col-span-2">
                        Informe o percentual de desconto para aplicar o filtro.
                      </p>
                    )}
                  </div>
                </div>
                <label
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-card px-3 py-2.5 text-xs text-slate-700 dark:border-slate-600 dark:text-slate-200"
                  title="Exibe apenas anúncios sem promoções ativas no cache de Promoções (coluna Promo ML = 0)"
                >
                  <input
                    type="checkbox"
                    checked={draft.semPromoMlAtiva}
                    onChange={(e) => setDraft((p) => ({ ...p, semPromoMlAtiva: e.target.checked }))}
                    className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                  Sem Promo ML ativa
                </label>
              </div>
            </section>
          </div>
          <div className="modal-panel-filters-footer flex justify-end gap-2">
            <button type="button" onClick={handleClear} className="btn btn-secondary btn-sm">
              Limpar filtros
            </button>
            <button type="submit" className="btn btn-primary btn-sm">
              Aplicar
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
