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
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  tax_percent: number | null;
  extra_fee_percent: number | null;
  fixed_expenses: number | null;
  account_id: string;
}

interface CalculatedPricing {
  price: number;
  fee: number;
  shipping_cost: number;
  tax_amount: number;
  extra_fee_amount: number;
  fixed_expenses_amount: number;
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

function calculateFullPricing(
  listing: { tax_percent: number | null; extra_fee_percent: number | null; fixed_expenses: number | null },
  result: { price: number; fee: number; shipping_cost: number }
): CalculatedPricing {
  const taxAmount = listing.tax_percent ? (result.price * listing.tax_percent / 100) : 0;
  const extraFeeAmount = listing.extra_fee_percent ? (result.price * listing.extra_fee_percent / 100) : 0;
  const fixedExpensesAmount = listing.fixed_expenses != null && listing.fixed_expenses > 0 ? listing.fixed_expenses : 0;
  const netAmount = result.price - result.fee - result.shipping_cost - taxAmount - extraFeeAmount - fixedExpensesAmount;
  
  return {
    price: result.price,
    fee: result.fee,
    shipping_cost: result.shipping_cost,
    tax_amount: Math.round(taxAmount * 100) / 100,
    extra_fee_amount: Math.round(extraFeeAmount * 100) / 100,
    fixed_expenses_amount: Math.round(fixedExpensesAmount * 100) / 100,
    net_amount: Math.round(netAmount * 100) / 100,
  };
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
              <li><strong>Vendas (30d):</strong> Soma das quantidades vendidas em cada pedido (unidades) nos últimos 30 dias. Clique no cabeçalho para ordenar.</li>
              <li><strong>Pedidos (30d):</strong> Número de pedidos pagos que contêm o item nos últimos 30 dias.</li>
              <li><strong>Custo:</strong> Preço de custo do produto (cadastrado em Produtos)</li>
              <li><strong>Preço Atual:</strong> Preço atual do anúncio no Mercado Livre</li>
              <li><strong>Preço Novo:</strong> Campo editável para simular um novo preço</li>
              <li><strong>Taxa ML:</strong> Taxa de comissão do Mercado Livre calculada sobre o preço</li>
              <li><strong>Frete:</strong> Custo de frete (apenas para contas Mercado Líder)</li>
              <li><strong>Imposto:</strong> Valor do imposto calculado sobre o preço (% cadastrado no produto)</li>
              <li><strong>Taxa Extra:</strong> Taxa extra calculada sobre o preço (% cadastrado no produto)</li>
              <li><strong>Desp. Fixas:</strong> Despesas fixas em R$ (valor cadastrado no produto, descontado do líquido)</li>
              <li><strong>Vai Receber:</strong> Valor líquido após descontar taxa ML, frete, imposto, taxa extra e despesas fixas</li>
              <li><strong>Lucro:</strong> Diferença entre o valor recebido e o custo do produto</li>
            </ul>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-gray-900">Como usar</h3>
            <ol className="list-inside list-decimal space-y-1">
              <li>Os anúncios são carregados automaticamente ao abrir a página</li>
              <li>Edite o campo &quot;Preço Novo&quot; para simular um valor diferente</li>
              <li>Pressione Enter ou clique fora do campo para recalcular</li>
              <li>Use &quot;Calcular Todos&quot; para recalcular todos os itens de uma vez</li>
              <li>Use &quot;Salvar preços alterados&quot; para guardar o novo preço vinculado ao MLB e ao SKU de cada anúncio</li>
            </ol>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-gray-900">Mercado Líder</h3>
            <p>
              Se sua conta é Mercado Líder, marque a opção para incluir o custo de frete no cálculo.
              O frete usa o maior entre peso real e peso volumétrico (altura × largura × comprimento ÷ 6000), como no Mercado Livre.
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-gray-900">Filtros (busca geral)</h3>
            <ul className="list-inside list-disc space-y-1">
              <li><strong>Status:</strong> Filtre por anúncios ativos, pausados ou encerrados</li>
              <li><strong>Apenas vinculados:</strong> Mostra apenas anúncios com produto vinculado</li>
              <li><strong>Busca:</strong> Pesquise por título ou código MLB</li>
              <li><strong>Só com vendas (30d):</strong> Exibe apenas anúncios com pelo menos 1 venda nos últimos 30 dias</li>
              <li><strong>Lucratividade:</strong> Filtra em até 500 anúncios carregados (busca geral na amostra)</li>
            </ul>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-gray-900">Imposto, Taxa Extra e Desp. Fixas</h3>
            <p className="mb-2">
              Imposto e taxa extra (percentuais) e despesas fixas (valor em R$) são cadastrados na página de Produtos.
              Imposto e taxa extra são calculados sobre o preço de venda; despesas fixas são um valor fixo em R$ descontado do líquido.
            </p>
            <p className="text-gray-600">
              Exemplo: Produto com 10% de imposto, 5% de taxa extra e R$ 2,00 de desp. fixas vendido a R$ 100,00:
              <br />Imposto = R$ 10,00 | Taxa Extra = R$ 5,00 | Desp. Fixas = R$ 2,00
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-gray-900">Observações</h3>
            <ul className="list-inside list-disc space-y-1">
              <li>Anúncios sem tipo de listagem (N/D) precisam ser sincronizados novamente</li>
              <li>Para ter o custo, vincule o anúncio a um produto na página de Produtos</li>
              <li>Imposto, taxa extra e desp. fixas são considerados apenas se cadastrados no produto vinculado</li>
              <li>Os preços salvos ficam vinculados ao MLB e ao SKU; ao reabrir a página, o &quot;Preço Novo&quot; virá do último valor salvo</li>
              <li>Esta ferramenta não altera os preços no Mercado Livre; ela apenas calcula e guarda o preço planejado</li>
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
  const [skuFilter, setSkuFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [isMercadoLider, setIsMercadoLider] = useState(false);
  const [reputationLoading, setReputationLoading] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  /** Filtro por % de lucro: "" = todos, "high" = >20%, "medium" = 10-20%, "low" = 0-10%, "negative" = ≤0% */
  const [profitFilter, setProfitFilter] = useState<"" | "high" | "medium" | "low" | "negative">("");
  /** Quantidade vendida (soma das quantidades nos pedidos) últimos 30 dias por item_id */
  const [salesData, setSalesData] = useState<Record<string, number>>({});
  /** Número de pedidos (pagados) que contêm o item nos últimos 30 dias por item_id */
  const [ordersData, setOrdersData] = useState<Record<string, number>>({});
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState(false);
  /** Ordenação: "" = padrão, "sales_desc" = mais vendas primeiro, "sales_asc" = menos vendas primeiro */
  const [sortBy, setSortBy] = useState<"" | "sales_desc" | "sales_asc">("");
  /** Mostrar somente itens com vendas nos últimos 30 dias */
  const [onlyWithSales30d, setOnlyWithSales30d] = useState(false);
  /** Itens selecionados para criar campanha ML (por id de listing) */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  /** Célula copiada (ex: "mlb-id" ou "sku-id") para mostrar "Copiado!" como na tela de anúncios */
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const [campaignStart, setCampaignStart] = useState("");
  const [campaignFinish, setCampaignFinish] = useState("");
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [campaignMessage, setCampaignMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

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

  /** Com filtro de lucro ativo, busca até 500 itens (busca geral) e pagina no cliente */
  const limitForRequest = profitFilter ? 500 : pageSize;
  const pageForRequest = profitFilter ? 1 : page;

  const loadListings = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(pageForRequest),
      limit: String(limitForRequest),
    });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (linkedOnly) params.set("linked", "1");
    if (sortBy === "sales_desc" || sortBy === "sales_asc") params.set("order_by", sortBy);
    if (skuFilter) params.set("sku", skuFilter);

    try {
      const [listingsRes, plannedRes] = await Promise.all([
        fetch(`/api/pricing/listings?${params}`),
        fetch("/api/pricing/planned-prices"),
      ]);

      const listingsData = listingsRes.ok ? await listingsRes.json() : { listings: [], total: 0 };
      const items = (listingsData.listings ?? []) as PricingListing[];
      if (listingsData.sales && typeof listingsData.sales === "object") {
        setSalesData(listingsData.sales as Record<string, number>);
      }
      if (listingsData.orders && typeof listingsData.orders === "object") {
        setOrdersData(listingsData.orders as Record<string, number>);
      }
      const plannedMap = new Map<string, number>();
      if (plannedRes.ok) {
        const plannedData = await plannedRes.json();
        const plannedList = plannedData.prices ?? [];
        for (const p of plannedList) {
          const key = `${p.item_id}:${p.variation_id ?? "n"}`;
          plannedMap.set(key, p.planned_price);
        }
      }

      setListings(
        items.map((item) => {
          const key = `${item.item_id}:${item.variation_id ?? "n"}`;
          const savedPrice = plannedMap.get(key);
          const newPrice = savedPrice ?? item.current_price;
          return {
            ...item,
            new_price: newPrice,
            dirty: false,
          };
        })
      );
      setTotal(listingsData.total ?? 0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [pageForRequest, limitForRequest, search, statusFilter, linkedOnly, sortBy, skuFilter]);

  useEffect(() => {
    loadReputation();
  }, [loadReputation]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  useEffect(() => {
    setPage(1);
  }, [profitFilter]);

  useEffect(() => {
    if (loading || listings.length === 0) return;
    if (sortBy === "sales_desc" || sortBy === "sales_asc") return;
    const itemIds = Array.from(new Set(listings.map((l) => l.item_id)));
    if (itemIds.length === 0) return;
    setSalesLoading(true);
    setSalesError(false);
    fetch("/api/pricing/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_ids: itemIds }),
    })
      .then((res) => {
        if (!res.ok) {
          setSalesError(true);
          return { sales: {} };
        }
        return res.json();
      })
      .then((data: { sales?: Record<string, number>; orders?: Record<string, number> }) => {
        setSalesData(data.sales ?? {});
        setOrdersData(data.orders ?? {});
      })
      .catch(() => {
        setSalesError(true);
        setSalesData({});
        setOrdersData({});
      })
      .finally(() => setSalesLoading(false));
  }, [loading, listings, sortBy]);

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
          height_cm: item.height_cm,
          width_cm: item.width_cm,
          length_cm: item.length_cm,
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
          const results = data.results as {
            item_id: string;
            variation_id: number | null;
            price: number;
            fee: number;
            shipping_cost: number;
          }[];

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
                  calculated: calculateFullPricing(listing, result),
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
      const key = `${page}-${search}-${statusFilter}-${linkedOnly}-${skuFilter}`;
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
  }, [loading, listings.length, calculating, page, search, statusFilter, linkedOnly, skuFilter]);

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
          height_cm: item.height_cm,
          width_cm: item.width_cm,
          length_cm: item.length_cm,
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
          const results = data.results as {
            item_id: string;
            variation_id: number | null;
            price: number;
            fee: number;
            shipping_cost: number;
          }[];

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
                  calculated: calculateFullPricing(listing, result),
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

