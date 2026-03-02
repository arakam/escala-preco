"use client";

import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { AppTable } from "@/components/AppTable";

interface PricingListing {
  id: string;
  item_id: string;
  variation_id: number | null;
  title: string | null;
  thumbnail: string | null;
  permalink: string | null;
  status: string | null;
  listing_type_id: string | null;
  category_id: string | null;
  current_price: number;
  sku: string | null;
  product_id: string | null;
  cost_price: number | null;
  weight_kg: number | null;
  account_id: string;
}

interface CalculatedPricing {
  price: number;
  fee: number;
  shipping_cost: number;
  net_amount: number;
}

interface ListingWithPricing extends PricingListing {
  new_price: number;
  calculated?: CalculatedPricing;
  calculating?: boolean;
  dirty?: boolean;
}

interface ReputationData {
  reputation?: {
    power_seller_status: string | null;
    level_id: string | null;
  };
}

function PriceInput({
  value,
  onChange,
  onCommit,
  dirty,
}: {
  value: number;
  onChange: (value: number) => void;
  onCommit: () => void;
  dirty?: boolean;
}) {
  const [localValue, setLocalValue] = useState(value.toFixed(2).replace(".", ","));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setLocalValue(value.toFixed(2).replace(".", ","));
    }
  }, [value, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setLocalValue(raw);
    
    const cleaned = raw.replace(/[^\d,.-]/g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num >= 0) {
      onChange(num);
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    const cleaned = localValue.replace(/[^\d,.-]/g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num >= 0) {
      setLocalValue(num.toFixed(2).replace(".", ","));
      onChange(num);
      onCommit();
    } else {
      setLocalValue(value.toFixed(2).replace(".", ","));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <input
      type="text"
      value={localValue}
      onChange={handleChange}
      onFocus={() => setIsFocused(true)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={`w-24 rounded border px-2 py-1 text-right text-sm ${
        dirty ? "border-amber-400 bg-amber-50" : "border-gray-300"
      }`}
    />
  );
}

function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="mb-4 text-xl font-semibold">Como funciona a Calculadora de Preços</h2>

        <div className="space-y-4 text-sm text-gray-700">
          <section>
            <h3 className="mb-2 font-medium text-gray-900">Objetivo</h3>
            <p>
              Esta ferramenta permite simular preços de venda em massa para seus anúncios do Mercado Livre,
              calculando automaticamente as taxas e o valor líquido que você receberá.
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-gray-900">Colunas da tabela</h3>
            <ul className="list-inside list-disc space-y-1">
              <li><strong>SKU:</strong> Código do produto vinculado ao anúncio</li>
              <li><strong>Custo:</strong> Preço de custo do produto (cadastrado em Produtos)</li>
              <li><strong>Preço Atual:</strong> Preço atual do anúncio no Mercado Livre</li>
              <li><strong>Preço Novo:</strong> Campo editável para simular um novo preço</li>
              <li><strong>Taxa ML:</strong> Taxa de comissão do Mercado Livre calculada sobre o preço</li>
              <li><strong>Frete:</strong> Custo de frete (apenas para contas Mercado Líder)</li>
              <li><strong>Vai Receber:</strong> Valor líquido após descontar taxa e frete</li>
            </ul>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-gray-900">Como usar</h3>
            <ol className="list-inside list-decimal space-y-1">
              <li>Os anúncios são carregados automaticamente ao abrir a página</li>
              <li>Edite o campo &quot;Preço Novo&quot; para simular um valor diferente</li>
              <li>Pressione Enter ou clique fora do campo para recalcular</li>
              <li>Use &quot;Calcular Todos&quot; para recalcular todos os itens de uma vez</li>
            </ol>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-gray-900">Mercado Líder</h3>
            <p>
              Se sua conta é Mercado Líder, marque a opção para incluir o custo de frete no cálculo.
              O frete é calculado com base no peso do produto cadastrado.
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-gray-900">Filtros</h3>
            <ul className="list-inside list-disc space-y-1">
              <li><strong>Status:</strong> Filtre por anúncios ativos, pausados ou encerrados</li>
              <li><strong>Apenas vinculados:</strong> Mostra apenas anúncios com produto vinculado</li>
              <li><strong>Busca:</strong> Pesquise por título ou código MLB</li>
            </ul>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-gray-900">Observações</h3>
            <ul className="list-inside list-disc space-y-1">
              <li>Anúncios sem tipo de listagem (N/D) precisam ser sincronizados novamente</li>
              <li>Para ter o custo, vincule o anúncio a um produto na página de Produtos</li>
              <li>Esta ferramenta é apenas para simulação, não altera os preços no Mercado Livre</li>
            </ul>
          </section>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PrecosPage() {
  const [listings, setListings] = useState<ListingWithPricing[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [isMercadoLider, setIsMercadoLider] = useState(false);
  const [reputationLoading, setReputationLoading] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);

  const loadReputation = useCallback(async () => {
    setReputationLoading(true);
    try {
      const res = await fetch("/api/mercadolivre/reputation");
      if (res.ok) {
        const data = (await res.json()) as ReputationData;
        const powerSeller = data.reputation?.power_seller_status;
        setIsMercadoLider(powerSeller === "gold" || powerSeller === "platinum");
      }
    } catch {
      // ignore
    } finally {
      setReputationLoading(false);
    }
  }, []);

  const loadListings = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(pageSize),
    });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (linkedOnly) params.set("linked", "1");

    try {
      const res = await fetch(`/api/pricing/listings?${params}`);
      if (res.ok) {
        const data = await res.json();
        const items = (data.listings ?? []) as PricingListing[];
        setListings(
          items.map((item) => ({
            ...item,
            new_price: item.current_price,
            dirty: false,
          }))
        );
        setTotal(data.total ?? 0);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, statusFilter, linkedOnly]);

  useEffect(() => {
    loadReputation();
  }, [loadReputation]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  const doCalculate = useCallback(
    async (items: ListingWithPricing[], mercadoLider: boolean) => {
      const itemsToCalculate = items
        .filter((item) => item.new_price > 0 && item.listing_type_id && item.category_id)
        .map((item) => ({
          item_id: item.item_id,
          variation_id: item.variation_id,
          price: item.new_price,
          listing_type_id: item.listing_type_id!,
          category_id: item.category_id!,
          weight_kg: item.weight_kg,
        }));

      if (itemsToCalculate.length === 0) return;

      try {
        const res = await fetch("/api/pricing/calculate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: itemsToCalculate,
            is_mercado_lider: mercadoLider,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const results = data.results as (CalculatedPricing & {
            item_id: string;
            variation_id: number | null;
          })[];

          setListings((prev) =>
            prev.map((listing) => {
              const result = results.find(
                (r) =>
                  r.item_id === listing.item_id &&
                  r.variation_id === listing.variation_id
              );
              if (result) {
                return {
                  ...listing,
                  calculated: {
                    price: result.price,
                    fee: result.fee,
                    shipping_cost: result.shipping_cost,
                    net_amount: result.net_amount,
                  },
                  dirty: false,
                };
              }
              return listing;
            })
          );
        }
      } catch {
        // ignore
      }
    },
    []
  );

  // Auto-calculate when listings are loaded (only once per load)
  const lastCalculatedKey = useRef<string>("");
  const listingsRef = useRef<ListingWithPricing[]>([]);
  
  // Keep ref updated
  useEffect(() => {
    listingsRef.current = listings;
  }, [listings]);
  
  useEffect(() => {
    if (!loading && listings.length > 0 && !calculating) {
      const key = `${page}-${search}-${statusFilter}-${linkedOnly}`;
      if (lastCalculatedKey.current !== key) {
        const hasUncalculated = listings.some((l) => !l.calculated && l.listing_type_id);
        if (hasUncalculated) {
          lastCalculatedKey.current = key;
          setCalculating(true);
          // Use a copy of listings to avoid stale closure
          const itemsToCalc = [...listings];
          doCalculate(itemsToCalc, isMercadoLider).finally(() => setCalculating(false));
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, listings.length, calculating, page, search, statusFilter, linkedOnly]);

  const calculatePrices = useCallback(
    async (items: ListingWithPricing[]) => {
      if (items.length === 0) return;

      setCalculating(true);

      const itemsToCalculate = items
        .filter((item) => item.new_price > 0 && item.listing_type_id && item.category_id)
        .map((item) => ({
          item_id: item.item_id,
          variation_id: item.variation_id,
          price: item.new_price,
          listing_type_id: item.listing_type_id!,
          category_id: item.category_id!,
          weight_kg: item.weight_kg,
        }));

      if (itemsToCalculate.length === 0) {
        setCalculating(false);
        return;
      }

      try {
        const res = await fetch("/api/pricing/calculate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: itemsToCalculate,
            is_mercado_lider: isMercadoLider,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const results = data.results as (CalculatedPricing & {
            item_id: string;
            variation_id: number | null;
          })[];

          setListings((prev) =>
            prev.map((listing) => {
              const result = results.find(
                (r) =>
                  r.item_id === listing.item_id &&
                  r.variation_id === listing.variation_id
              );
              if (result) {
                return {
                  ...listing,
                  calculated: {
                    price: result.price,
                    fee: result.fee,
                    shipping_cost: result.shipping_cost,
                    net_amount: result.net_amount,
                  },
                  dirty: false,
                };
              }
              return listing;
            })
          );
        }
      } catch {
        // ignore
      } finally {
        setCalculating(false);
      }
    },
    [isMercadoLider]
  );

  const handleCalculateAll = useCallback(() => {
    calculatePrices(listings);
  }, [calculatePrices, listings]);

  const handlePriceChange = useCallback((id: string, variationId: number | null, value: string) => {
    const numValue = parseFloat(value.replace(",", ".")) || 0;
    setListings((prev) =>
      prev.map((item) => {
        if (item.id === id && item.variation_id === variationId) {
          return { ...item, new_price: numValue, dirty: true };
        }
        return item;
      })
    );
  }, []);

  const handleCalculateSingle = useCallback(
    async (listing: ListingWithPricing) => {
      if (!listing.listing_type_id || !listing.category_id || listing.new_price <= 0) return;

      setListings((prev) =>
        prev.map((item) =>
          item.id === listing.id ? { ...item, calculating: true } : item
        )
      );

      try {
        const res = await fetch("/api/pricing/calculate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [
              {
                item_id: listing.item_id,
                variation_id: listing.variation_id,
                price: listing.new_price,
                listing_type_id: listing.listing_type_id,
                category_id: listing.category_id,
                weight_kg: listing.weight_kg,
              },
            ],
            is_mercado_lider: isMercadoLider,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const result = data.results?.[0];
          if (result) {
            setListings((prev) =>
              prev.map((item) =>
                item.id === listing.id
                  ? {
                      ...item,
                      calculated: {
                        price: result.price,
                        fee: result.fee,
                        shipping_cost: result.shipping_cost,
                        net_amount: result.net_amount,
                      },
                      calculating: false,
                      dirty: false,
                    }
                  : item
              )
            );
          }
        }
      } catch {
        setListings((prev) =>
          prev.map((item) =>
            item.id === listing.id ? { ...item, calculating: false } : item
          )
        );
      }
    },
    [isMercadoLider]
  );

  const handleSearchSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }, [searchInput]);

  const formatBRL = useCallback((value: number | null | undefined) => {
    if (value == null) return "—";
    return value.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, []);

  const totalPages = Math.ceil(total / pageSize);

  const dirtyCount = useMemo(
    () => listings.filter((l) => l.dirty).length,
    [listings]
  );

  const hasLinkedItems = useMemo(
    () => listings.some((l) => l.product_id),
    [listings]
  );

  const itemsWithoutListingType = useMemo(
    () => listings.filter((l) => !l.listing_type_id).length,
    [listings]
  );

  if (loading && listings.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-gray-500">Carregando…</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Calculadora de Preços</h1>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="Como funciona"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Simule preços de venda e veja o valor líquido a receber
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={isMercadoLider}
              onChange={(e) => setIsMercadoLider(e.target.checked)}
              className="rounded border-gray-300"
              disabled={reputationLoading}
            />
            <span>Mercado Líder (calcular frete)</span>
          </label>
          <button
            type="button"
            onClick={handleCalculateAll}
            disabled={calculating || listings.length === 0}
            className="rounded bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
          >
            {calculating ? "Calculando…" : "Calcular Todos"}
          </button>
        </div>
      </div>

      {dirtyCount > 0 && (
        <div className="mb-4 rounded bg-amber-50 p-3 text-sm text-amber-700">
          {dirtyCount} item(s) com preço alterado. Clique em &quot;Calcular Todos&quot; ou
          pressione Enter no campo de preço para recalcular.
        </div>
      )}

      <form onSubmit={handleSearchSubmit} className="mb-6 flex flex-wrap gap-3">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por título ou MLB…"
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded bg-gray-200 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-300"
        >
          Buscar
        </button>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Todos os status</option>
          <option value="active">Ativo</option>
          <option value="paused">Pausado</option>
          <option value="closed">Fechado</option>
        </select>
        <label className="flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={linkedOnly}
            onChange={(e) => {
              setLinkedOnly(e.target.checked);
              setPage(1);
            }}
            className="rounded border-gray-300"
          />
          <span>Só vinculados</span>
        </label>
        {(search || statusFilter || linkedOnly) && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setSearchInput("");
              setStatusFilter("active");
              setLinkedOnly(false);
              setPage(1);
            }}
            className="text-sm text-gray-600 underline hover:text-gray-900"
          >
            Limpar filtros
          </button>
        )}
      </form>

      {!hasLinkedItems && listings.length > 0 && (
        <div className="mb-4 rounded bg-amber-50 p-3 text-sm text-amber-700">
          Nenhum anúncio vinculado a produtos. Para calcular o lucro, vincule seus
          anúncios aos produtos cadastrados na página{" "}
          <a href="/app/produtos" className="font-medium underline">
            Produtos
          </a>
          .
        </div>
      )}

      {itemsWithoutListingType > 0 && (
        <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          {itemsWithoutListingType} anúncio(s) sem tipo de listagem definido. 
          Sincronize novamente os anúncios na página{" "}
          <a href="/app/anuncios" className="font-medium underline">
            Anúncios
          </a>{" "}
          para obter as taxas.
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Carregando anúncios…</p>
      ) : listings.length === 0 ? (
        <p className="text-gray-500">Nenhum anúncio encontrado com os filtros selecionados.</p>
      ) : (
        <>
          <AppTable
            summary={`${total} anúncio(s) — página ${page} de ${totalPages || 1}`}
            maxHeight="70vh"
          >
            <thead>
              <tr>
                <th className="p-2 font-medium text-gray-700">Imagem</th>
                <th className="p-2 font-medium text-gray-700">MLB</th>
                <th className="p-2 font-medium text-gray-700">Título</th>
                <th className="p-2 font-medium text-gray-700">SKU</th>
                <th className="p-2 font-medium text-gray-700 text-right">Custo</th>
                <th className="p-2 font-medium text-gray-700 text-right">Preço Atual</th>
                <th className="p-2 font-medium text-gray-700 text-right">Preço Novo</th>
                <th className="p-2 font-medium text-gray-700 text-right">Taxa ML</th>
                <th className="p-2 font-medium text-gray-700 text-right">Frete</th>
                <th className="p-2 font-medium text-gray-700 text-right font-semibold">
                  Vai Receber
                </th>
                <th className="p-2 font-medium text-gray-700 text-right">Lucro</th>
                <th className="p-2 font-medium text-gray-700">Link</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => {
                const profit =
                  listing.calculated && listing.cost_price != null
                    ? listing.calculated.net_amount - listing.cost_price
                    : null;
                const profitPercent =
                  profit != null && listing.cost_price && listing.cost_price > 0
                    ? (profit / listing.cost_price) * 100
                    : null;

                return (
                  <tr
                    key={`${listing.id}-${listing.variation_id ?? "item"}`}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="p-2">
                      {listing.thumbnail ? (
                        <img
                          src={listing.thumbnail.replace(/^http:/, "https:")}
                          alt=""
                          className="h-10 w-10 rounded object-contain"
                        />
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="p-2 font-mono text-xs text-gray-600">
                      {listing.item_id}
                      {listing.variation_id && (
                        <span className="block text-gray-400">
                          var: {listing.variation_id}
                        </span>
                      )}
                    </td>
                    <td
                      className="max-w-[200px] truncate p-2 text-sm"
                      title={listing.title ?? ""}
                    >
                      {listing.title ?? "—"}
                    </td>
                    <td className="p-2 font-mono text-xs text-gray-600">
                      {listing.sku ?? "—"}
                    </td>
                    <td className="p-2 text-right text-sm">
                      {listing.cost_price != null ? (
                        <span className="text-gray-700">
                          R$ {formatBRL(listing.cost_price)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="p-2 text-right text-sm font-medium">
                      R$ {formatBRL(listing.current_price)}
                    </td>
                    <td className="p-2">
                      <PriceInput
                        value={listing.new_price}
                        onChange={(newValue) =>
                          handlePriceChange(
                            listing.id,
                            listing.variation_id,
                            String(newValue)
                          )
                        }
                        onCommit={() => handleCalculateSingle(listing)}
                        dirty={listing.dirty}
                      />
                    </td>
                    <td className="p-2 text-right text-sm">
                      {listing.calculating ? (
                        <span className="text-gray-400">…</span>
                      ) : listing.calculated ? (
                        <span className="text-amber-700">
                          R$ {formatBRL(listing.calculated.fee)}
                        </span>
                      ) : !listing.listing_type_id ? (
                        <span className="text-red-400" title="Tipo de anúncio não disponível">
                          N/D
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="p-2 text-right text-sm">
                      {listing.calculating ? (
                        <span className="text-gray-400">…</span>
                      ) : listing.calculated ? (
                        <span
                          className={
                            listing.calculated.shipping_cost > 0
                              ? "text-red-600"
                              : "text-gray-400"
                          }
                        >
                          {listing.calculated.shipping_cost > 0
                            ? `R$ ${formatBRL(listing.calculated.shipping_cost)}`
                            : "—"}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="p-2 text-right text-sm font-semibold">
                      {listing.calculating ? (
                        <span className="text-gray-400">…</span>
                      ) : listing.calculated ? (
                        <span className="text-green-700">
                          R$ {formatBRL(listing.calculated.net_amount)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="p-2 text-right text-sm">
                      {listing.calculating ? (
                        <span className="text-gray-400">…</span>
                      ) : profit != null ? (
                        <div className="flex flex-col items-end">
                          <span
                            className={
                              profit >= 0 ? "text-green-600" : "text-red-600"
                            }
                          >
                            R$ {formatBRL(profit)}
                          </span>
                          {profitPercent != null && (
                            <span
                              className={`text-xs ${
                                profitPercent >= 0
                                  ? "text-green-500"
                                  : "text-red-500"
                              }`}
                            >
                              {profitPercent >= 0 ? "+" : ""}
                              {profitPercent.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="p-2">
                      {listing.permalink ? (
                        <a
                          href={listing.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-blue hover:underline text-sm"
                        >
                          ML
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </AppTable>

          {totalPages > 1 && (
            <div className="mt-6 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border border-gray-300 bg-white px-3 py-1 text-sm disabled:opacity-50"
              >
                Anterior
              </button>
              <span className="py-1 text-sm text-gray-600">
                Página {page} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded border border-gray-300 bg-white px-3 py-1 text-sm disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
