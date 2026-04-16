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

/** Configuração das colunas da tabela de preços (ordem = índice na tabela). Usado para congelar colunas. */
/** Ícone do Mercado Livre para link "Ver no ML" — usa favicon oficial */
function MLIcon({ className }: { className?: string }) {
  return (
    <img
      src="https://www.mercadolivre.com.br/favicon.ico"
      alt=""
      width={20}
      height={20}
      className={className}
    />
  );
}

/** Ícone de alfinete para congelar/descongelar coluna no cabeçalho da tabela */
function PinIcon({ pinned, className }: { pinned: boolean; className?: string }) {
  const pathD = "M16 12V4h1V2H7v2h1v8l-4 4v2h12v-2l-4-4z";
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={pinned ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={pathD} />
    </svg>
  );
}

const PRICING_COLUMNS: { label: string; minWidth: number }[] = [
  { label: "Seleção", minWidth: 44 },
  { label: "Imagem", minWidth: 52 },
  { label: "MLB", minWidth: 100 },
  { label: "Título", minWidth: 200 },
  { label: "SKU", minWidth: 110 },
  { label: "Vendas (30d)", minWidth: 88 },
  { label: "Pedidos (30d)", minWidth: 88 },
  { label: "Custo", minWidth: 80 },
  { label: "Preço Atual", minWidth: 90 },
  { label: "Preço Novo", minWidth: 100 },
  { label: "Taxa ML", minWidth: 72 },
  { label: "Frete", minWidth: 72 },
  { label: "Imposto", minWidth: 80 },
  { label: "Taxa Extra", minWidth: 88 },
  { label: "Desp. Fixas", minWidth: 88 },
  { label: "Vai Receber", minWidth: 95 },
  { label: "Lucro", minWidth: 95 },
  { label: "Link", minWidth: 88 },
];

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
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [skuFilter, setSkuFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
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
  const [cacheRefreshing, setCacheRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [cacheEmpty, setCacheEmpty] = useState(false);
  const [refreshingItemId, setRefreshingItemId] = useState<string | null>(null);
  /** Ordenação: "" = padrão, "sales_desc" = mais vendas primeiro, "sales_asc" = menos vendas primeiro */
  const [sortBy, setSortBy] = useState<"" | "sales_desc" | "sales_asc">("");
  /** Mostrar somente itens com vendas nos últimos 30 dias */
  const [onlyWithSales30d, setOnlyWithSales30d] = useState(false);
  /** Com filtros no cliente: carregar até 2000 itens de uma vez (em vez de 500) */
  const [loadAllResults, setLoadAllResults] = useState(false);
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
  /** Barra de filtros lateral: expandida ao clicar, recolhe ao aplicar filtros */
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  /** Índices das colunas congeladas (0-based). Ordem dos congelados = ordem na tabela. */
  const [stickyColumns, setStickyColumns] = useState<Set<number>>(() => new Set([0, 1, 2, 3, 4]));
  /** Menu de contexto (botão direito) no cabeçalho: índice da coluna e posição para posicionar o menu */
  const [contextMenuCol, setContextMenuCol] = useState<number | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

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

  /** Com filtro de lucro ou "só com vendas 30d" ativo, busca mais itens e aplica filtros no cliente (paginação no cliente) */
  const clientSideFiltering = !!(profitFilter || onlyWithSales30d);
  const MAX_CLIENT_SIDE_LOAD = 10000;
  const DEFAULT_CLIENT_SIDE_LOAD = 2000;
  const limitForRequest = clientSideFiltering
    ? (loadAllResults ? MAX_CLIENT_SIDE_LOAD : DEFAULT_CLIENT_SIDE_LOAD)
    : pageSize;
  const pageForRequest = clientSideFiltering ? 1 : page;

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
    if (onlyWithSales30d) params.set("only_with_sales", "1");

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
          const apiItem = item as PricingListing & {
            planned_price?: number;
            calculated_price?: number | null;
            calculated_fee?: number | null;
            calculated_shipping_cost?: number | null;
            calculated_at?: string | null;
          };
          const fromApi = apiItem.planned_price;
          const savedPrice = plannedMap.get(key);
          const newPrice = fromApi ?? savedPrice ?? item.current_price;
          let calculated: CalculatedPricing | undefined;
          if (
            apiItem.calculated_price != null &&
            apiItem.calculated_fee != null &&
            apiItem.calculated_shipping_cost != null
          ) {
            calculated = calculateFullPricing(item, {
              price: apiItem.calculated_price,
              fee: apiItem.calculated_fee,
              shipping_cost: apiItem.calculated_shipping_cost,
            });
          }
          return {
            ...item,
            new_price: newPrice,
            dirty: false,
            calculated,
          };
        })
      );
      setTotal(listingsData.total ?? 0);
      setLastUpdatedAt((listingsData as { last_updated_at?: string | null }).last_updated_at ?? null);
      setCacheEmpty((listingsData as { cache_empty?: boolean }).cache_empty ?? false);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [pageForRequest, limitForRequest, search, statusFilter, linkedOnly, sortBy, skuFilter, onlyWithSales30d]);

  const handleRefreshCache = useCallback(async () => {
    setCacheRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch("/api/pricing/cache/refresh", { method: "POST" });
      const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as { error?: string }).error ?? "Falha ao atualizar o cache";
        console.error("[precos] Refresh cache falhou:", res.status, data);
        setRefreshError(msg);
      }
      await loadListings();
    } catch (err) {
      setRefreshError("Erro de conexão ao atualizar. Tente novamente.");
      await loadListings();
    } finally {
      setCacheRefreshing(false);
    }
  }, [loadListings]);

  const handleRefreshItem = useCallback(
    async (itemId: string) => {
      setRefreshingItemId(itemId);
      try {
        const res = await fetch("/api/pricing/cache/refresh-item", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_id: itemId }),
        });
        if (res.ok) await loadListings();
      } finally {
        setRefreshingItemId(null);
      }
    },
    [loadListings]
  );

  const formatLastUpdated = useCallback((iso: string | null) => {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return iso;
    }
  }, []);

  /** Ao mudar filtros do servidor (ou sair do modo cliente), voltar a carregar só 500 quando em modo cliente */
  useEffect(() => {
    if (clientSideFiltering) setLoadAllResults(false);
  }, [clientSideFiltering, search, statusFilter, linkedOnly, sortBy, skuFilter]);

  useEffect(() => {
    loadReputation();
  }, [loadReputation]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  useEffect(() => {
    setPage(1);
  }, [profitFilter, onlyWithSales30d]);

  /** Dados sempre vêm do cache (listings já inclui sales/orders). Não busca vendas em separado. */

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

  /** Ajusta o preço novo para o mínimo aceito na promoção ML (desconto de 5%). Arredonda para baixo para nunca ultrapassar 95%. */
  const handleApplyMinDiscount = useCallback(
    async (listing: ListingWithPricing) => {
      const newPrice = Math.floor(listing.current_price * 0.95 * 100) / 100;
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
    setFilterPanelOpen(false);
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

  /** % de lucro para exibição e filtros. Com calculated usa lucro líquido; senão usa margem bruta (preço - custo)/preço. */
  const getProfitPercent = useCallback((listing: ListingWithPricing): number | null => {
    if (listing.cost_price == null || listing.new_price <= 0) return null;
    if (listing.calculated) {
      const profit = listing.calculated.net_amount - listing.cost_price;
      return (profit / listing.new_price) * 100;
    }
    const grossProfit = listing.new_price - listing.cost_price;
    return (grossProfit / listing.new_price) * 100;
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

  /** Com filtros que dependem do cliente (lucro ou vendas 30d), paginação no cliente; senão usa total do servidor */
  const totalPages = clientSideFiltering
    ? Math.max(1, Math.ceil(filteredListings.length / pageSize))
    : Math.ceil(total / pageSize);

  /** Para cada coluna, estilo sticky (left, minWidth) se estiver em stickyColumns; senão null */
  const stickyColumnStyles = useMemo(() => {
    const arr: ({ left: number; minWidth: number } | null)[] = [];
    let left = 0;
    for (let i = 0; i < PRICING_COLUMNS.length; i++) {
      if (stickyColumns.has(i)) {
        arr[i] = { left, minWidth: PRICING_COLUMNS[i].minWidth };
        left += PRICING_COLUMNS[i].minWidth;
      } else {
        arr[i] = null;
      }
    }
    return arr;
  }, [stickyColumns]);

  const toggleStickyColumn = useCallback((colIndex: number) => {
    setStickyColumns((prev) => {
      const next = new Set(prev);
      if (next.has(colIndex)) next.delete(colIndex);
      else next.add(colIndex);
      return next;
    });
    setContextMenuCol(null);
    setContextMenuPos(null);
  }, []);

  useEffect(() => {
    if (contextMenuCol === null) return;
    const close = () => {
      setContextMenuCol(null);
      setContextMenuPos(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [contextMenuCol]);

  /** Com filtros no cliente (lucro ou vendas 30d), mostra só a fatia da página atual; senão mostra todos da página */
  const sortedListings = useMemo(() => {
    if (!clientSideFiltering) return filteredListings;
    const start = (page - 1) * pageSize;
    return filteredListings.slice(start, start + pageSize);
  }, [filteredListings, clientSideFiltering, page, pageSize]);

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

      <div className="flex w-full min-h-0 gap-4">
        <aside
          className={`flex shrink-0 flex-col self-start rounded-r-lg border border-slate-200 bg-white shadow-sm transition-[width] duration-200 ease-out ${
            filterPanelOpen ? "w-[280px]" : "w-10"
          }`}
        >
          {filterPanelOpen ? (
            <div className="flex flex-col gap-3 overflow-y-auto p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">Filtros</span>
                <button
                  type="button"
                  onClick={() => setFilterPanelOpen(false)}
                  className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                  title="Fechar"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">Buscar</span>
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Título ou MLB…"
                    className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">SKU</span>
                  <input
                    type="text"
                    value={skuFilter}
                    onChange={(e) => setSkuFilter(e.target.value)}
                    placeholder="Filtrar por SKU…"
                    className="w-full rounded border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">Status</span>
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Todos os status</option>
                    <option value="active">Ativo</option>
                    <option value="paused">Pausado</option>
                    <option value="closed">Fechado</option>
                  </select>
                </div>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={linkedOnly}
                    onChange={(e) => {
                      setLinkedOnly(e.target.checked);
                      setPage(1);
                    }}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                  <span className="text-xs text-slate-700">Só vinculados</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2" title="Exibe apenas anúncios com pelo menos 1 venda nos últimos 30 dias">
                  <input
                    type="checkbox"
                    checked={onlyWithSales30d}
                    onChange={(e) => {
                      setOnlyWithSales30d(e.target.checked);
                      setPage(1);
                    }}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                  <span className="text-xs text-slate-700">Só com vendas (30d)</span>
                </label>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">Lucratividade</span>
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
                        className={`rounded px-2 py-1 text-xs font-medium ${
                          profitFilter === value
                            ? "bg-brand-blue text-white"
                            : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="submit"
                    className="w-full rounded bg-primary py-2 text-xs font-semibold text-white hover:bg-primary-dark"
                  >
                    Aplicar filtros
                  </button>
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
                      className="w-full rounded border border-slate-300 bg-white py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Limpar filtros
                    </button>
                  )}
                </div>
              </form>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setFilterPanelOpen(true)}
              className="flex flex-col items-center gap-0.5 py-2 w-full text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
              title="Abrir filtros"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              {(search || skuFilter || statusFilter || linkedOnly || onlyWithSales30d || profitFilter || sortBy) && (
                <span className="rounded-full bg-primary h-1.5 w-1.5" title="Filtros ativos" />
              )}
            </button>
          )}
        </aside>

        <main className="min-w-0 flex-1">
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
          {lastUpdatedAt != null && (
            <span className="text-xs text-slate-500">
              Última atualização: {formatLastUpdated(lastUpdatedAt)}
            </span>
          )}
          <button
            type="button"
            onClick={handleRefreshCache}
            disabled={cacheRefreshing || loading}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            title="Atualiza anúncios, vínculos MLB-SKU e vendas 30d no cache"
          >
            {cacheRefreshing ? "Atualizando…" : "Atualizar dados"}
          </button>
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

      {refreshError && !cacheEmpty && (
        <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          {refreshError}
          <button type="button" onClick={() => setRefreshError(null)} className="ml-2 underline">Fechar</button>
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
      ) : cacheEmpty && !loading ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
          <p className="text-sm text-amber-800">Nenhum dado no cache.</p>
          <p className="mt-1 text-xs text-amber-700">Clique em &quot;Atualizar dados&quot; para carregar os anúncios a partir do Mercado Livre.</p>
          {refreshError && (
            <p className="mt-2 text-xs font-medium text-red-600">{refreshError}</p>
          )}
          <button
            type="button"
            onClick={handleRefreshCache}
            disabled={cacheRefreshing}
            className="mt-3 rounded-full bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {cacheRefreshing ? "Atualizando…" : "Atualizar dados"}
          </button>
        </div>
      ) : listings.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum anúncio encontrado com os filtros selecionados.</p>
      ) : filteredListings.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nenhum anúncio nesta faixa de lucratividade. Calcule os preços ou escolha outro filtro.
        </p>
      ) : (
        <>
          <div className="pricing-table-with-sticky">
          {contextMenuCol !== null && contextMenuPos && (
            <div
              className="fixed z-30 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
              style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
            >
              <button
                type="button"
                onClick={() => toggleStickyColumn(contextMenuCol)}
                className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                {stickyColumns.has(contextMenuCol) ? "Descongelar coluna" : "Congelar coluna"}
              </button>
            </div>
          )}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-800">{clientSideFiltering ? filteredListings.length : total}</span>
              {" anúncios filtrados de "}
              <span className="font-medium text-slate-800">{total}</span>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {clientSideFiltering && total > listings.length && listings.length < MAX_CLIENT_SIDE_LOAD && (
                <button
                  type="button"
                  onClick={() => setLoadAllResults(true)}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  title="Carregar até 10.000 itens para aplicar os filtros em todo o resultado"
                >
                  Carregar todos (até 10.000)
                </button>
              )}
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <span>Linhas por página</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setPageSize(value);
                    setPage(1);
                  }}
                  className="rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                  <option value={500}>500</option>
                  <option value={1000}>1000</option>
                </select>
              </label>
              {totalPages > 1 && (
                <>
                  <span className="text-xs text-slate-500">Página {page} de {totalPages}</span>
                  <div className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-1 text-xs ring-1 ring-slate-200">
                  <button
                    type="button"
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                    className="rounded-full px-2 py-1 font-medium text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Primeira página"
                  >
                    «
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-full px-2 py-1 font-medium text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <span className="min-w-[2ch] px-1.5 py-1 text-center font-semibold text-slate-800">
                    {page}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="rounded-full px-2 py-1 font-medium text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Próxima
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages}
                    className="rounded-full px-2 py-1 font-medium text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Última página"
                  >
                    »
                  </button>
                </div>
                </>
              )}
            </div>
          </div>
          <AppTable
            maxHeight="70vh"
          >
            <thead className="bg-slate-50">
              <tr>
                <th
                  className={`p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[0] ? "sticky-col" : ""}`}
                  style={stickyColumnStyles[0] ? { position: "sticky", left: stickyColumnStyles[0].left, minWidth: stickyColumnStyles[0].minWidth } : undefined}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(0); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      checked={sortedListings.length > 0 && selectedIds.size === sortedListings.length}
                      onChange={handleToggleSelectAll}
                    />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleStickyColumn(0); }}
                      title={stickyColumns.has(0) ? "Descongelar coluna" : "Congelar coluna"}
                      className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100"
                    >
                      <PinIcon pinned={stickyColumns.has(0)} className={stickyColumns.has(0) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th
                  className={`p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[1] ? "sticky-col" : ""}`}
                  style={stickyColumnStyles[1] ? { position: "sticky", left: stickyColumnStyles[1].left, minWidth: stickyColumnStyles[1].minWidth } : undefined}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(1); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>Imagem</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(1); }} title={stickyColumns.has(1) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(1)} className={stickyColumns.has(1) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th
                  className={`p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[2] ? "sticky-col" : ""}`}
                  style={stickyColumnStyles[2] ? { position: "sticky", left: stickyColumnStyles[2].left, minWidth: stickyColumnStyles[2].minWidth } : undefined}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(2); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>MLB</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(2); }} title={stickyColumns.has(2) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(2)} className={stickyColumns.has(2) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th
                  className={`p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[3] ? "sticky-col" : ""}`}
                  style={stickyColumnStyles[3] ? { position: "sticky", left: stickyColumnStyles[3].left, minWidth: stickyColumnStyles[3].minWidth } : undefined}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(3); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>Título</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(3); }} title={stickyColumns.has(3) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(3)} className={stickyColumns.has(3) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th
                  className={`p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[4] ? "sticky-col" : ""}`}
                  style={stickyColumnStyles[4] ? { position: "sticky", left: stickyColumnStyles[4].left, minWidth: stickyColumnStyles[4].minWidth } : undefined}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(4); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>SKU</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(4); }} title={stickyColumns.has(4) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(4)} className={stickyColumns.has(4) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th
                  className={`cursor-pointer select-none rounded p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-100 ${stickyColumnStyles[5] ? "sticky-col" : ""}`}
                  style={stickyColumnStyles[5] ? { position: "sticky", left: stickyColumnStyles[5].left, minWidth: stickyColumnStyles[5].minWidth } : undefined}
                  title="Clique para ordenar por vendas (30 dias)"
                  onClick={() => {
                    const next = sortBy === "" ? "sales_desc" : sortBy === "sales_desc" ? "sales_asc" : "";
                    setSortBy(next);
                    if (next) setPage(1);
                  }}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(5); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Vendas (30d){sortBy === "sales_desc" && " ↓"}{sortBy === "sales_asc" && " ↑"}</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(5); }} title={stickyColumns.has(5) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(5)} className={stickyColumns.has(5) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th className={`p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[6] ? "sticky-col" : ""}`} style={stickyColumnStyles[6] ? { position: "sticky", left: stickyColumnStyles[6].left, minWidth: stickyColumnStyles[6].minWidth } : undefined} title="Número de pedidos pagos (30 dias)" onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(6); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Pedidos (30d)</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(6); }} title={stickyColumns.has(6) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(6)} className={stickyColumns.has(6) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th className={`p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[7] ? "sticky-col" : ""}`} style={stickyColumnStyles[7] ? { position: "sticky", left: stickyColumnStyles[7].left, minWidth: stickyColumnStyles[7].minWidth } : undefined} onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(7); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Custo</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(7); }} title={stickyColumns.has(7) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(7)} className={stickyColumns.has(7) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th className={`p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[8] ? "sticky-col" : ""}`} style={stickyColumnStyles[8] ? { position: "sticky", left: stickyColumnStyles[8].left, minWidth: stickyColumnStyles[8].minWidth } : undefined} onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(8); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Preço Atual</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(8); }} title={stickyColumns.has(8) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(8)} className={stickyColumns.has(8) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th className={`p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[9] ? "sticky-col" : ""}`} style={stickyColumnStyles[9] ? { position: "sticky", left: stickyColumnStyles[9].left, minWidth: stickyColumnStyles[9].minWidth } : undefined} title="Promoção ML exige desconto ≥ 5%" onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(9); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Preço Novo</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(9); }} title={stickyColumns.has(9) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(9)} className={stickyColumns.has(9) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th className={`p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[10] ? "sticky-col" : ""}`} style={stickyColumnStyles[10] ? { position: "sticky", left: stickyColumnStyles[10].left, minWidth: stickyColumnStyles[10].minWidth } : undefined} onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(10); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Taxa ML</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(10); }} title={stickyColumns.has(10) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(10)} className={stickyColumns.has(10) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th className={`p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[11] ? "sticky-col" : ""}`} style={stickyColumnStyles[11] ? { position: "sticky", left: stickyColumnStyles[11].left, minWidth: stickyColumnStyles[11].minWidth } : undefined} onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(11); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Frete</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(11); }} title={stickyColumns.has(11) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(11)} className={stickyColumns.has(11) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th className={`p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[12] ? "sticky-col" : ""}`} style={stickyColumnStyles[12] ? { position: "sticky", left: stickyColumnStyles[12].left, minWidth: stickyColumnStyles[12].minWidth } : undefined} title="Imposto sobre o preço" onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(12); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Imposto</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(12); }} title={stickyColumns.has(12) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(12)} className={stickyColumns.has(12) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th className={`p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[13] ? "sticky-col" : ""}`} style={stickyColumnStyles[13] ? { position: "sticky", left: stickyColumnStyles[13].left, minWidth: stickyColumnStyles[13].minWidth } : undefined} title="Taxa extra sobre o preço" onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(13); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Taxa Extra</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(13); }} title={stickyColumns.has(13) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(13)} className={stickyColumns.has(13) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th className={`p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[14] ? "sticky-col" : ""}`} style={stickyColumnStyles[14] ? { position: "sticky", left: stickyColumnStyles[14].left, minWidth: stickyColumnStyles[14].minWidth } : undefined} title="Despesas fixas em R$ (cadastrado no produto)" onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(14); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Desp. Fixas</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(14); }} title={stickyColumns.has(14) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(14)} className={stickyColumns.has(14) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th className={`p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[15] ? "sticky-col" : ""}`} style={stickyColumnStyles[15] ? { position: "sticky", left: stickyColumnStyles[15].left, minWidth: stickyColumnStyles[15].minWidth } : undefined} onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(15); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Vai Receber</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(15); }} title={stickyColumns.has(15) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(15)} className={stickyColumns.has(15) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th className={`p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[16] ? "sticky-col" : ""}`} style={stickyColumnStyles[16] ? { position: "sticky", left: stickyColumnStyles[16].left, minWidth: stickyColumnStyles[16].minWidth } : undefined} onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(16); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Lucro</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(16); }} title={stickyColumns.has(16) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(16)} className={stickyColumns.has(16) ? "text-primary" : ""} />
                    </button>
                  </div>
                </th>
                <th className={`p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 ${stickyColumnStyles[17] ? "sticky-col" : ""}`} style={stickyColumnStyles[17] ? { position: "sticky", left: stickyColumnStyles[17].left, minWidth: stickyColumnStyles[17].minWidth } : undefined} onContextMenu={(e) => { e.preventDefault(); setContextMenuCol(17); setContextMenuPos({ x: e.clientX, y: e.clientY }); }}>
                  <div className="flex items-center justify-between gap-1">
                    <span>Link</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleStickyColumn(17); }} title={stickyColumns.has(17) ? "Descongelar coluna" : "Congelar coluna"} className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100">
                      <PinIcon pinned={stickyColumns.has(17)} className={stickyColumns.has(17) ? "text-primary" : ""} />
                    </button>
                  </div>
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
                    <td
                      className={`p-2 text-center ${stickyColumnStyles[0] ? "sticky-col" : ""}`}
                      style={stickyColumnStyles[0] ? { position: "sticky", left: stickyColumnStyles[0].left, minWidth: stickyColumnStyles[0].minWidth } : undefined}
                    >
                      <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        checked={isSelected}
                        onChange={() => handleToggleSelectOne(listing.id)}
                      />
                    </td>
                    <td
                      className={`p-2 ${stickyColumnStyles[1] ? "sticky-col" : ""}`}
                      style={stickyColumnStyles[1] ? { position: "sticky", left: stickyColumnStyles[1].left, minWidth: stickyColumnStyles[1].minWidth } : undefined}
                    >
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
                      className={`p-2 ${stickyColumnStyles[2] ? "sticky-col" : ""}`}
                      style={stickyColumnStyles[2] ? { position: "sticky", left: stickyColumnStyles[2].left, minWidth: stickyColumnStyles[2].minWidth } : undefined}
                    >
                      <div className="flex items-center gap-1">
                        <span
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
                            <span className="block text-gray-400">var: {listing.variation_id}</span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleRefreshItem(listing.item_id); }}
                          disabled={refreshingItemId === listing.item_id}
                          title="Atualizar este item no cache"
                          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 disabled:opacity-50"
                        >
                          {refreshingItemId === listing.item_id ? (
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                          ) : (
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </td>
                    <td
                      className={`max-w-[200px] truncate p-2 text-sm ${stickyColumnStyles[3] ? "sticky-col" : ""}`}
                      style={stickyColumnStyles[3] ? { position: "sticky", left: stickyColumnStyles[3].left, minWidth: stickyColumnStyles[3].minWidth } : undefined}
                      title={listing.title ?? ""}
                    >
                      <span className="line-clamp-2 text-sm font-medium text-slate-900">
                        {listing.title ?? "—"}
                      </span>
                    </td>
                    <td
                      className={`p-2 font-mono text-xs text-slate-700 ${stickyColumnStyles[4] ? "sticky-col" : ""}`}
                      style={stickyColumnStyles[4] ? { position: "sticky", left: stickyColumnStyles[4].left, minWidth: stickyColumnStyles[4].minWidth } : undefined}
                    >
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
                      className={`p-2 text-right text-sm tabular-nums ${stickyColumnStyles[5] ? "sticky-col" : ""}`}
                      style={stickyColumnStyles[5] ? { position: "sticky", left: stickyColumnStyles[5].left, minWidth: stickyColumnStyles[5].minWidth } : undefined}
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
                      className={`p-2 text-right text-sm tabular-nums ${stickyColumnStyles[6] ? "sticky-col" : ""}`}
                      style={stickyColumnStyles[6] ? { position: "sticky", left: stickyColumnStyles[6].left, minWidth: stickyColumnStyles[6].minWidth } : undefined}
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
                    <td className={`p-2 text-right text-sm ${stickyColumnStyles[7] ? "sticky-col" : ""}`} style={stickyColumnStyles[7] ? { position: "sticky", left: stickyColumnStyles[7].left, minWidth: stickyColumnStyles[7].minWidth } : undefined}>
                      {listing.cost_price != null ? (
                        <span className="text-gray-700">
                          R$ {formatBRL(listing.cost_price)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className={`p-2 text-right text-sm font-medium ${stickyColumnStyles[8] ? "sticky-col" : ""}`} style={stickyColumnStyles[8] ? { position: "sticky", left: stickyColumnStyles[8].left, minWidth: stickyColumnStyles[8].minWidth } : undefined}>
                      R$ {formatBRL(listing.current_price)}
                    </td>
                    <td className={`p-2 ${stickyColumnStyles[9] ? "sticky-col" : ""}`} style={stickyColumnStyles[9] ? { position: "sticky", left: stickyColumnStyles[9].left, minWidth: stickyColumnStyles[9].minWidth } : undefined}>
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
                    <td className={`p-2 text-right text-sm ${stickyColumnStyles[10] ? "sticky-col" : ""}`} style={stickyColumnStyles[10] ? { position: "sticky", left: stickyColumnStyles[10].left, minWidth: stickyColumnStyles[10].minWidth } : undefined}>
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
                    <td className={`p-2 text-right text-sm ${stickyColumnStyles[11] ? "sticky-col" : ""}`} style={stickyColumnStyles[11] ? { position: "sticky", left: stickyColumnStyles[11].left, minWidth: stickyColumnStyles[11].minWidth } : undefined}>
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
                    <td className={`p-2 text-right text-sm ${stickyColumnStyles[12] ? "sticky-col" : ""}`} style={stickyColumnStyles[12] ? { position: "sticky", left: stickyColumnStyles[12].left, minWidth: stickyColumnStyles[12].minWidth } : undefined}>
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
                    <td className={`p-2 text-right text-sm ${stickyColumnStyles[13] ? "sticky-col" : ""}`} style={stickyColumnStyles[13] ? { position: "sticky", left: stickyColumnStyles[13].left, minWidth: stickyColumnStyles[13].minWidth } : undefined}>
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
                    <td className={`p-2 text-right text-sm ${stickyColumnStyles[14] ? "sticky-col" : ""}`} style={stickyColumnStyles[14] ? { position: "sticky", left: stickyColumnStyles[14].left, minWidth: stickyColumnStyles[14].minWidth } : undefined}>
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
                    <td className={`p-2 text-right text-sm font-semibold ${stickyColumnStyles[15] ? "sticky-col" : ""}`} style={stickyColumnStyles[15] ? { position: "sticky", left: stickyColumnStyles[15].left, minWidth: stickyColumnStyles[15].minWidth } : undefined}>
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
                    <td className={`p-2 text-right text-sm ${stickyColumnStyles[16] ? "sticky-col" : ""}`} style={stickyColumnStyles[16] ? { position: "sticky", left: stickyColumnStyles[16].left, minWidth: stickyColumnStyles[16].minWidth } : undefined}>
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
                    <td className={`p-2 ${stickyColumnStyles[17] ? "sticky-col" : ""}`} style={stickyColumnStyles[17] ? { position: "sticky", left: stickyColumnStyles[17].left, minWidth: stickyColumnStyles[17].minWidth } : undefined}>
                      {listing.permalink ? (
                        <a
                          href={listing.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Ver no Mercado Livre"
                          className="inline-flex items-center justify-center rounded-full bg-primary/10 p-1.5 text-primary hover:bg-primary/15"
                        >
                          <MLIcon className="h-5 w-5" />
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
          </div>
        </>
      )}
        </main>
      </div>
    </div>
  );
}
