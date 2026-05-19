"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppTable } from "@/components/AppTable";
import type { FullPricingBreakdown } from "@/lib/pricing/full-net";
import {
  ML_PROMOTION_TYPE_CATALOG,
  labelForMlPromotionType,
  normalizeMlPromotionTypeCode,
} from "@/lib/mercadolivre/ml-promotion-types";
import { OnboardingGate } from "@/components/OnboardingGate";
import { PromocoesCampanhasTab } from "@/components/PromocoesCampanhasTab";
import { SmartLoaderOverlay } from "@/components/SmartLoaderOverlay";

const STORAGE_KEY = "escalapreco_dashboard_account_id";

/** Mesmo critério da tela Preços (`linked=1` / `linked=0`) — `ml_items.product_id`. */
type PromoLinkFilter = "all" | "linked" | "unlinked";

function linkFilterFromSearchParams(searchParams: URLSearchParams): PromoLinkFilter {
  const v = searchParams.get("linked")?.trim();
  if (v === "1") return "linked";
  if (v === "0") return "unlinked";
  return "all";
}

/** Filtro tipo de promoção (cache): ativa vs convite/possível — mesma ideia da coluna Tipo. */
type PromoKindFilter = "" | "ativa" | "possível";

function kindFilterFromSearchParams(searchParams: URLSearchParams): PromoKindFilter {
  const k = searchParams.get("kind")?.trim();
  if (k === "ativa" || k === "possível") return k;
  return "";
}

/** Faixas de lucratividade (%), alinhadas à tela Preços. */
type PromoProfitFilter = "" | "high" | "medium" | "low" | "negative";

function profitFilterFromSearchParams(searchParams: URLSearchParams): PromoProfitFilter {
  const p = searchParams.get("profit")?.trim();
  if (p === "high" || p === "medium" || p === "low" || p === "negative") return p;
  return "";
}

/** Fase da campanha pelas datas (parâmetro `camp` na URL). */
type PromoCampaignPhase = "" | "in" | "future" | "past" | "nodates";

function pmaLtePromoFilterFromSearchParams(searchParams: URLSearchParams): boolean {
  const v = searchParams.get("pmaok")?.trim() ?? searchParams.get("pma_lte")?.trim() ?? "";
  return v === "1" || v === "true" || v === "sim";
}

function campFilterFromSearchParams(searchParams: URLSearchParams): PromoCampaignPhase {
  const c = searchParams.get("camp")?.trim().toLowerCase() ?? "";
  if (c === "in" || c === "vigente" || c === "ativa_campanha") return "in";
  if (c === "future" || c === "futura" || c === "agendada") return "future";
  if (c === "past" || c === "encerrada" || c === "fim") return "past";
  if (c === "nodates" || c === "sem_data" || c === "semdata") return "nodates";
  return "";
}

/** Filtro por campo `type` do seller-promotions (ex.: DEAL, SMART). */
function ptypeFilterFromSearchParams(searchParams: URLSearchParams): string {
  const n = normalizeMlPromotionTypeCode(searchParams.get("ptype"));
  return n && /^[A-Z][A-Z0-9_]{0,63}$/.test(n) ? n : "";
}

function PromocoesHelpContent() {
  return (
    <div className="space-y-4 text-sm text-fg">
      <h2 className="text-lg font-semibold text-fg-strong">Como funciona a tela Promoções</h2>
      <div className="space-y-4">
          <section>
            <h3 className="mb-2 font-medium text-fg-strong">Objetivo</h3>
            <p>
              Lista promoções do Mercado Livre por anúncio (ativas e possíveis/convites), com taxa ML, frete Líder,
              impostos e lucro estimado a partir do cache gravado no banco.
            </p>
          </section>
          <section>
            <h3 className="mb-2 font-medium text-fg-strong">Dados e atualização</h3>
            <ul className="list-inside list-disc space-y-1">
              <li>
                A tabela lê <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">promotions_cache_rows</code>.
                Clique em <strong>Recarregar Promoções</strong> para buscar no Mercado Livre, recalcular e gravar{" "}
                <strong>todos os anúncios</strong> que entram na lista atual (busca + vínculo), em todas as páginas — pode levar vários minutos em catálogos grandes.
              </li>
              <li>
                <strong>Preço</strong> = <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">original_price</code> de cada promoção em seller-promotions/items (preço sem desconto).
                <strong> Preço promoção</strong> = com faixa min/máx/sugerido do ML, usa <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">max_discounted_price</code>; senão <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">price</code> ou <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">suggested_discounted_price</code>. Mín. e sugerido aparecem na coluna Promoção.
              </li>
              <li>
                <strong>Valor bruto</strong> é o <strong>Preço promoção</strong>. <strong>Taxa ML</strong> = comissão bruta; <strong>Subsídio ML</strong> = abatimento do Mercado Livre (ex. SMART). <strong>Vai receber</strong> = bruto − taxa ML − frete + subsídio ML. <strong>Lucro</strong> = Vai receber − custo − imposto − taxa extra − desp. fixas.
              </li>
            </ul>
          </section>
          <section>
            <h3 className="mb-2 font-medium text-fg-strong">Filtros</h3>
            <ul className="list-inside list-disc space-y-1">
              <li>
                <strong>Vínculo MLB → produto:</strong> igual à tela Preços (vinculado ou não ao cadastro).
              </li>
              <li>
                <strong>Tipo:</strong> promoção <strong>Ativa</strong> no ML ou <strong>Possível</strong> (convite/candidata).
              </li>
              <li>
                <strong>Lucratividade:</strong> faixas sobre o lucro % (com custo cadastrado), como na Calculadora de Preços: &gt;20%, 10–20%,
                0–10%, prejuízo.
              </li>
              <li>
                <strong>Campanha ML (tipo):</strong> filtra pelo código da campanha no Mercado Livre (<code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">type</code> em seller-promotions), por exemplo DEAL, SMART ou SELLER_CAMPAIGN. Linhas antigas no cache sem esse campo só aparecem após clicar em <strong>Recarregar Promoções</strong>.
              </li>
              <li>
                <strong>Prazo da campanha:</strong> usa início e fim quando o ML enviar datas; filtre por <em>em vigência</em>, <em>futura</em>, <em>encerrada</em> ou <em>sem datas</em>.
              </li>
              <li>
                <strong>PMA ≤ preço promoção:</strong> mostra só linhas em que o PMA cadastrado no produto vinculado é menor ou igual ao preço promoção (ambos &gt; 0). O PMA vem da tela Produtos; sem vínculo MLB → produto a coluna fica vazia e a linha não entra neste filtro.
              </li>
            </ul>
          </section>
          <section>
            <h3 className="mb-2 font-medium text-fg-strong">Colunas principais</h3>
            <ul className="list-inside list-disc space-y-1">
              <li>
                <strong>MLB:</strong> clique para copiar o código do anúncio.
              </li>
              <li>
                <strong>Campanha ML:</strong> nome amigável do tipo de campanha no ML (código <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">type</code> em seller-promotions).
              </li>
              <li>
                <strong>Aviso:</strong> ícone de exclamação quando houve atualização recente do ML (passe o mouse para ver detalhes).
              </li>
              <li>
                <strong>Participar:</strong> marque convites (<em>Possível</em>) e use <strong>Participar na promoção</strong> para aceitar no Mercado Livre (API seller-promotions).
              </li>
              <li>
                <strong>Campanhas:</strong> abas equivalentes ao painel do ML (Sugeridas, Eventos comerciais, Menos tarifas, Oferta do dia e relâmpago, Meios de pagamento, Criadas por você). Dentro de cada aba, escolha a <strong>campanha</strong> no seletor para ver anúncios e aceitar convites em lote. O <strong>Desconto no PIX</strong> fica em <em>Meios de pagamento</em> (tipo BANK no ML).
              </li>
              <li>
                <strong>Taxa ML / Subsídio ML / Frete:</strong> taxa bruta e subsídio em colunas separadas; o subsídio entra somado em Vai receber.
              </li>
              <li>
                <strong>ML:</strong> link para o anúncio no site do Mercado Livre.
              </li>
              <li>
                <strong>Início / Fim:</strong> janela da campanha retornada pela API (horário de São Paulo na tabela).
              </li>
            </ul>
          </section>
      </div>
    </div>
  );
}

interface MLAccount {
  id: string;
  ml_nickname: string | null;
  ml_user_id: number;
}

interface PromoAlert {
  id: string;
  created_at: string;
  item_id: string | null;
  topic: string;
  promotion_type: string | null;
  status_label: string | null;
  fetch_error: string | null;
  external_id: string | null;
  promotion_id: string | null;
}

/** Uma linha na grade = uma promoção persistida em `promotions_cache_rows`. */
interface FlatPromoRow {
  item_id: string;
  title: string | null;
  status: string | null;
  thumbnail: string | null;
  permalink: string | null;
  active_price: number | null;
  promotions_api_failed: boolean;
  promotionKind: "ativa" | "possível" | "—";
  promotionLabel: string;
  /** Código `type` da API seller-promotions (ex.: DEAL). */
  promotionType: string | null;
  promo_price: number | null;
  value_hint: string | null;
  rowKey: string;
  listing_type_id: string | null;
  category_id: string | null;
  cost_price: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  tax_percent: number | null;
  extra_fee_percent: number | null;
  fixed_expenses: number | null;
  pricing: FullPricingBreakdown | null;
  profit: number | null;
  profit_percent: number | null;
  campaign_start_at: string | null;
  campaign_finish_at: string | null;
  /** `id` da promoção no ML (P-MLB…, etc.). */
  ml_promotion_id: string | null;
  /** PMA (R$) do produto vinculado ao anúncio. */
  pma: number | null;
}

function promoRowSelectionKey(r: FlatPromoRow): string {
  return r.rowKey ?? r.item_id;
}

function canJoinPromoRow(r: FlatPromoRow): boolean {
  return (
    r.promotionKind === "possível" &&
    Boolean(r.ml_promotion_id?.trim()) &&
    Boolean(r.promotionType?.trim())
  );
}

function formatPromoAlertTooltip(alert: PromoAlert): string {
  const lines = ["Atualização do Mercado Livre"];
  lines.push(
    new Date(alert.created_at).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "short",
    })
  );
  if (alert.promotion_type) lines.push(`Tipo: ${alert.promotion_type}`);
  if (alert.status_label) lines.push(`Status: ${alert.status_label}`);
  if (alert.topic) lines.push(`Tópico: ${alert.topic}`);
  if (alert.external_id) lines.push(`ID: ${alert.external_id}`);
  if (alert.fetch_error) lines.push(`Erro ao resolver: ${alert.fetch_error}`);
  return lines.join("\n");
}

function PromoAlertIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 8a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

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

/** Larguras mínimas (colgroup + sticky `left`) — mesma ideia da Calculadora de Preços */
const PROMOCOES_COLUMNS: { minWidth: number }[] = [
  { minWidth: 44 },
  { minWidth: 48 },
  { minWidth: 52 },
  { minWidth: 100 },
  { minWidth: 220 },
  { minWidth: 88 },
  { minWidth: 90 },
  { minWidth: 100 },
  { minWidth: 72 },
  { minWidth: 80 },
  { minWidth: 88 },
  { minWidth: 140 },
  { minWidth: 200 },
  { minWidth: 95 },
  { minWidth: 95 },
  { minWidth: 72 },
  { minWidth: 72 },
  { minWidth: 72 },
  { minWidth: 72 },
  { minWidth: 80 },
  { minWidth: 88 },
  { minWidth: 88 },
  { minWidth: 110 },
  { minWidth: 110 },
  { minWidth: 72 },
];

const PROMOCOES_STICKY_STORAGE_KEY = "escalapreco.promocoes.pinnedColumns.v1";

function readPromocoesStickyInitial(): Set<number> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(PROMOCOES_STICKY_STORAGE_KEY);
    if (!raw) return new Set([0, 1, 2, 3, 4]);
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set([0, 1, 2, 3, 4]);
    const n = PROMOCOES_COLUMNS.length;
    const nums = arr.filter(
      (x): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x < n
    );
    return nums.length > 0 ? new Set(nums) : new Set([0, 1, 2, 3, 4]);
  } catch {
    return new Set([0, 1, 2, 3, 4]);
  }
}

