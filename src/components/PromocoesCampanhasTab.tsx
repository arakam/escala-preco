"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  formatCampaignBenefitsHint,
  type MlCampaignItemRow,
  type MlSellerCampaignRow,
} from "@/lib/mercadolivre/fetch-seller-campaigns";
import { requiresDealPriceForPromotionType } from "@/lib/mercadolivre/join-seller-promotion";
import {
  ML_PROMOTION_UI_CATEGORIES,
  getMlPromotionUiCategory,
  parseMlPromotionUiCategoryId,
  type MlPromotionUiCategoryId,
} from "@/lib/mercadolivre/ml-promotion-ui-categories";
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

function isBankPromotionType(promotionType: string): boolean {
  const t = promotionType.trim().toUpperCase();
  return t === "BANK" || t.startsWith("BANK");
}

function canJoinCampaignItem(item: MlCampaignItemRow, promotionType: string): boolean {
  if (item.status !== "candidate") return false;
  if (isBankPromotionType(promotionType)) {
    return Boolean(item.offer_id?.trim());
  }
  if (!requiresDealPriceForPromotionType(promotionType)) return true;
  return item.price != null && item.price > 0;
}

function formatCampaignItemPrice(item: MlCampaignItemRow, promotionType: string): string {
  if (item.price != null && item.price > 0) return formatPrice(item.price);
  if (isBankPromotionType(promotionType) && item.original_price != null && item.original_price > 0) {
    const parts: string[] = [formatPrice(item.original_price)];
    if (item.meli_percentage != null && item.meli_percentage > 0) {
      parts.push(`ML ${item.meli_percentage}%`);
    }
    if (item.seller_percentage != null && item.seller_percentage > 0) {
      parts.push(`vend. ${item.seller_percentage}%`);
    }
    return parts.join(" · ");
  }
  return "—";
}

type Props = {
  accountId: string;
  onOpenItemInLista?: (itemId: string, promotionType: string) => void;
};