  const handleSavePlannedPrices = useCallback(async () => {
    const toSave = listings.filter((l) => l.dirty && l.new_price >= 0);
    if (toSave.length === 0) return;
    setSaveMessage(null);
    setSaving(true);
    try {
      const res = await fetch("/api/pricing/planned-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: toSave.map((l) => ({
            item_id: l.item_id,
            variation_id: l.variation_id,
            sku: l.sku ?? undefined,
            planned_price: l.new_price,
          })),
        }),
      });
      const data = res.ok ? await res.json().catch(() => ({})) : {};
      if (!res.ok) {
        setSaveMessage({ type: "error", text: (data as { error?: string }).error ?? "Erro ao salvar" });
        return;
      }
      setSaveMessage({ type: "ok", text: `${(data as { saved?: number }).saved ?? toSave.length} preço(s) salvos (MLB + SKU).` });
      const savedKeys = new Set(toSave.map((l) => `${l.item_id}:${l.variation_id ?? "n"}`));
      setListings((prev) =>
        prev.map((item) => {
          const key = `${item.item_id}:${item.variation_id ?? "n"}`;
          return savedKeys.has(key) ? { ...item, dirty: false } : item;
        })
      );
      setTimeout(() => setSaveMessage(null), 4000);
    } catch {
      setSaveMessage({ type: "error", text: "Erro ao salvar preços" });
    } finally {
      setSaving(false);
    }
  }, [listings]);

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
                height_cm: listing.height_cm,
                width_cm: listing.width_cm,
                length_cm: listing.length_cm,
              },
            ],
            is_mercado_lider: isMercadoLider,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const result = data.results?.[0] as { price: number; fee: number; shipping_cost: number } | undefined;
          if (result) {
            setListings((prev) =>
              prev.map((item) =>
                item.id === listing.id
                  ? {
                      ...item,
                      calculated: calculateFullPricing(listing, result),
                      calculating: false,
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

  /** Ajusta o preço novo para o mínimo aceito na promoção ML (desconto de 5%). */
  const handleApplyMinDiscount = useCallback(
    async (listing: ListingWithPricing) => {
      const newPrice = Math.round(listing.current_price * 0.95 * 100) / 100;
      setListings((prev) =>
        prev.map((item) =>
          item.id === listing.id && item.variation_id === listing.variation_id
            ? { ...item, new_price: newPrice, dirty: true, calculating: true }
            : item
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
                price: newPrice,
                listing_type_id: listing.listing_type_id,
                category_id: listing.category_id,
                weight_kg: listing.weight_kg,
                height_cm: listing.height_cm,
                width_cm: listing.width_cm,
                length_cm: listing.length_cm,
              },
            ],
            is_mercado_lider: isMercadoLider,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const result = data.results?.[0] as { price: number; fee: number; shipping_cost: number } | undefined;
          if (result) {
            const listingWithNewPrice = { ...listing, new_price: newPrice };
            setListings((prev) =>
              prev.map((item) =>
                item.id === listing.id && item.variation_id === listing.variation_id
                  ? {
                      ...item,
                      new_price: newPrice,
                      dirty: true,
                      calculated: calculateFullPricing(listingWithNewPrice, result),
                      calculating: false,
                    }
                  : item
              )
            );
          } else {
            setListings((prev) =>
              prev.map((item) =>
                item.id === listing.id && item.variation_id === listing.variation_id
                  ? { ...item, new_price: newPrice, dirty: true, calculating: false }
                  : item
              )
            );
          }
        } else {
          setListings((prev) =>
            prev.map((item) =>
              item.id === listing.id && item.variation_id === listing.variation_id
                ? { ...item, new_price: newPrice, dirty: true, calculating: false }
                : item
            )
          );
        }
      } catch {
        setListings((prev) =>
          prev.map((item) =>
            item.id === listing.id && item.variation_id === listing.variation_id
              ? { ...item, new_price: newPrice, dirty: true, calculating: false }
              : item
          )
        );
      }
    },
    [isMercadoLider]
  );

  const handleCopyToClipboard = useCallback((value: string, cellKey: string) => {
    if (!value) return;
    const done = () => {
      setCopiedCell(cellKey);
      setTimeout(() => setCopiedCell(null), 1800);
    };
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(() => {});
      return;
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      done();
    } catch {
      // ignore
    }
  }, []);

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

  const getProfitPercent = useCallback((listing: ListingWithPricing): number | null => {
    if (!listing.calculated || listing.cost_price == null) return null;
    const profit = listing.calculated.net_amount - listing.cost_price;
    if (listing.new_price <= 0) return null;
    return (profit / listing.new_price) * 100;
  }, []);

  const filteredListings = useMemo(() => {
    let base = listings;

    if (profitFilter) {
      base = base.filter((listing) => {
        const pct = getProfitPercent(listing);
        if (pct == null) return false;
        switch (profitFilter) {
          case "high":
            return pct > 20;
          case "medium":
            return pct > 10 && pct <= 20;
          case "low":
            return pct > 0 && pct <= 10;
          case "negative":
            return pct <= 0;
          default:
            return true;
        }
      });
    }

    const skuTerm = skuFilter.trim().toLowerCase();
    if (skuTerm) {
      base = base.filter((listing) => (listing.sku ?? "").toLowerCase().includes(skuTerm));
    }

    if (onlyWithSales30d) {
      base = base.filter((listing) => (salesData[listing.item_id] ?? 0) > 0);
    }

    return base;
  }, [listings, profitFilter, skuFilter, getProfitPercent, onlyWithSales30d, salesData]);

  /** Com filtro de lucro, paginação no cliente; senão usa total do servidor */
  const totalPages = profitFilter
    ? Math.max(1, Math.ceil(filteredListings.length / pageSize))
    : Math.ceil(total / pageSize);

  /** Com filtro de lucro, mostra só a fatia da página atual; senão mostra todos da página */
  const sortedListings = useMemo(() => {
    if (!profitFilter) return filteredListings;
    const start = (page - 1) * pageSize;
    return filteredListings.slice(start, start + pageSize);
  }, [filteredListings, profitFilter, page, pageSize]);

  const selectedCount = useMemo(() => selectedIds.size, [selectedIds]);

  /** Mercado Livre exige desconto ≥ 5% na promoção: preço novo deve ser ≤ 95% do preço atual. */
  const isValidForCampaign = useCallback((listing: ListingWithPricing): boolean => {
    if (listing.current_price <= 0 || listing.new_price <= 0) return false;
    const minNewPrice = listing.current_price * 0.95;
    return listing.new_price <= minNewPrice;
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    if (selectedIds.size === sortedListings.length) {
      setSelectedIds(new Set());
      return;
    }
    const next = new Set<string>();
    sortedListings.forEach((l) => next.add(l.id));
    setSelectedIds(next);
  }, [selectedIds, sortedListings]);

  const handleToggleSelectOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleOpenCampaign = useCallback(() => {
    const selectedListings = listings.filter((l) => selectedIds.has(l.id));
    const invalidForCampaign = selectedListings.filter((l) => !isValidForCampaign(l));
    if (invalidForCampaign.length > 0) {
      const names = invalidForCampaign.map((l) => l.title || l.item_id).slice(0, 5);
      const more = invalidForCampaign.length > 5 ? ` e mais ${invalidForCampaign.length - 5}` : "";
      setCampaignMessage({
        type: "error",
        text: `O Mercado Livre exige desconto ≥ 5% na promoção. ${invalidForCampaign.length} item(ns) selecionado(s) não atendem: ${names.join(", ")}${more}. Ajuste o preço ou desmarque-os.`,
      });
      return;
    }
    setCampaignMessage(null);
    const today = new Date();
    const toDateInput = (d: Date) => d.toISOString().slice(0, 10);
    const start = toDateInput(today);
    const finishDate = new Date(today);
    finishDate.setDate(finishDate.getDate() + 6);
    const finish = toDateInput(finishDate);
    setCampaignStart(start);
    setCampaignFinish(finish);
    if (!campaignName) {
      const month = (today.getMonth() + 1).toString().padStart(2, "0");
      const year = today.getFullYear().toString().slice(-2);
      setCampaignName(`EP ${month}-${year}`);
    }
    setCampaignOpen(true);
  }, [campaignName, selectedIds, listings, isValidForCampaign]);

  const handleCreateCampaign = useCallback(async () => {
    if (!campaignName.trim()) {
      setCampaignMessage({ type: "error", text: "Informe o nome da campanha." });
      return;
    }
    if (!campaignStart || !campaignFinish) {
      setCampaignMessage({ type: "error", text: "Informe data de início e término." });
      return;
    }
    if (selectedIds.size === 0) {
      setCampaignMessage({ type: "error", text: "Selecione pelo menos um anúncio." });
      return;
    }

    const selectedListingsForCampaign = listings.filter((l) => selectedIds.has(l.id));
    const validListings = selectedListingsForCampaign.filter((l) => isValidForCampaign(l));
    if (validListings.length === 0) {
      setCampaignMessage({
        type: "error",
        text: "Nenhum item selecionado atende ao desconto mínimo de 5% do Mercado Livre. Ajuste o preço ou desmarque e selecione outros.",
      });
      return;
    }
    const items = validListings.map((l) => ({
      item_id: l.item_id,
      variation_id: l.variation_id,
    }));

    setCampaignLoading(true);
    setCampaignMessage(null);
    try {
      const res = await fetch("/api/mercadolivre/seller-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaignName.trim(),
          start_date: campaignStart,
          finish_date: campaignFinish,
          items,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCampaignMessage({
          type: "error",
          text:
            (data as { error?: string; details?: string }).error ||
            (data as { error?: string; details?: string }).details ||
            "Erro ao criar campanha no Mercado Livre.",
        });
        return;
      }

      const summary = (data as { summary?: { applied?: number; skipped_no_planned_price?: number; errors?: number } }).summary || {};
      const applied = summary.applied ?? 0;
      const skipped = summary.skipped_no_planned_price ?? 0;
      const errors = summary.errors ?? 0;
      const campaign = (data as { campaign?: { id?: string } }).campaign;

      const excluded = selectedListingsForCampaign.length - validListings.length;
      const excludedText = excluded > 0 ? ` ${excluded} ignorado(s) (desconto < 5%).` : "";
      setCampaignMessage({
        type: "ok",
        text: `Campanha criada${campaign?.id ? ` (${campaign.id})` : ""}: ${applied} item(s) incluído(s), ${skipped} sem preço salvo, ${errors} com erro.${excludedText}`,
      });
      setSelectedIds(new Set());
      setCampaignOpen(false);
      setTimeout(() => setCampaignMessage(null), 6000);
    } catch {
      setCampaignMessage({
        type: "error",
        text: "Erro de rede ao criar campanha no Mercado Livre.",
      });
    } finally {
      setCampaignLoading(false);
    }
  }, [campaignName, campaignStart, campaignFinish, selectedIds, listings, isValidForCampaign]);

  if (loading && listings.length === 0) {
    return (
      <div className="rounded-app bg-white/90 p-4 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm text-slate-500">Carregando…</p>
      </div>
    );
  }

  return (
    <div className="rounded-app bg-white/90 p-4 shadow-sm ring-1 ring-slate-200">
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      {campaignOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setCampaignOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold">Criar campanha no Mercado Livre</h2>
            <div className="space-y-3 text-sm">
              <div>
                <label className="mb-1 block text-gray-700">Nome da campanha</label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  placeholder="Ex.: Campanha preços março"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-gray-700">Início</label>
                  <input
                    type="date"
                    value={campaignStart}
                    onChange={(e) => setCampaignStart(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-gray-700">Término</label>
                  <input
                    type="date"
                    value={campaignFinish}
                    onChange={(e) => setCampaignFinish(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Use os anúncios selecionados nesta página. O preço de cada item virá do &quot;Preço Novo&quot; salvo (planned_price).
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCampaignOpen(false)}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                disabled={campaignLoading}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateCampaign}
                disabled={campaignLoading}
                className="rounded bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
              >
                {campaignLoading ? "Criando…" : "Criar campanha"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">Calculadora de Preços</h1>
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
          <p className="mt-1 text-xs text-slate-600 sm:text-sm">
            Simule preços de venda e veja o valor líquido a receber
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm">
            <input
              type="checkbox"
              checked={isMercadoLider}
              onChange={(e) => setIsMercadoLider(e.target.checked)}
              className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
              disabled={reputationLoading}
            />
            <span>Mercado Líder (calcular frete)</span>
          </label>
          <button
            type="button"
            onClick={handleCalculateAll}
            disabled={calculating || listings.length === 0}
            className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {calculating ? "Calculando…" : "Calcular Todos"}
          </button>
          <button
            type="button"
            onClick={handleSavePlannedPrices}
            disabled={saving || dirtyCount === 0}
            className="rounded-full border border-emerald-600 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 shadow-sm hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar preços alterados"}
          </button>
          <button
            type="button"
            onClick={handleOpenCampaign}
            disabled={listings.length === 0 || selectedCount === 0}
            className="rounded-full border border-indigo-600 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-700 shadow-sm hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Criar campanha ML ({selectedCount})
          </button>
        </div>
      </div>

      {saveMessage && (
        <div
          className={`mb-4 rounded p-3 text-sm ${
            saveMessage.type === "ok"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {saveMessage.text}
        </div>
      )}

      {campaignMessage && (
        <div
          className={`mb-4 rounded p-3 text-sm ${
            campaignMessage.type === "ok"
              ? "bg-blue-50 text-blue-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {campaignMessage.text}
        </div>
      )}

      {dirtyCount > 0 && (
        <div className="mb-4 rounded bg-amber-50 p-3 text-sm text-amber-700">
          {dirtyCount} item(s) com preço alterado. Clique em &quot;Calcular Todos&quot; ou
          pressione Enter no campo de preço para recalcular.
        </div>
      )}

      <form onSubmit={handleSearchSubmit} className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-1 items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 ring-1 ring-slate-200">
          <span className="text-xs text-slate-500">Buscar</span>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Título ou MLB…"
            className="h-7 flex-1 border-0 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 ring-1 ring-slate-200">
          <span className="text-xs text-slate-500">SKU</span>
          <input
            type="text"
            value={skuFilter}
            onChange={(e) => setSkuFilter(e.target.value)}
            placeholder="Filtrar por SKU…"
            className="w-24 border-0 bg-transparent font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
        >
          Aplicar filtros
        </button>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Todos os status</option>
          <option value="active">Ativo</option>
          <option value="paused">Pausado</option>
          <option value="closed">Fechado</option>
        </select>
        <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm">
          <input
            type="checkbox"
            checked={linkedOnly}
            onChange={(e) => {
              setLinkedOnly(e.target.checked);
              setPage(1);
            }}
            className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
          />
          <span>Só vinculados</span>
        </label>
        <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm" title="Exibe apenas anúncios com pelo menos 1 venda nos últimos 30 dias">
          <input
            type="checkbox"
            checked={onlyWithSales30d}
            onChange={(e) => {
              setOnlyWithSales30d(e.target.checked);
              setPage(1);
            }}
            className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
          />
          <span>Só com vendas (30d)</span>
        </label>
        <span className="text-xs text-slate-500">Lucratividade:</span>
        <div className="flex flex-wrap gap-1">
          {(
            [
              { value: "" as const, label: "Todos" },
              { value: "high" as const, label: "> 20%" },
              { value: "medium" as const, label: "10–20%" },
              { value: "low" as const, label: "0–10%" },
              { value: "negative" as const, label: "Prejuízo" },
            ] as const
          ).map(({ value, label }) => (
            <button
              key={value || "all"}
              type="button"
              onClick={() => setProfitFilter(value)}
              className={`rounded-full px-2 py-1 text-xs font-medium ${
                profitFilter === value
                  ? "bg-brand-blue text-white"
                  : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {(search || skuFilter || statusFilter || linkedOnly || onlyWithSales30d || profitFilter || sortBy) && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setSearchInput("");
              setSkuFilter("");
              setStatusFilter("active");
              setLinkedOnly(false);
              setOnlyWithSales30d(false);
              setProfitFilter("");
              setSortBy("");
              setPage(1);
            }}
            className="text-xs font-medium text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline"
          >
            Limpar filtros
          </button>
        )}
      </form>

      {(search || skuFilter || statusFilter || linkedOnly || onlyWithSales30d || profitFilter || sortBy) && listings.length > 0 && (
        <p className="mb-4 text-sm font-medium text-slate-700">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-primary">
            {profitFilter ? filteredListings.length : total} itens atendem aos filtros
          </span>
          {totalPages > 1 && (
            <span className="ml-2 text-xs font-normal text-slate-500">
              · página {page} de {totalPages}
            </span>
          )}
        </p>
      )}

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

      {salesError && !salesLoading && (
        <div className="mb-4 rounded bg-amber-50 p-3 text-sm text-amber-800">
          Não foi possível carregar vendas/pedidos (30 dias). As colunas &quot;Vendas (30d)&quot; e &quot;Pedidos (30d)&quot; podem aparecer vazias. Verifique sua conexão ou tente novamente mais tarde.
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
        <p className="text-sm text-slate-500">Carregando anúncios…</p>
      ) : listings.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum anúncio encontrado com os filtros selecionados.</p>
      ) : filteredListings.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nenhum anúncio nesta faixa de lucratividade. Calcule os preços ou escolha outro filtro.
        </p>
      ) : (
        <>
          <AppTable
            summary={
              profitFilter
                ? `${filteredListings.length} de ${listings.length} nesta página (lucro ${profitFilter === "high" ? "> 20%" : profitFilter === "medium" ? "10–20%" : profitFilter === "low" ? "0–10%" : "≤ 0%"}) — página ${page} de ${totalPages || 1}`
                : `${total} anúncio(s) — página ${page} de ${totalPages || 1}`
            }
            maxHeight="70vh"
          >
            <thead className="bg-slate-50">
              <tr>
                <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300"
                    checked={sortedListings.length > 0 && selectedIds.size === sortedListings.length}
                    onChange={handleToggleSelectAll}
                  />
                </th>
                <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Imagem
                </th>
                <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  MLB
                </th>
                <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Título
                </th>
                <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  SKU
                </th>
                <th
                  className="cursor-pointer select-none rounded p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-100"
                  title="Clique para ordenar por vendas (30 dias)"
                  onClick={() => {
                    const next = sortBy === "" ? "sales_desc" : sortBy === "sales_desc" ? "sales_asc" : "";
                    setSortBy(next);
                    if (next) setPage(1);
                  }}
                >
                  Vendas (30d)
                  {sortBy === "sales_desc" && " ↓"}
                  {sortBy === "sales_asc" && " ↑"}
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600" title="Número de pedidos pagos (30 dias)">
                  Pedidos (30d)
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Custo
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Preço Atual
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600" title="Promoção ML exige desconto ≥ 5%">
                  Preço Novo
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Taxa ML
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Frete
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600" title="Imposto sobre o preço">
                  Imposto
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600" title="Taxa extra sobre o preço">
                  Taxa Extra
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600" title="Despesas fixas em R$ (cadastrado no produto)">
                  Desp. Fixas
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Vai Receber
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Lucro
                </th>
                <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Link
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedListings.map((listing) => {
                const profit =
                  listing.calculated && listing.cost_price != null
                    ? listing.calculated.net_amount - listing.cost_price
                    : null;
                const profitPercent =
                  profit != null && listing.new_price > 0
                    ? (profit / listing.new_price) * 100
                    : null;

                const isSelected = selectedIds.has(listing.id);

                return (
                  <tr
                    key={`${listing.id}-${listing.variation_id ?? "item"}`}
                    className="border-b border-slate-100 bg-white/50 hover:bg-primary/5"
                  >
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        checked={isSelected}
                        onChange={() => handleToggleSelectOne(listing.id)}
                      />
                    </td>
                    <td className="p-2">
                      {listing.thumbnail ? (
                        <img
                          src={listing.thumbnail.replace(/^http:/, "https:")}
                          alt=""
                          className="h-10 w-10 rounded-lg border border-slate-100 bg-slate-50 object-contain"
                        />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td
                      role="button"
                      tabIndex={0}
                      onClick={() => handleCopyToClipboard(listing.item_id, `mlb-${listing.id}-${listing.variation_id ?? "n"}`)}
                      onKeyDown={(e) => e.key === "Enter" && handleCopyToClipboard(listing.item_id, `mlb-${listing.id}-${listing.variation_id ?? "n"}`)}
                      title="Clique para copiar"
                      className="cursor-pointer select-none rounded-md bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700 hover:bg-slate-100"
                    >
                      {copiedCell === `mlb-${listing.id}-${listing.variation_id ?? "n"}` ? (
                        <span className="text-xs font-semibold text-emerald-600">Copiado!</span>
                      ) : (
                        listing.item_id
                      )}
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
                      <span className="line-clamp-2 text-sm font-medium text-slate-900">
                        {listing.title ?? "—"}
                      </span>
                    </td>
                    <td className="p-2 font-mono text-xs text-slate-700">
                      {listing.sku ? (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={() => handleCopyToClipboard(listing.sku!, `sku-${listing.id}-${listing.variation_id ?? "n"}`)}
                          onKeyDown={(e) => e.key === "Enter" && handleCopyToClipboard(listing.sku!, `sku-${listing.id}-${listing.variation_id ?? "n"}`)}
                          title="Clique para copiar"
                          className="cursor-pointer select-none block max-w-full truncate rounded-md bg-slate-50 px-2 py-1 text-left hover:bg-slate-100"
                        >
                          {copiedCell === `sku-${listing.id}-${listing.variation_id ?? "n"}` ? (
                            <span className="text-xs font-semibold text-emerald-600">Copiado!</span>
                          ) : (
                            listing.sku
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td
                      className="p-2 text-right text-sm tabular-nums"
                      title={
                        salesLoading
                          ? "Carregando vendas (30 dias)…"
                          : salesData[listing.item_id] != null
                            ? `${salesData[listing.item_id]} unidade(s) vendida(s) em 30 dias`
                            : "Soma das quantidades vendidas (pedidos pagos). Indisponível ou sem vendas."
                      }
                    >
                      {salesLoading ? (
                        <span className="text-gray-400">…</span>
                      ) : salesData[listing.item_id] != null ? (
                        salesData[listing.item_id]
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td
                      className="p-2 text-right text-sm tabular-nums"
                      title={
                        salesLoading
                          ? "Carregando…"
                          : ordersData[listing.item_id] != null
                            ? `${ordersData[listing.item_id]} pedido(s) em 30 dias`
                            : "Número de pedidos pagos que contêm este item."
                      }
                    >
                      {salesLoading ? (
                        <span className="text-gray-400">…</span>
                      ) : ordersData[listing.item_id] != null ? (
                        ordersData[listing.item_id]
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
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
                      <div className="flex flex-col items-end gap-0.5">
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
                        {listing.current_price > 0 && listing.new_price > 0 && !isValidForCampaign(listing) && (
                          <button
                            type="button"
                            onClick={() => handleApplyMinDiscount(listing)}
                            disabled={listing.calculating}
                            className="text-xs text-amber-600 underline hover:text-amber-700 disabled:opacity-50 whitespace-nowrap"
                            title="Clique para ajustar ao desconto mínimo de 5% (preço = 95% do atual)"
                          >
                            Ajustar para 5%
                          </button>
                        )}
                      </div>
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
                    <td className="p-2 text-right text-sm">
                      {listing.calculating ? (
                        <span className="text-gray-400">…</span>
                      ) : listing.calculated ? (
                        <span
                          className={
                            listing.calculated.tax_amount > 0
                              ? "text-orange-600"
                              : "text-gray-400"
                          }
                          title={listing.tax_percent ? `${listing.tax_percent}%` : undefined}
                        >
                          {listing.calculated.tax_amount > 0
                            ? `R$ ${formatBRL(listing.calculated.tax_amount)}`
                            : "—"}
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
                            listing.calculated.extra_fee_amount > 0
                              ? "text-purple-600"
                              : "text-gray-400"
                          }
                          title={listing.extra_fee_percent ? `${listing.extra_fee_percent}%` : undefined}
                        >
                          {listing.calculated.extra_fee_amount > 0
                            ? `R$ ${formatBRL(listing.calculated.extra_fee_amount)}`
                            : "—"}
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
                            listing.calculated.fixed_expenses_amount > 0
                              ? "text-indigo-600"
                              : "text-gray-400"
                          }
                          title={listing.fixed_expenses != null ? `R$ ${formatBRL(listing.fixed_expenses)}` : undefined}
                        >
                          {listing.calculated.fixed_expenses_amount > 0
                            ? `R$ ${formatBRL(listing.calculated.fixed_expenses_amount)}`
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
                          className="inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/15"
                        >
                          Ver no ML
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </AppTable>

          {totalPages > 1 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                {profitFilter
                  ? `${filteredListings.length} de ${listings.length} itens nesta página (filtro de lucro aplicado) · página ${page} de ${totalPages}`
                  : `Mostrando página ${page} de ${totalPages} · ${total} anúncio(s)`}
              </p>
              <div className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 text-xs ring-1 ring-slate-200">
                <button
                  type="button"
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="rounded-full px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  «
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-full px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Anterior
                </button>
                <span className="px-2 text-xs font-semibold text-slate-800">
                  {page}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-full px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Próxima
                </button>
                <button
                  type="button"
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  className="rounded-full px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  »
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