function PromocoesContent() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const [accounts, setAccounts] = useState<MLAccount[]>([]);
  /** Filtro aplicado: refletido na URL como `q` (título ou MLB). */
  const qFromUrl = searchParams.get("q")?.trim() ?? "";
  const linkFromUrl = useMemo(() => linkFilterFromSearchParams(searchParams), [searchParams]);
  const kindFromUrl = useMemo(() => kindFilterFromSearchParams(searchParams), [searchParams]);
  const profitFromUrl = useMemo(() => profitFilterFromSearchParams(searchParams), [searchParams]);
  const ptypeFromUrl = useMemo(() => ptypeFilterFromSearchParams(searchParams), [searchParams]);
  const campFromUrl = useMemo(() => campFilterFromSearchParams(searchParams), [searchParams]);
  const pmaLtePromoFromUrl = useMemo(() => pmaLtePromoFilterFromSearchParams(searchParams), [searchParams]);
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);
  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false);
  const optionsMenuRef = useRef<HTMLDivElement>(null);
  const [promoTab, setPromoTab] = useState<"lista" | "campanhas" | "como-funciona">("lista");
  const [draftSearch, setDraftSearch] = useState(qFromUrl);
  const [draftLinkFilter, setDraftLinkFilter] = useState<PromoLinkFilter>("all");
  const [draftKindFilter, setDraftKindFilter] = useState<PromoKindFilter>("");
  const [draftProfitFilter, setDraftProfitFilter] = useState<PromoProfitFilter>("");
  const [draftPtypeFilter, setDraftPtypeFilter] = useState("");
  const [draftCampFilter, setDraftCampFilter] = useState<PromoCampaignPhase>("");
  const [draftPmaLtePromo, setDraftPmaLtePromo] = useState(false);
  const [page, setPage] = useState(1);
  const [flatRows, setFlatRows] = useState<FlatPromoRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(12);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshJobId, setRefreshJobId] = useState<string | null>(null);
  const [refreshJobProgress, setRefreshJobProgress] = useState<{ processed: number; total: number } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<PromoAlert[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [snapshotInfoOpen, setSnapshotInfoOpen] = useState(false);
  const snapshotInfoRef = useRef<HTMLDivElement>(null);
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [joining, setJoining] = useState(false);
  const [joinFeedback, setJoinFeedback] = useState<string | null>(null);
  const loadPromoGen = useRef(0);

  const [stickyColumns, setStickyColumns] = useState<Set<number>>(() => new Set());
  const [stickyHydrated, setStickyHydrated] = useState(false);
  const [headerMenuColumn, setHeaderMenuColumn] = useState<number | null>(null);

  const { stickyHeaderStyles, stickyBodyStyles } = useMemo(() => {
    const head: (CSSProperties | undefined)[] = Array.from(
      { length: PROMOCOES_COLUMNS.length },
      () => undefined
    );
    const body: (CSSProperties | undefined)[] = Array.from(
      { length: PROMOCOES_COLUMNS.length },
      () => undefined
    );
    let left = 0;
    let order = 0;
    for (let i = 0; i < PROMOCOES_COLUMNS.length; i++) {
      if (stickyColumns.has(i)) {
        const w = PROMOCOES_COLUMNS[i].minWidth;
        const base = { position: "sticky" as const, left, boxSizing: "border-box" as const };
        head[i] = { ...base, zIndex: 30 + order };
        body[i] = { ...base, zIndex: 2 + order };
        left += w;
        order++;
      }
    }
    return { stickyHeaderStyles: head, stickyBodyStyles: body };
  }, [stickyColumns]);

  const toggleStickyColumn = useCallback((colIndex: number) => {
    setStickyColumns((prev) => {
      const next = new Set(prev);
      if (next.has(colIndex)) next.delete(colIndex);
      else next.add(colIndex);
      return next;
    });
    setHeaderMenuColumn(null);
  }, []);

  useEffect(() => {
    setStickyColumns(readPromocoesStickyInitial());
    setStickyHydrated(true);
  }, []);

  useEffect(() => {
    if (!stickyHydrated) return;
    try {
      localStorage.setItem(
        PROMOCOES_STICKY_STORAGE_KEY,
        JSON.stringify(Array.from(stickyColumns).sort((a, b) => a - b))
      );
    } catch {
      /* ignore */
    }
  }, [stickyColumns, stickyHydrated]);

  useEffect(() => {
    if (headerMenuColumn === null) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      const roots =
        typeof document !== "undefined"
          ? document.querySelectorAll("[data-promocoes-th-menu-root]")
          : null;
      if (roots) {
        for (let i = 0; i < roots.length; i++) {
          if (roots[i].contains(t)) return;
        }
      }
      setHeaderMenuColumn(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [headerMenuColumn]);

  useEffect(() => {
    if (!optionsMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = optionsMenuRef.current;
      if (el && !el.contains(e.target as Node)) setOptionsMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [optionsMenuOpen]);

  useEffect(() => {
    if (!snapshotInfoOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = snapshotInfoRef.current;
      if (el && !el.contains(e.target as Node)) setSnapshotInfoOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [snapshotInfoOpen]);

  const accountId = useMemo(() => {
    if (accounts.length === 0) return "";
    const fromUrl = searchParams.get("accountId")?.trim();
    if (fromUrl && accounts.some((a) => a.id === fromUrl)) return fromUrl;
    if (typeof window !== "undefined") {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s && accounts.some((a) => a.id === s)) return s;
    }
    return accounts[0].id;
  }, [accounts, searchParams]);

  const prevFilterKeyRef = useRef<string>("");
  useEffect(() => {
    const key = `${qFromUrl}\0${linkFromUrl}\0${kindFromUrl}\0${profitFromUrl}\0${ptypeFromUrl}\0${campFromUrl}\0${pmaLtePromoFromUrl ? "1" : "0"}`;
    if (prevFilterKeyRef.current === key) return;
    prevFilterKeyRef.current = key;
    setDraftSearch(qFromUrl);
    setDraftLinkFilter(linkFromUrl);
    setDraftKindFilter(kindFromUrl);
    setDraftProfitFilter(profitFromUrl);
    setDraftPtypeFilter(ptypeFromUrl);
    setDraftCampFilter(campFromUrl);
    setDraftPmaLtePromo(pmaLtePromoFromUrl);
    setPage(1);
  }, [qFromUrl, linkFromUrl, kindFromUrl, profitFromUrl, ptypeFromUrl, campFromUrl, pmaLtePromoFromUrl]);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/mercadolivre/accounts");
      if (!res.ok) return;
      const data = await res.json();
      const list = (data.accounts ?? []) as MLAccount[];
      setAccounts(list);
    } finally {
      setAccountsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

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
      /* ignore */
    }
  }, []);

  const loadData = useCallback(async (options?: { silent?: boolean }) => {
    if (!accountId) return;
    const gen = ++loadPromoGen.current;
    const silent = options?.silent === true;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (qFromUrl) params.set("search", qFromUrl);
      if (linkFromUrl === "linked") params.set("linked", "1");
      else if (linkFromUrl === "unlinked") params.set("linked", "0");
      if (kindFromUrl) params.set("kind", kindFromUrl);
      if (profitFromUrl) params.set("profit", profitFromUrl);
      if (ptypeFromUrl) params.set("ptype", ptypeFromUrl);
      if (campFromUrl) params.set("camp", campFromUrl);
      if (pmaLtePromoFromUrl) params.set("pmaok", "1");
      const [overviewRes, alertsRes] = await Promise.all([
        fetch(`/api/mercadolivre/${accountId}/promotions-overview?${params}`),
        fetch(`/api/mercadolivre/promotion-alerts?accountId=${encodeURIComponent(accountId)}&hours=72`),
      ]);
      const overviewData = await overviewRes.json().catch(() => ({}));
      if (gen !== loadPromoGen.current) return;
      if (!overviewRes.ok) {
        setError((overviewData as { error?: string }).error || "Erro ao carregar promoções.");
        setFlatRows([]);
        setTotal(0);
        setSnapshotAt(null);
        return;
      }
      const data = overviewData as {
        rows?: FlatPromoRow[];
        total?: number;
        page_size?: number;
        snapshot_at?: string | null;
      };
      setFlatRows(Array.isArray(data.rows) ? data.rows : []);
      setTotal(data.total ?? 0);
      setPageSize(data.page_size ?? 12);
      setSnapshotAt(data.snapshot_at ?? null);

      const alertsData = await alertsRes.json().catch(() => ({}));
      if (gen !== loadPromoGen.current) return;
      if (alertsRes.ok) {
        setAlerts((alertsData as { alerts?: PromoAlert[] }).alerts ?? []);
      } else {
        setAlerts([]);
      }
    } catch {
      if (gen !== loadPromoGen.current) return;
      setError("Erro de conexão.");
      setFlatRows([]);
      setSnapshotAt(null);
    } finally {
      if (gen === loadPromoGen.current && !silent) setLoading(false);
    }
  }, [accountId, page, qFromUrl, linkFromUrl, kindFromUrl, profitFromUrl, ptypeFromUrl, campFromUrl, pmaLtePromoFromUrl]);

  /** Recarrega snapshot do cache a cada 60s (dados já atualizados por webhook/join no servidor). */
  useEffect(() => {
    if (!accountId || refreshing || refreshJobId) return;
    const interval = setInterval(() => {
      void loadData({ silent: true });
    }, 60_000);
    return () => clearInterval(interval);
  }, [accountId, refreshing, refreshJobId, loadData]);

  useEffect(() => {
    if (!accountId) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void loadData({ silent: true });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [accountId, loadData]);

  const pollRefreshJob = useCallback(
    async (jobId: string) => {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) return;
      const data = (await res.json().catch(() => ({}))) as {
        job?: { status?: string; processed?: number; total?: number };
        logs?: { status?: string; message?: string | null }[];
      };
      const job = data.job;
      if (job?.total != null && job.total > 0) {
        setRefreshJobProgress({ processed: job.processed ?? 0, total: job.total });
      }
      const status = job?.status ?? "";
      if (["success", "failed", "partial"].includes(status)) {
        setRefreshJobId(null);
        setRefreshJobProgress(null);
        setRefreshing(false);
        if (status === "success" || status === "partial") {
          await loadData();
          return;
        }
        const lastErr = [...(data.logs ?? [])].reverse().find((l) => l.status === "error");
        setError(lastErr?.message?.trim() || "Erro ao atualizar promoções.");
      }
    },
    [loadData]
  );

  useEffect(() => {
    if (!refreshJobId) return;
    void pollRefreshJob(refreshJobId);
    const interval = setInterval(() => void pollRefreshJob(refreshJobId), 2500);
    return () => clearInterval(interval);
  }, [refreshJobId, pollRefreshJob]);

  const refreshFromMl = useCallback(async () => {
    if (!accountId) return;
    setRefreshing(true);
    setRefreshJobProgress(null);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (qFromUrl) params.set("search", qFromUrl);
      if (linkFromUrl === "linked") params.set("linked", "1");
      else if (linkFromUrl === "unlinked") params.set("linked", "0");
      const res = await fetch(`/api/mercadolivre/${accountId}/promotions-overview?${params}`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        job_id?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        if (res.status === 504) {
          setError(
            "O servidor encerrou a conexão por tempo (504). Tente novamente; se persistir, confira os logs do servidor."
          );
        } else {
          setError(data.error || "Erro ao iniciar atualização de promoções.");
        }
        setRefreshing(false);
        return;
      }
      if (data.job_id) {
        setRefreshJobId(data.job_id);
        return;
      }
      await loadData();
      setRefreshing(false);
    } catch {
      setError("Erro de conexão ao atualizar.");
      setRefreshing(false);
    }
  }, [accountId, page, qFromUrl, linkFromUrl, loadData]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setSelectedRowKeys(new Set());
    setJoinFeedback(null);
  }, [page, accountId, qFromUrl, linkFromUrl, kindFromUrl, profitFromUrl, ptypeFromUrl, campFromUrl, pmaLtePromoFromUrl]);

  const handleFilterSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      setPage(1);
      const q = draftSearch.trim();
      const params = new URLSearchParams(searchParams.toString());
      params.set("accountId", accountId);
      if (q) params.set("q", q);
      else params.delete("q");
      if (draftLinkFilter === "linked") params.set("linked", "1");
      else if (draftLinkFilter === "unlinked") params.set("linked", "0");
      else params.delete("linked");
      if (draftKindFilter) params.set("kind", draftKindFilter);
      else params.delete("kind");
      if (draftProfitFilter) params.set("profit", draftProfitFilter);
      else params.delete("profit");
      if (draftPtypeFilter) params.set("ptype", draftPtypeFilter);
      else params.delete("ptype");
      if (draftCampFilter) params.set("camp", draftCampFilter);
      else params.delete("camp");
      if (draftPmaLtePromo) params.set("pmaok", "1");
      else params.delete("pmaok");
      params.delete("pma_lte");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      setFiltersModalOpen(false);
    },
    [
      draftSearch,
      draftLinkFilter,
      draftKindFilter,
      draftProfitFilter,
      draftPtypeFilter,
      draftCampFilter,
      draftPmaLtePromo,
      accountId,
      pathname,
      router,
      searchParams,
    ]
  );

  const clearFilters = useCallback(() => {
    setDraftSearch("");
    setDraftLinkFilter("all");
    setDraftKindFilter("");
    setDraftProfitFilter("");
    setDraftPtypeFilter("");
    setDraftCampFilter("");
    setDraftPmaLtePromo(false);
    setPage(1);
    const params = new URLSearchParams(searchParams.toString());
    params.set("accountId", accountId);
    params.delete("q");
    params.delete("linked");
    params.delete("kind");
    params.delete("profit");
    params.delete("ptype");
    params.delete("camp");
    params.delete("pmaok");
    params.delete("pma_lte");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    setFiltersModalOpen(false);
  }, [accountId, pathname, router, searchParams]);

  const showFilterResetButton = Boolean(
    draftSearch.trim() ||
      qFromUrl ||
      draftLinkFilter !== "all" ||
      linkFromUrl !== "all" ||
      draftKindFilter ||
      kindFromUrl ||
      draftProfitFilter ||
      profitFromUrl ||
      draftPtypeFilter ||
      ptypeFromUrl ||
      draftCampFilter ||
      campFromUrl ||
      draftPmaLtePromo ||
      pmaLtePromoFromUrl
  );

  const appliedPromoFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if (qFromUrl) {
      const short = qFromUrl.length > 48 ? `${qFromUrl.slice(0, 48)}…` : qFromUrl;
      labels.push(`Busca: ${short}`);
    }
    if (linkFromUrl === "linked") labels.push("Vínculo: só vinculados");
    if (linkFromUrl === "unlinked") labels.push("Vínculo: só não vinculados");
    if (kindFromUrl === "ativa") labels.push("Tipo: ativa");
    if (kindFromUrl === "possível") labels.push("Tipo: possível");
    if (profitFromUrl === "high") labels.push("Lucro: > 20%");
    if (profitFromUrl === "medium") labels.push("Lucro: 10–20%");
    if (profitFromUrl === "low") labels.push("Lucro: 0–10%");
    if (profitFromUrl === "negative") labels.push("Lucro: prejuízo");
    if (ptypeFromUrl) {
      labels.push(`Campanha ML: ${labelForMlPromotionType(ptypeFromUrl) ?? ptypeFromUrl}`);
    }
    if (campFromUrl === "in") labels.push("Prazo: em vigência");
    if (campFromUrl === "future") labels.push("Prazo: futura");
    if (campFromUrl === "past") labels.push("Prazo: encerrada");
    if (campFromUrl === "nodates") labels.push("Prazo: sem datas");
    if (pmaLtePromoFromUrl) labels.push("PMA ≤ preço promoção");
    return labels;
  }, [qFromUrl, linkFromUrl, kindFromUrl, profitFromUrl, ptypeFromUrl, campFromUrl, pmaLtePromoFromUrl]);

  const alertByItem = useMemo(() => {
    const m = new Map<string, PromoAlert>();
    for (const a of alerts) {
      if (!a.item_id) continue;
      const key = String(a.item_id).trim().toUpperCase();
      if (!m.has(key)) m.set(key, a);
    }
    return m;
  }, [alerts]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);

  const loaderMessagesRefresh = useMemo(() => {
    const base = [
      "Sincronizando todos os anúncios desta lista com o Mercado Livre (pode levar vários minutos)…",
      "Cada anúncio chama a API de preços e seller-promotions…",
      "Calculando taxas e gravando o cache para todas as páginas…",
    ];
    if (refreshJobProgress && refreshJobProgress.total > 0) {
      const { processed, total } = refreshJobProgress;
      return [
        `Página ${processed} de ${total} processada(s)…`,
        ...base,
      ];
    }
    return base;
  }, [refreshJobProgress]);

  const loaderMessagesLoad = [
    "Carregando cache de promoções…",
    "Lendo linhas salvas no banco…",
  ] as const;

  const loaderMessages = refreshing ? [...loaderMessagesRefresh] : [...loaderMessagesLoad];

  const safeFlatRows = Array.isArray(flatRows) ? flatRows : [];

  const joinableRowsOnPage = useMemo(
    () => safeFlatRows.filter(canJoinPromoRow),
    [safeFlatRows]
  );

  const selectedJoinableCount = useMemo(() => {
    let n = 0;
    for (const r of joinableRowsOnPage) {
      if (selectedRowKeys.has(promoRowSelectionKey(r))) n++;
    }
    return n;
  }, [joinableRowsOnPage, selectedRowKeys]);

  const handleToggleSelectAllJoinable = useCallback(() => {
    setSelectedRowKeys((prev) => {
      const allSelected =
        joinableRowsOnPage.length > 0 &&
        joinableRowsOnPage.every((r) => prev.has(promoRowSelectionKey(r)));
      if (allSelected) return new Set();
      return new Set(joinableRowsOnPage.map(promoRowSelectionKey));
    });
  }, [joinableRowsOnPage]);

  const handleToggleRowSelect = useCallback((row: FlatPromoRow) => {
    if (!canJoinPromoRow(row)) return;
    const key = promoRowSelectionKey(row);
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleJoinSelected = useCallback(async () => {
    if (!accountId || selectedJoinableCount === 0) return;
    const items = joinableRowsOnPage
      .filter((r) => selectedRowKeys.has(promoRowSelectionKey(r)))
      .map((r) => ({
        item_id: r.item_id,
        promotion_id: r.ml_promotion_id!,
        promotion_type: r.promotionType!,
        deal_price: r.promo_price,
      }));

    setJoining(true);
    setJoinFeedback(null);
    setError(null);
    try {
      const res = await fetch(`/api/mercadolivre/${accountId}/promotions-join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        summary?: { ok?: number; errors?: number; requested?: number };
        results?: Array<{ item_id: string; status: string; error?: string }>;
      };
      if (!res.ok) {
        setError(data.error || "Erro ao participar das promoções.");
        return;
      }
      const ok = data.summary?.ok ?? 0;
      const errs = data.summary?.errors ?? 0;
      if (errs === 0) {
        setJoinFeedback(
          ok === 1 ? "1 promoção aceita no Mercado Livre." : `${ok} promoções aceitas no Mercado Livre.`
        );
      } else {
        const firstErr = data.results?.find((r) => r.status === "error");
        setJoinFeedback(
          `${ok} aceita(s), ${errs} com erro${firstErr?.error ? `: ${firstErr.error}` : ""}.`
        );
      }
      setSelectedRowKeys(new Set());
      await loadData();
    } catch {
      setError("Erro de conexão ao participar das promoções.");
    } finally {
      setJoining(false);
    }
  }, [accountId, selectedJoinableCount, joinableRowsOnPage, selectedRowKeys, loadData]);

  const snapshotAtFormatted = useMemo(() => {
    if (!snapshotAt) return "";
    return new Date(snapshotAt).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "short",
    });
  }, [snapshotAt]);

  const cacheEmptyHint =
    !loading && !error && total > 0 && safeFlatRows.length === 0 && !snapshotAt;

  const renderPromoHeaderMenu = (colIndex: number) => {
    if (headerMenuColumn !== colIndex) return null;
    return (
      <div className="btn-dropdown-menu left-1 top-full z-50 mt-1 w-48 shadow-xl">
        <button type="button" onClick={() => toggleStickyColumn(colIndex)} className="btn-dropdown-item">
          {stickyColumns.has(colIndex) ? "Descongelar coluna" : "Congelar coluna"}
        </button>
      </div>
    );
  };

  const promoStickyTh = (
    colIndex: number,
    label: ReactNode,
    opts?: { align?: "left" | "right"; title?: string; thClass?: string }
  ) => {
    const align = opts?.align ?? "left";
    const textAlign = align === "right" ? "text-right" : "text-left";
    const btnJustify = align === "right" ? "justify-end" : "justify-between";
    return (
      <th
        data-promocoes-th-menu-root
        className={`relative select-none p-2 text-xs font-semibold uppercase tracking-wide text-white/90 ${textAlign} ${stickyColumns.has(colIndex) ? "sticky-col" : ""} ${opts?.thClass ?? ""}`}
        title={opts?.title}
        style={stickyHeaderStyles[colIndex]}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setHeaderMenuColumn((c) => (c === colIndex ? null : colIndex));
          }}
          className={`inline-flex w-full min-w-0 items-center gap-1 rounded-sm hover:bg-white/10 ${btnJustify}`}
          aria-expanded={headerMenuColumn === colIndex}
        >
          <span className={`min-w-0 truncate ${align === "right" ? "text-right" : "text-left"}`}>{label}</span>
          <span className="shrink-0 text-[10px] leading-none text-white/65">▾</span>
        </button>
        {renderPromoHeaderMenu(colIndex)}
      </th>
    );
  };

  if (accountsLoaded && accounts.length === 0) {
    return (
      <div className="overflow-hidden rounded border border-amber-200 bg-amber-50 p-6 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/30">
        <p className="text-sm text-amber-900 dark:text-amber-200">
          Conecte sua conta do Mercado Livre em{" "}
          <a href="/app/configuracao" className="font-medium underline">
            Configuração
          </a>
          .
        </p>
      </div>
    );
  }

  if ((loading || !accountsLoaded) && safeFlatRows.length === 0 && !refreshing) {
    return (
      <div className="adminty-promocoes-page space-y-5">
        <div className="overflow-hidden rounded border border-slate-200/90 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <p className="text-sm text-slate-500 dark:text-slate-400">Carregando…</p>
        </div>
      </div>
    );
  }

  const promocoesRefetching = loading && safeFlatRows.length > 0;
  const loaderOpen = promoTab === "lista" && (refreshing || promocoesRefetching);

  return (
    <div className="adminty-promocoes-page space-y-5">
      <div className="overflow-hidden rounded border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <SmartLoaderOverlay open={loaderOpen} messages={[...loaderMessages]} />

        <div className="border-b border-slate-200 bg-white px-3 pt-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-wrap items-end gap-1">
            <button
              type="button"
              onClick={() => setPromoTab("lista")}
              className={
                promoTab === "lista"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }
            >
              Promoções
            </button>
            <button
              type="button"
              onClick={() => {
                setPromoTab("campanhas");
                const params = new URLSearchParams(searchParams.toString());
                if (!params.get("pcat")) {
                  params.set("pcat", "eventos");
                  router.replace(`${pathname}?${params.toString()}`, { scroll: false });
                }
              }}
              className={
                promoTab === "campanhas"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }
            >
              Campanhas
            </button>
            <button
              type="button"
              onClick={() => setPromoTab("como-funciona")}
              className={
                promoTab === "como-funciona"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }
            >
              Como funciona?
            </button>
          </div>
          {accounts.length > 1 && (
            <label className="mb-1 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <span className="whitespace-nowrap font-medium text-slate-700 dark:text-slate-200">Conta</span>
              <select
                value={accountId}
                onChange={(e) => {
                  const v = e.target.value;
                  if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, v);
                  const params = new URLSearchParams(searchParams.toString());
                  params.set("accountId", v);
                  router.replace(`${pathname}?${params.toString()}`, { scroll: false });
                }}
                className="h-8 min-w-[10rem] rounded border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ml_nickname || `Conta ${a.ml_user_id}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          </div>
        </div>

        {promoTab === "como-funciona" && (
          <div className="max-h-[min(70vh,720px)] overflow-y-auto border-b border-slate-100 bg-white px-4 py-4 dark:bg-slate-900/20">
            <PromocoesHelpContent />
          </div>
        )}

        {promoTab === "campanhas" && accountId && (
          <PromocoesCampanhasTab
            accountId={accountId}
            onOpenItemInLista={(itemId, promotionType) => {
              setPromoTab("lista");
              setPage(1);
              const params = new URLSearchParams(searchParams.toString());
              params.set("accountId", accountId);
              params.set("q", itemId);
              if (promotionType) params.set("ptype", promotionType);
              const pcat = searchParams.get("pcat");
              if (pcat) params.set("pcat", pcat);
              router.replace(`${pathname}?${params.toString()}`, { scroll: false });
            }}
          />
        )}

        {promoTab === "lista" && (
        <div>
        <div className="border-b border-slate-100 px-3 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleJoinSelected()}
              disabled={loading || refreshing || joining || selectedJoinableCount === 0}
              className="btn btn-primary btn-sm disabled:cursor-not-allowed"
              title="Aceita convites selecionados no Mercado Livre (promoções tipo Possível)"
            >
              {joining
                ? "Participando…"
                : selectedJoinableCount > 0
                  ? `Participar na promoção (${selectedJoinableCount})`
                  : "Participar na promoção"}
            </button>
            <button
              type="button"
              onClick={() => void refreshFromMl()}
              disabled={loading || refreshing || joining}
              className="btn btn-secondary btn-sm disabled:cursor-not-allowed"
            >
              {refreshing ? "Recarregando…" : "Recarregar Promoções"}
            </button>
            {accounts.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <span className="whitespace-nowrap font-medium text-slate-700 dark:text-slate-200">Conta</span>
                <select
                  value={accountId}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, v);
                    const params = new URLSearchParams(searchParams.toString());
                    params.set("accountId", v);
                    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
                  }}
                  className="h-8 min-w-[10rem] rounded border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.ml_nickname || `Conta ${a.ml_user_id}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[12px] text-slate-600">
            <span className="font-semibold text-slate-700">Filtros:</span>
            {appliedPromoFilterLabels.length > 0 ? (
              appliedPromoFilterLabels.map((label, idx) => (
                <span
                  key={`${idx}-${label}`}
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                >
                  {label}
                </span>
              ))
            ) : (
              <span className="text-slate-500">Nenhum filtro aplicado</span>
            )}
            {appliedPromoFilterLabels.length > 0 && (
              <button
                type="button"
                onClick={() => clearFilters()}
                className="text-[11px] font-semibold text-[#0d6efd] hover:underline"
              >
                Limpar
              </button>
            )}
          </div>
          <div className="btn-dropdown relative flex items-center gap-1" ref={optionsMenuRef}>
            <div className="relative" ref={snapshotInfoRef}>
              <button
                type="button"
                onClick={() => {
                  setOptionsMenuOpen(false);
                  setSnapshotInfoOpen((o) => !o);
                }}
                title={
                  snapshotAt
                    ? `Última sincronização ML: ${snapshotAtFormatted} (horário de São Paulo).`
                    : "Ainda não há snapshot no cache para estes filtros. Use Recarregar Promoções para buscar no ML e gravar os dados."
                }
                aria-label="Última sincronização com o Mercado Livre"
                aria-expanded={snapshotInfoOpen}
                className="btn btn-icon btn-sm btn-outline-secondary"
              >
                <ClockIcon />
              </button>
              {snapshotInfoOpen && (
                <div className="absolute right-0 top-9 z-30 w-72 rounded border border-slate-200 bg-white px-3 py-2 text-left text-[11px] leading-snug text-slate-700 shadow-lg dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                  {snapshotAt ? (
                    <>
                      <span className="font-semibold text-slate-800 dark:text-slate-100">Última sincronização ML</span>
                      {": "}
                      {snapshotAtFormatted}
                      <span className="text-slate-500"> (horário de São Paulo).</span>
                    </>
                  ) : (
                    <>
                      Ainda não há snapshot no cache para estes filtros. Use{" "}
                      <strong className="font-medium text-slate-800 dark:text-slate-100">Recarregar Promoções</strong>{" "}
                      para buscar no ML e gravar os dados.
                    </>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setSnapshotInfoOpen(false);
                setDraftSearch(qFromUrl);
                setDraftLinkFilter(linkFromUrl);
                setDraftKindFilter(kindFromUrl);
                setDraftProfitFilter(profitFromUrl);
                setDraftPtypeFilter(ptypeFromUrl);
                setDraftCampFilter(campFromUrl);
                setDraftPmaLtePromo(pmaLtePromoFromUrl);
                setFiltersModalOpen(true);
              }}
              className="btn btn-icon btn-sm btn-outline-secondary"
              title="Abrir filtros"
              aria-label="Abrir filtros"
            >
              <FilterIcon />
            </button>
            <button
              type="button"
              onClick={() => {
                setSnapshotInfoOpen(false);
                setOptionsMenuOpen((o) => !o);
              }}
              className="btn btn-icon btn-sm btn-outline-secondary"
              title="Opções"
              aria-label="Opções"
              aria-expanded={optionsMenuOpen}
            >
              <KebabMenuIcon />
            </button>
            {optionsMenuOpen && (
              <div className="btn-dropdown-menu right-0 top-9 z-20 w-52 dark:border-slate-600 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    void loadData();
                    setOptionsMenuOpen(false);
                  }}
                  className="btn-dropdown-item"
                >
                  Atualizar tabela
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOptionsMenuOpen(false);
                    void refreshFromMl();
                  }}
                  disabled={loading || refreshing}
                  className="btn-dropdown-item"
                >
                  Recarregar do ML…
                </button>
              </div>
            )}
          </div>
        </div>

      {cacheEmptyHint && (
        <div className="border-b border-sky-100 bg-sky-50 px-3 py-3 text-sm text-sky-950 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100">
          Não há linhas salvas no banco para esta página e filtros. Clique em <strong>Recarregar Promoções</strong> para
          consultar o Mercado Livre, gravar em <code className="rounded bg-sky-100/90 px-1 text-xs dark:bg-sky-900/50">promotions_cache_rows</code> e atualizar a tabela (pode levar
          um minuto).
        </div>
      )}

      {error && (
        <div className="border-b border-amber-100 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          {error}
          {(() => {
            const m = error.toLowerCase();
            const schemaHint =
              m.includes("does not exist") ||
              m.includes("não existe") ||
              m.includes("relation") ||
              m.includes("42p01") ||
              (m.includes("column") && (m.includes("not exist") || m.includes("does not")));
            if (!schemaHint) return null;
            return (
              <p className="mt-2 text-xs text-amber-800 dark:text-amber-300/90">
                Execute no Supabase as migrations{" "}
                <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/50">019_ml_promotion_webhook_alerts.sql</code>,{" "}
                <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/50">020_promotions_cache.sql</code>,{" "}
                <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/50">021_promotions_cache_link_filter.sql</code>,{" "}
                <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/50">022_promotions_cache_promotion_type.sql</code>,{" "}
                <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/50">023_promotions_cache_campaign_dates.sql</code> e{" "}
                <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/50">024_promotions_cache_ml_promotion_id.sql</code> e{" "}
                <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/50">025_promotions_cache_meli_fee_subsidy.sql</code>.
              </p>
            );
          })()}
        </div>
      )}

      {joinFeedback && !error && (
        <div className="border-b border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
          {joinFeedback}
        </div>
      )}

      <div className="pricing-table-with-sticky adminty-table-card">
        <div className="mb-1 flex min-h-8 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            <span className="font-medium text-slate-800 dark:text-slate-100">{safeFlatRows.length}</span>
            {" "}
            {safeFlatRows.length === 1 ? "promoção na página" : "promoções na página"}
            {" · total "}
            <span className="font-medium text-slate-800 dark:text-slate-100">{total}</span>
            <span className="text-slate-500"> · {pageSize} por página</span>
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {totalPages > 1 && (
              <>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">Página {page}/{totalPages}</span>
                <div className="inline-flex items-center gap-px rounded border border-slate-200 bg-white p-px text-[11px] shadow-sm dark:border-slate-600 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => setPage(1)}
                    disabled={page === 1 || loading || refreshing}
                    className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                    title="Primeira página"
                  >
                    «
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || loading || refreshing}
                    className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Anterior
                  </button>
                  <span className="min-w-[2ch] px-1.5 py-0.5 text-center font-semibold text-slate-800 dark:text-slate-100">
                    {page}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || loading || refreshing}
                    className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Próxima
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages || loading || refreshing}
                    className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
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
          className="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none"
          maxHeight="70vh"
          tableClassName="table-fixed w-max min-w-[max(100%,max-content)]"
        >
          <colgroup>
            {PROMOCOES_COLUMNS.map((c, i) => (
              <col key={i} style={{ width: c.minWidth }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              <th
                data-promocoes-th-menu-root
                className={`relative p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/90 ${stickyColumns.has(0) ? "sticky-col" : ""}`}
                style={stickyHeaderStyles[0]}
                title="Selecionar convites (tipo Possível) para participar"
              >
                <div className="flex items-center justify-between gap-1">
                  <input
                    type="checkbox"
                    className="rounded border-white/40 bg-white/10"
                    checked={
                      joinableRowsOnPage.length > 0 &&
                      joinableRowsOnPage.every((r) => selectedRowKeys.has(promoRowSelectionKey(r)))
                    }
                    disabled={joinableRowsOnPage.length === 0 || joining}
                    onChange={handleToggleSelectAllJoinable}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Selecionar todos os convites desta página"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setHeaderMenuColumn((c) => (c === 0 ? null : 0));
                    }}
                    className="inline-flex shrink-0 items-center rounded-sm px-0.5 hover:bg-white/10"
                    aria-expanded={headerMenuColumn === 0}
                    title="Opções da coluna"
                  >
                    <span className="text-[10px] leading-none text-white/65">▾</span>
                  </button>
                </div>
                {renderPromoHeaderMenu(0)}
              </th>
              {promoStickyTh(1, "Aviso")}
              {promoStickyTh(2, "Foto")}
              {promoStickyTh(3, "MLB")}
              {promoStickyTh(4, "Anúncio", { thClass: "min-w-[12rem]" })}
              {promoStickyTh(5, "Status")}
              {promoStickyTh(6, "Preço", { align: "right" })}
              {promoStickyTh(7, "Preço promoção", { align: "right" })}
              {promoStickyTh(8, "PMA", {
                align: "right",
                title: "Preço Mínimo Anunciado (R$) do produto vinculado ao anúncio",
              })}
              {promoStickyTh(9, "Custo", { align: "right" })}
              {promoStickyTh(10, "Tipo")}
              {promoStickyTh(11, "Campanha ML", {
                title: "Tipo de campanha no ML (campo type em seller-promotions)",
                thClass: "max-w-[14rem]",
              })}
              {promoStickyTh(12, "Promoção", { thClass: "min-w-[12rem]" })}
              {promoStickyTh(13, "Vai receber", {
                align: "right",
                title: "Preço promoção − taxa ML − frete + subsídio ML",
              })}
              {promoStickyTh(14, "Lucro R$", { align: "right" })}
              {promoStickyTh(15, "Lucro %", { align: "right" })}
              {promoStickyTh(16, "Taxa ML", {
                align: "right",
                title: "Comissão ML bruta (antes do subsídio)",
              })}
              {promoStickyTh(17, "Subsídio ML", {
                align: "right",
                title: "Abatimento do Mercado Livre na comissão (original_price × meli_percentage / 100)",
              })}
              {promoStickyTh(18, "Frete", { align: "right" })}
              {promoStickyTh(19, "Imposto", { align: "right" })}
              {promoStickyTh(20, "Taxa extra", { align: "right" })}
              {promoStickyTh(21, "Desp. fixas", { align: "right" })}
              {promoStickyTh(22, "Início campanha", {
                title: "Início da campanha (seller-promotions), horário de São Paulo",
                thClass: "whitespace-nowrap",
              })}
              {promoStickyTh(23, "Fim campanha", {
                title: "Fim da campanha (seller-promotions), horário de São Paulo",
                thClass: "whitespace-nowrap",
              })}
              {promoStickyTh(24, "ML")}
            </tr>
          </thead>
        <tbody>
            {safeFlatRows.map((r) => {
              const calc = r.pricing;
              const profit = r.profit;
              const profitPercent =
                typeof r.profit_percent === "number" && Number.isFinite(r.profit_percent)
                  ? r.profit_percent
                  : null;
              const alert = alertByItem.get(String(r.item_id).trim().toUpperCase());
              const tipoBadge =
                r.promotionKind === "ativa"
                  ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
                  : r.promotionKind === "possível"
                    ? "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
              const tipoLabel =
                r.promotionKind === "ativa" ? "Ativa" : r.promotionKind === "possível" ? "Possível" : "—";
              const joinable = canJoinPromoRow(r);
              const isSelected = selectedRowKeys.has(promoRowSelectionKey(r));
              const cell = (col: number, cls: string) => ({
                className: `${cls}${stickyColumns.has(col) ? " sticky-col" : ""}`,
                style: stickyBodyStyles[col],
              });
              return (
                <tr
                  key={r.rowKey ?? r.item_id}
                  className={
                    alert
                      ? "border-b border-slate-100 bg-amber-50/90 hover:bg-primary/5 dark:border-slate-700 dark:bg-amber-950/25 dark:hover:bg-primary/10"
                      : "border-b border-slate-100 bg-white/50 hover:bg-primary/5 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:bg-primary/10"
                  }
                >
                  <td {...cell(0, "p-2 text-center")}>
                    {joinable ? (
                      <input
                        type="checkbox"
                        className="rounded border-slate-300"
                        checked={isSelected}
                        disabled={joining}
                        onChange={() => handleToggleRowSelect(r)}
                        aria-label={`Selecionar ${r.item_id} para participar`}
                      />
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                  <td {...cell(1, "align-top p-2 text-center")}>
                    {alert ? (
                      <span
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200"
                        title={formatPromoAlertTooltip(alert)}
                        aria-label="Atualização recente do Mercado Livre"
                      >
                        <PromoAlertIcon className="h-4 w-4" />
                      </span>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                  <td {...cell(2, "p-2")}>
                    {r.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- URLs dinâmicas do CDN do ML
                      <img
                        src={r.thumbnail.replace(/^http:/, "https:")}
                        alt=""
                        className="h-10 w-10 rounded-lg border border-slate-100 bg-slate-50 object-contain"
                      />
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td {...cell(3, "p-2")}>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        handleCopyToClipboard(String(r.item_id), `mlb-${r.rowKey ?? String(r.item_id)}`)
                      }
                      onKeyDown={(e) =>
                        e.key === "Enter" &&
                        handleCopyToClipboard(String(r.item_id), `mlb-${r.rowKey ?? String(r.item_id)}`)
                      }
                      title="Clique para copiar"
                      className="cursor-pointer select-none rounded-md bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100"
                    >
                      {copiedCell === `mlb-${r.rowKey ?? String(r.item_id)}` ? (
                        <span className="text-xs font-semibold text-emerald-600">Copiado!</span>
                      ) : (
                        r.item_id
                      )}
                    </span>
                  </td>
                  <td {...cell(4, "max-w-[14rem] p-2")} title={r.title ?? ""}>
                    <span className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-50">
                      {r.title || "—"}
                    </span>
                    {r.promotions_api_failed && (r.rowKey ?? "").includes("||empty") && (
                      <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                        Não foi possível ler seller-promotions para este anúncio.
                      </p>
                    )}
                  </td>
                  <td {...cell(5, "whitespace-nowrap p-2 text-fg")}>{r.status ?? "—"}</td>
                  <td {...cell(6, "whitespace-nowrap p-2 text-right tabular-nums font-semibold text-fg-strong")}>
                    {formatPrice(r.active_price)}
                  </td>
                  <td {...cell(7, "whitespace-nowrap p-2 text-right tabular-nums font-medium text-fg-strong")}>
                    {formatPrice(r.promo_price)}
                  </td>
                  <td
                    {...cell(8, "whitespace-nowrap p-2 text-right tabular-nums text-sm text-fg")}
                    title="PMA do produto vinculado (cadastro em Produtos)"
                  >
                    {r.pma != null && r.pma > 0 ? formatPrice(r.pma) : "—"}
                  </td>
                  <td
                    {...cell(9, "whitespace-nowrap p-2 text-right tabular-nums text-sm text-fg")}
                    title="Custo no cache de preços (tela Preços / produto vinculado)"
                  >
                    {formatPrice(r.cost_price)}
                  </td>
                  <td {...cell(10, "p-2")}>
                    <span
                      className={`inline-flex rounded-app px-2 py-0.5 text-xs font-medium ${tipoBadge}`}
                    >
                      {tipoLabel}
                    </span>
                  </td>
                  <td {...cell(11, "max-w-[14rem] p-2 text-xs text-fg")} title={r.promotionType ?? undefined}>
                    <span className="line-clamp-2">{labelForMlPromotionType(r.promotionType)}</span>
                  </td>
                  <td {...cell(12, "max-w-[24rem] p-2 text-xs leading-snug text-fg")}>
                    <div className="font-medium text-fg-strong">{r.promotionLabel}</div>
                    {r.value_hint ? (
                      <div className="mt-0.5 text-[11px] text-fg-muted">{r.value_hint}</div>
                    ) : null}
                  </td>
                  <td {...cell(13, "whitespace-nowrap p-2 text-right text-sm font-semibold text-green-700 dark:text-green-400")}>
                    {calc ? formatPrice(calc.vai_receber) : "—"}
                  </td>
                  <td {...cell(14, "whitespace-nowrap p-2 text-right text-sm tabular-nums")}>
                    {profit != null ? (
                      <span className={profit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                        {formatPrice(profit)}
                      </span>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                  <td {...cell(15, "whitespace-nowrap p-2 text-right text-sm tabular-nums")}>
                    {profitPercent != null ? (
                      <span
                        className={
                          profitPercent >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                        }
                      >
                        {profitPercent >= 0 ? "+" : ""}
                        {profitPercent.toFixed(1).replace(".", ",")}%
                      </span>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                  <td {...cell(16, "whitespace-nowrap p-2 text-right text-sm text-amber-700 dark:text-amber-300")}>
                    {calc ? formatPrice(calc.fee) : "—"}
                  </td>
                  <td {...cell(17, "whitespace-nowrap p-2 text-right text-sm text-sky-700 dark:text-sky-300")}>
                    {calc && calc.meli_fee_subsidy > 0 ? (
                      <span title="Subsídio do Mercado Livre (somado em Vai receber)">
                        +{formatPrice(calc.meli_fee_subsidy)}
                      </span>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                  <td {...cell(18, "whitespace-nowrap p-2 text-right text-sm")}>
                    {calc ? (
                      calc.shipping_cost > 0 ? (
                        <span className="text-red-600 dark:text-red-400">{formatPrice(calc.shipping_cost)}</span>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td {...cell(19, "whitespace-nowrap p-2 text-right text-sm")}>
                    {calc ? (
                      calc.tax_amount > 0 ? (
                        <span className="text-orange-600 dark:text-orange-400" title={r.tax_percent ? `${r.tax_percent}%` : undefined}>
                          {formatPrice(calc.tax_amount)}
                        </span>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td {...cell(20, "whitespace-nowrap p-2 text-right text-sm")}>
                    {calc ? (
                      calc.extra_fee_amount > 0 ? (
                        <span
                          className="text-purple-600 dark:text-purple-400"
                          title={r.extra_fee_percent ? `${r.extra_fee_percent}%` : undefined}
                        >
                          {formatPrice(calc.extra_fee_amount)}
                        </span>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td {...cell(21, "whitespace-nowrap p-2 text-right text-sm")}>
                    {calc ? (
                      calc.fixed_expenses_amount > 0 ? (
                        <span className="text-indigo-600 dark:text-indigo-400">{formatPrice(calc.fixed_expenses_amount)}</span>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td {...cell(22, "whitespace-nowrap p-2 text-left text-[11px] tabular-nums text-fg")} title={r.campaign_start_at ?? undefined}>
                    {formatCampaignDatePt(r.campaign_start_at)}
                  </td>
                  <td {...cell(23, "whitespace-nowrap p-2 text-left text-[11px] tabular-nums text-fg")} title={r.campaign_finish_at ?? undefined}>
                    {formatCampaignDatePt(r.campaign_finish_at)}
                  </td>
                  <td {...cell(24, "p-2")}>
                    {r.permalink ? (
                      <a
                        href={r.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <img
                          src="https://www.mercadolivre.com.br/favicon.ico"
                          alt=""
                          width={18}
                          height={18}
                          className="opacity-90"
                        />
                        Ver
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
      </div>

      {total === 0 && !loading && !error && (
        <p className="border-t border-slate-100 px-3 py-3 text-center text-sm text-slate-500 dark:text-slate-400">
          Nenhum resultado nesta página.
        </p>
      )}

        </div>
        )}

      </div>

      {filtersModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setFiltersModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Filtros de promoções"
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded border border-slate-200 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Filtros</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Refine busca, vínculo, tipo e campanha.</p>
              </div>
              <button
                type="button"
                onClick={() => setFiltersModalOpen(false)}
                className="btn btn-secondary btn-sm"
                aria-label="Fechar filtros"
              >
                Fechar
              </button>
            </div>
            <form onSubmit={handleFilterSubmit} className="space-y-4 p-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Buscar</label>
                <input
                  type="text"
                  value={draftSearch}
                  onChange={(e) => setDraftSearch(e.target.value)}
                  placeholder="Título ou MLB…"
                  className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Vínculo MLB → produto
                </label>
                <select
                  value={draftLinkFilter}
                  onChange={(e) => setDraftLinkFilter(e.target.value as PromoLinkFilter)}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                >
                  <option value="all">Todos</option>
                  <option value="linked">Só vinculados</option>
                  <option value="unlinked">Só não vinculados</option>
                </select>
              </div>
              <div>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Tipo</span>
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      { value: "" as const, label: "Todos" },
                      { value: "ativa" as const, label: "Ativa" },
                      { value: "possível" as const, label: "Possível" },
                    ] as const
                  ).map(({ value, label }) => (
                    <button
                      key={value || "tipo-all"}
                      type="button"
                      onClick={() => setDraftKindFilter(value)}
                      className={`btn btn-mini ${
                        draftKindFilter === value ? "btn-primary" : "btn-outline-secondary"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Lucratividade</span>
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
                      key={value || "profit-all"}
                      type="button"
                      onClick={() => setDraftProfitFilter(value)}
                      className={`btn btn-mini ${
                        draftProfitFilter === value ? "btn-primary" : "btn-outline-secondary"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Campanha ML (tipo)
                </label>
                <select
                  value={draftPtypeFilter}
                  onChange={(e) => setDraftPtypeFilter(e.target.value)}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-700 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                >
                  <option value="">Todos os tipos</option>
                  {ML_PROMOTION_TYPE_CATALOG.map((e) => (
                    <option key={e.code} value={e.code}>
                      {e.labelPt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Prazo da campanha
                </label>
                <select
                  value={draftCampFilter}
                  onChange={(e) => setDraftCampFilter(e.target.value as PromoCampaignPhase)}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                >
                  <option value="">Todas</option>
                  <option value="in">Em vigência</option>
                  <option value="future">Futura (ainda não começou)</option>
                  <option value="past">Encerrada</option>
                  <option value="nodates">Sem datas no ML</option>
                </select>
              </div>
              <div>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-slate-300"
                    checked={draftPmaLtePromo}
                    onChange={(e) => setDraftPmaLtePromo(e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">PMA ≤ preço promoção</span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                      Só anúncios com produto vinculado em que o PMA cadastrado é menor ou igual ao preço promoção.
                    </span>
                  </span>
                </label>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                {showFilterResetButton && (
                  <button
                    type="button"
                    onClick={() => {
                      clearFilters();
                      setFiltersModalOpen(false);
                    }}
                    className="btn btn-secondary btn-sm"
                  >
                    Limpar
                  </button>
                )}
                <button type="submit" className="btn btn-primary btn-sm">
                  Aplicar filtros
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 8v5l3 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M4 6h16M7 12h10M10 18h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function KebabMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="5" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="19" r="1.7" fill="currentColor" />
    </svg>
  );
}

export default function PromocoesPage() {
  return (
    <OnboardingGate required="catalog">
      <Suspense
        fallback={
          <div className="overflow-hidden rounded border border-slate-200/90 bg-white p-8 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <p className="text-sm text-slate-500">Carregando…</p>
          </div>
        }
      >
        <PromocoesContent />
      </Suspense>
    </OnboardingGate>
  );
}