export function PromocoesCampanhasTab({ accountId, onOpenItemInLista }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const categoryId = useMemo(
    () => parseMlPromotionUiCategoryId(searchParams.get("pcat")),
    [searchParams]
  );
  const activeCategory = useMemo(
    () => getMlPromotionUiCategory(categoryId) ?? ML_PROMOTION_UI_CATEGORIES[1],
    [categoryId]
  );

  const [campaigns, setCampaigns] = useState<MlSellerCampaignRow[]>([]);
  const [campaignPaging, setCampaignPaging] = useState({
    offset: 0,
    limit: 50,
    total: 0,
    scanned_ml_total: 0,
  });
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string>("");
  const selected = useMemo(
    () => campaigns.find((c) => c.id === selectedId) ?? null,
    [campaigns, selectedId]
  );

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

  const setCategoryInUrl = useCallback(
    (id: MlPromotionUiCategoryId) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("pcat", id);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const loadCampaigns = useCallback(
    async (offset = 0) => {
      if (!accountId) return;
      setCampaignsLoading(true);
      setCampaignsError(null);
      try {
        const params = new URLSearchParams({
          offset: String(offset),
          limit: "50",
          category: categoryId,
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
        const list = (data as { campaigns?: MlSellerCampaignRow[] }).campaigns ?? [];
        setCampaigns(list);
        const paging = (
          data as {
            paging?: { offset: number; limit: number; total: number; scanned_ml_total?: number };
          }
        ).paging;
        setCampaignPaging({
          offset: paging?.offset ?? offset,
          limit: paging?.limit ?? 50,
          total: paging?.total ?? list.length,
          scanned_ml_total: paging?.scanned_ml_total ?? 0,
        });
        setSelectedId((prev) => {
          if (prev && list.some((c) => c.id === prev)) return prev;
          return list[0]?.id ?? "";
        });
      } catch {
        setCampaignsError("Erro de conexão ao carregar campanhas.");
        setCampaigns([]);
        setSelectedId("");
      } finally {
        setCampaignsLoading(false);
      }
    },
    [accountId, categoryId]
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
    setItems([]);
    setSelectedItemIds(new Set());
    setJoinFeedback(null);
  }, [accountId, categoryId, loadCampaigns]);

  useEffect(() => {
    if (!selected) {
      setItems([]);
      return;
    }
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
        offer_id: isBankPromotionType(selected.type) ? i.offer_id : null,
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
        Mesmas categorias do painel do Mercado Livre. Escolha a aba, depois selecione a campanha para
        ver anúncios e aceitar convites.
      </p>

      <div
        className="flex flex-wrap gap-1 border-b border-slate-200 pb-1 dark:border-slate-700"
        role="tablist"
        aria-label="Categorias de promoção"
      >
        {ML_PROMOTION_UI_CATEGORIES.map((cat) => {
          const active = cat.id === categoryId;
          return (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCategoryInUrl(cat.id)}
              className={
                active
                  ? "rounded-t-md border border-b-0 border-slate-200 bg-white px-2.5 py-2 text-[12px] font-semibold text-[#0d6efd] shadow-sm dark:border-slate-600 dark:bg-slate-800"
                  : "rounded-t-md px-2.5 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-100"
              }
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">{activeCategory.description}</p>

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
        {campaignPaging.scanned_ml_total > 0 && (
          <span className="text-xs text-slate-500">
            {campaignPaging.total} campanha(s) nesta aba · {campaignPaging.scanned_ml_total} no ML
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded border border-slate-200 dark:border-slate-700">
        <div className="border-b border-slate-100 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/50">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Campanha
          </label>
          {campaignsLoading && campaigns.length === 0 ? (
            <p className="text-sm text-slate-500">Carregando campanhas…</p>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhuma campanha nesta categoria. Tente outra aba ou atualize.
            </p>
          ) : (
            <select
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setJoinFeedback(null);
              }}
              className="w-full max-w-2xl rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {labelForMlPromotionType(c.type)} · {statusLabelPt(c.status)}
                </option>
              ))}
            </select>
          )}

          {selected && (
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono">{selected.id}</span>
              {" · "}
              Início {formatCampaignDatePt(selected.start_date)} · Fim{" "}
              {formatCampaignDatePt(selected.finish_date)}
              {selected.deadline_date && (
                <>
                  {" · "}
                  <span className="text-amber-700 dark:text-amber-300">
                    Prazo aceite: {formatCampaignDatePt(selected.deadline_date)}
                  </span>
                </>
              )}
              {formatCampaignBenefitsHint(selected.benefits) && (
                <> · {formatCampaignBenefitsHint(selected.benefits)}</>
              )}
            </div>
          )}

          {campaignTotalPages > 1 && (
            <div className="mt-3 flex items-center justify-between gap-2 text-xs">
              <button
                type="button"
                disabled={campaignPaging.offset <= 0 || campaignsLoading}
                className="btn btn-secondary btn-sm disabled:opacity-50"
                onClick={() => {
                  const next = Math.max(0, campaignPaging.offset - campaignPaging.limit);
                  void loadCampaigns(next);
                }}
              >
                Campanhas anteriores
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
                Próximas campanhas
              </button>
            </div>
          )}
        </div>

        {!selected ? (
          <p className="p-6 text-sm text-slate-500">Selecione uma campanha acima.</p>
        ) : (
          <>
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
                            <td className="px-2 py-2">
                              {formatCampaignItemPrice(row, selected.type)}
                            </td>
                          <td className="px-2 py-2">{formatPrice(row.original_price)}</td>
                          <td className="px-2 py-2">
                            {onOpenItemInLista && (
                              <button
                                type="button"
                                className="text-xs text-[#0d6efd] hover:underline"
                                onClick={() => onOpenItemInLista(row.item_id, selected.type)}
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
  );
}
