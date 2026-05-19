"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatCampaignBenefitsHint,
  type MlCampaignItemRow,
  type MlSellerCampaignRow,
} from "@/lib/mercadolivre/fetch-seller-campaigns";
import { requiresDealPriceForPromotionType } from "@/lib/mercadolivre/join-seller-promotion";
import { labelForMlPromotionType } from "@/lib/mercadolivre/ml-promotion-types";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return brl.format(n);
}

function formatCampaignDatePt(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === "") return "—";
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function statusLabelPt(status: string): string {
  const s = status.toLowerCase();
  if (s === "started" || s === "active") return "Ativa";
  if (s === "candidate") return "Candidato";
  if (s === "pending") return "Pendente";
  if (s === "finished") return "Encerrada";
  return status || "—";
}

function canJoinCampaignItem(item: MlCampaignItemRow, promotionType: string): boolean {
  if (item.status !== "candidate") return false;
  if (!requiresDealPriceForPromotionType(promotionType)) return true;
  return item.price != null && item.price > 0;
}

type Props = {
  accountId: string;
  onOpenItemInLista?: (itemId: string, promotionType: string) => void;
};

export function PromocoesCampanhasTab({ accountId, onOpenItemInLista }: Props) {
  const [campaigns, setCampaigns] = useState<MlSellerCampaignRow[]>([]);
  const [campaignPaging, setCampaignPaging] = useState({ offset: 0, limit: 50, total: 0 });
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);

  const [selected, setSelected] = useState<MlSellerCampaignRow | null>(null);
  const [itemStatusFilter, setItemStatusFilter] = useState<"" | "candidate" | "started" | "pending">(
    ""
  );
  const [items, setItems] = useState<MlCampaignItemRow[]>([]);
  const [itemsPaging, setItemsPaging] = useState<{
    total: number | null;
    search_after: string | null;
  }>({ total: null, search_after: null });
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [searchAfterStack, setSearchAfterStack] = useState<string[]>([]);

  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [joining, setJoining] = useState(false);
  const [joinFeedback, setJoinFeedback] = useState<string | null>(null);

  const loadCampaigns = useCallback(
    async (offset = 0) => {
      if (!accountId) return;
      setCampaignsLoading(true);
      setCampaignsError(null);
      try {
        const params = new URLSearchParams({
          offset: String(offset),
          limit: "50",
        });
        const res = await fetch(
          `/api/mercadolivre/${accountId}/seller-promotions/campaigns?${params}`
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setCampaignsError((data as { error?: string }).error || "Erro ao carregar campanhas.");
          setCampaigns([]);
          return;
        }
        setCampaigns((data as { campaigns?: MlSellerCampaignRow[] }).campaigns ?? []);
        const paging = (data as { paging?: { offset: number; limit: number; total: number } }).paging;
        setCampaignPaging({
          offset: paging?.offset ?? offset,
          limit: paging?.limit ?? 50,
          total: paging?.total ?? 0,
        });
      } catch {
        setCampaignsError("Erro de conexão ao carregar campanhas.");
        setCampaigns([]);
      } finally {
        setCampaignsLoading(false);
      }
    },
    [accountId]
  );

  const loadCampaignItems = useCallback(
    async (campaign: MlSellerCampaignRow, options?: { searchAfter?: string | null; resetStack?: boolean }) => {
      if (!accountId) return;
      setItemsLoading(true);
      setItemsError(null);
      try {
        const params = new URLSearchParams({
          promotion_type: campaign.type,
          limit: "50",
        });
        if (itemStatusFilter) params.set("status", itemStatusFilter);
        if (options?.searchAfter) params.set("search_after", options.searchAfter);

        const res = await fetch(
          `/api/mercadolivre/${accountId}/seller-promotions/campaigns/${encodeURIComponent(campaign.id)}/items?${params}`
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setItemsError((data as { error?: string }).error || "Erro ao carregar itens da campanha.");
          setItems([]);
          return;
        }
        setItems((data as { results?: MlCampaignItemRow[] }).results ?? []);
        const paging = (data as { paging?: { total?: number; search_after?: string | null } }).paging;
        setItemsPaging({
          total: paging?.total ?? null,
          search_after: paging?.search_after ?? null,
        });
        if (options?.resetStack) setSearchAfterStack([]);
      } catch {
        setItemsError("Erro de conexão ao carregar itens.");
        setItems([]);
      } finally {
        setItemsLoading(false);
      }
    },
    [accountId, itemStatusFilter]
  );

  useEffect(() => {
    void loadCampaigns(0);
    setSelected(null);
    setItems([]);
    setSelectedItemIds(new Set());
  }, [accountId, loadCampaigns]);

  useEffect(() => {
    if (!selected) return;
    void loadCampaignItems(selected, { resetStack: true });
    setSelectedItemIds(new Set());
  }, [selected, itemStatusFilter, loadCampaignItems]);

  const joinableItems = useMemo(() => {
    if (!selected) return [];
    return items.filter((i) => canJoinCampaignItem(i, selected.type));
  }, [items, selected]);

  const selectedJoinCount = useMemo(() => {
    return joinableItems.filter((i) => selectedItemIds.has(i.item_id)).length;
  }, [selectedItemIds, joinableItems]);

  const toggleSelectItem = (itemId: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleSelectAllJoinable = () => {
    const allSelected =
      joinableItems.length > 0 && joinableItems.every((i) => selectedItemIds.has(i.item_id));
    if (allSelected) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(joinableItems.map((i) => i.item_id)));
    }
  };

  const handleJoinSelected = async () => {
    if (!accountId || !selected || selectedJoinCount === 0) return;
    const payload = joinableItems
      .filter((i) => selectedItemIds.has(i.item_id))
      .map((i) => ({
        item_id: i.item_id,
        promotion_id: selected.id,
        promotion_type: selected.type,
        deal_price: i.price != null && i.price > 0 ? i.price : null,
      }));

    setJoining(true);
    setJoinFeedback(null);
    setItemsError(null);
    try {
      const res = await fetch(`/api/mercadolivre/${accountId}/promotions-join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setItemsError((data as { error?: string }).error || "Erro ao participar na campanha.");
        return;
      }
      const ok = (data as { summary?: { ok?: number; errors?: number } }).summary?.ok ?? 0;
      const errs = (data as { summary?: { errors?: number } }).summary?.errors ?? 0;
      if (errs === 0) {
        setJoinFeedback(
          ok === 1 ? "1 anúncio aceito na campanha." : `${ok} anúncios aceitos na campanha.`
        );
      } else {
        const firstErr = (
          data as { results?: Array<{ status: string; error?: string }> }
        ).results?.find((r) => r.status === "error");
        setJoinFeedback(
          `${ok} aceito(s), ${errs} com erro${firstErr?.error ? `: ${firstErr.error}` : ""}.`
        );
      }
      setSelectedItemIds(new Set());
      await loadCampaignItems(selected, { resetStack: true });
    } catch {
      setItemsError("Erro de conexão ao participar.");
    } finally {
      setJoining(false);
    }
  };

  const campaignPage = Math.floor(campaignPaging.offset / campaignPaging.limit) + 1;
  const campaignTotalPages = Math.max(
    1,
    Math.ceil((campaignPaging.total || 0) / campaignPaging.limit)
  );

  return (
    <div className="space-y-4 px-3 py-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Campanhas abertas no Mercado Livre para esta conta. Selecione uma campanha para ver e aceitar
        convites dos anúncios participantes.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void loadCampaigns(campaignPaging.offset)}
          disabled={campaignsLoading}
          className="btn btn-secondary btn-sm disabled:cursor-not-allowed"
        >
          {campaignsLoading ? "Atualizando…" : "Atualizar campanhas"}
        </button>
        {campaignsError && (
          <span className="text-sm text-red-600 dark:text-red-400">{campaignsError}</span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,36%)_1fr]">
        <div className="overflow-hidden rounded border border-slate-200 dark:border-slate-700">
          <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
            Campanhas ({campaignPaging.total || campaigns.length})
          </div>
          <div className="max-h-[min(52vh,520px)] overflow-y-auto">
            {campaignsLoading && campaigns.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Carregando campanhas…</p>
            ) : campaigns.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Nenhuma campanha retornada pelo Mercado Livre.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {campaigns.map((c) => {
                  const active = selected?.id === c.id;
                  const benefits = formatCampaignBenefitsHint(c.benefits);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(c);
                          setJoinFeedback(null);
                        }}
                        className={
                          active
                            ? "w-full px-3 py-3 text-left bg-blue-50 dark:bg-blue-950/40"
                            : "w-full px-3 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        }
                      >
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {c.name}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {labelForMlPromotionType(c.type)} · {statusLabelPt(c.status)}
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-slate-400">{c.id}</div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Início {formatCampaignDatePt(c.start_date)} · Fim{" "}
                          {formatCampaignDatePt(c.finish_date)}
                        </div>
                        {c.deadline_date && (
                          <div className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                            Prazo aceite: {formatCampaignDatePt(c.deadline_date)}
                          </div>
                        )}
                        {benefits && (
                          <div className="mt-0.5 text-[11px] text-slate-500">{benefits}</div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {campaignTotalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs dark:border-slate-700">
              <button
                type="button"
                disabled={campaignPaging.offset <= 0 || campaignsLoading}
                className="btn btn-secondary btn-sm disabled:opacity-50"
                onClick={() => {
                  const next = Math.max(0, campaignPaging.offset - campaignPaging.limit);
                  void loadCampaigns(next);
                }}
              >
                Anterior
              </button>
              <span className="text-slate-500">
                Página {campaignPage} / {campaignTotalPages}
              </span>
              <button
                type="button"
                disabled={
                  campaignsLoading ||
                  campaignPaging.offset + campaignPaging.limit >= campaignPaging.total
                }
                className="btn btn-secondary btn-sm disabled:opacity-50"
                onClick={() => {
                  const next = campaignPaging.offset + campaignPaging.limit;
                  void loadCampaigns(next);
                }}
              >
                Próxima
              </button>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded border border-slate-200 dark:border-slate-700">
          {!selected ? (
            <p className="p-6 text-sm text-slate-500">Selecione uma campanha à esquerda.</p>
          ) : (
            <>
              <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {selected.name}
                </div>
                <div className="text-xs text-slate-500">
                  {labelForMlPromotionType(selected.type)} · {selected.id}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-700">
                <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                  <span>Status item</span>
                  <select
                    value={itemStatusFilter}
                    onChange={(e) =>
                      setItemStatusFilter(
                        e.target.value as "" | "candidate" | "started" | "pending"
                      )
                    }
                    className="h-8 rounded border border-slate-200 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-800"
                  >
                    <option value="">Ativos no ML (padrão)</option>
                    <option value="candidate">Candidatos</option>
                    <option value="started">Em campanha</option>
                    <option value="pending">Pendentes</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void handleJoinSelected()}
                  disabled={itemsLoading || joining || selectedJoinCount === 0}
                  className="btn btn-primary btn-sm disabled:cursor-not-allowed"
                >
                  {joining
                    ? "Participando…"
                    : selectedJoinCount > 0
                      ? `Participar (${selectedJoinCount})`
                      : "Participar"}
                </button>
                <button
                  type="button"
                  onClick={() => void loadCampaignItems(selected, { resetStack: true })}
                  disabled={itemsLoading}
                  className="btn btn-secondary btn-sm"
                >
                  Atualizar itens
                </button>
              </div>

              {joinFeedback && (
                <p className="border-b border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                  {joinFeedback}
                </p>
              )}
              {itemsError && (
                <p className="border-b border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
                  {itemsError}
                </p>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/50">
                    <tr>
                      <th className="w-10 px-2 py-2">
                        <input
                          type="checkbox"
                          checked={
                            joinableItems.length > 0 &&
                            joinableItems.every((i) => selectedItemIds.has(i.item_id))
                          }
                          disabled={joinableItems.length === 0 || joining}
                          onChange={toggleSelectAllJoinable}
                          aria-label="Selecionar convites"
                        />
                      </th>
                      <th className="px-2 py-2">MLB</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">Preço promo</th>
                      <th className="px-2 py-2">Preço orig.</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {itemsLoading && items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                          Carregando itens…
                        </td>
                      </tr>
                    ) : items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                          Nenhum item nesta página / filtro.
                        </td>
                      </tr>
                    ) : (
                      items.map((row) => {
                        const joinable = canJoinCampaignItem(row, selected.type);
                        return (
                          <tr
                            key={row.item_id}
                            className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30"
                          >
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                checked={selectedItemIds.has(row.item_id)}
                                disabled={!joinable || joining}
                                onChange={() => toggleSelectItem(row.item_id)}
                                aria-label={`Selecionar ${row.item_id}`}
                              />
                            </td>
                            <td className="px-2 py-2 font-mono text-xs">{row.item_id}</td>
                            <td className="px-2 py-2">{statusLabelPt(row.status)}</td>
                            <td className="px-2 py-2">{formatPrice(row.price)}</td>
                            <td className="px-2 py-2">{formatPrice(row.original_price)}</td>
                            <td className="px-2 py-2">
                              {onOpenItemInLista && (
                                <button
                                  type="button"
                                  className="text-xs text-[#0d6efd] hover:underline"
                                  onClick={() =>
                                    onOpenItemInLista(row.item_id, selected.type)
                                  }
                                >
                                  Na lista
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-xs dark:border-slate-700">
                <span className="text-slate-500">
                  {itemsPaging.total != null
                    ? `Total no ML: ${itemsPaging.total.toLocaleString("pt-BR")}`
                    : `${items.length} itens nesta página`}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm disabled:opacity-50"
                    disabled={itemsLoading || searchAfterStack.length === 0}
                    onClick={() => {
                      const stack = [...searchAfterStack];
                      stack.pop();
                      const prev = stack[stack.length - 1];
                      setSearchAfterStack(stack);
                      void loadCampaignItems(selected, {
                        searchAfter: prev ?? undefined,
                      });
                    }}
                  >
                    Página anterior
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm disabled:opacity-50"
                    disabled={itemsLoading || !itemsPaging.search_after}
                    onClick={() => {
                      if (!itemsPaging.search_after) return;
                      setSearchAfterStack((s) => [...s, itemsPaging.search_after!]);
                      void loadCampaignItems(selected, {
                        searchAfter: itemsPaging.search_after,
                      });
                    }}
                  >
                    Próxima página
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}