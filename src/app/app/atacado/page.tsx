"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppTable } from "@/components/AppTable";
import { ReceivableModal } from "@/components/ReceivableModal";
import type { Tier } from "@/lib/atacado";

type PriceReferenceStatus = "competitive" | "attention" | "high" | "none";

interface ReferenceSummary {
  suggested_price: number | null;
  min_reference_price: number | null;
  max_reference_price: number | null;
  status: string;
  explanation: string;
  updated_at: string | null;
}

interface ImportPreviewRow {
  row: number;
  item_id: string;
  variation_id: string;
  sku: string;
  title: string;
  price_atual: string;
  tiers: Tier[];
  valid: boolean;
  error?: string;
}

interface ValidItemForConfirm {
  item_id: string;
  variation_id: number | null;
  tiers: Tier[];
}

interface ImportResult {
  ok: boolean;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  errors: { row: number; field?: string; message: string }[];
  preview: ImportPreviewRow[];
  valid_items?: ValidItemForConfirm[];
}

interface MLAccount {
  id: string;
  ml_nickname: string | null;
}

interface AtacadoRow {
  item_id: string;
  variation_id: number | null;
  sku: string | null;
  title: string | null;
  current_price: number | null;
  listing_type_id?: string | null;
  category_id?: string | null;
  tiers: Tier[];
  has_draft: boolean;
  has_variations: boolean;
  draft_updated_at: string | null;
  price_reference_status?: PriceReferenceStatus;
  reference_summary?: ReferenceSummary | null;
  /** Nome da família (modelo User Product); null para itens clássicos */
  family_name?: string | null;
  /** true = anúncio do modelo User Product (MLBU) */
  is_user_product?: boolean;
  /** Código MLBU (user_product_id) */
  user_product_id?: string | null;
  family_id?: string | null;
  /** Itens da mesma família (item_ids) */
  family_item_ids?: string[] | null;
}

type RowStatus = "saved" | "edited" | "error";
type RowEditState = {
  tiers: Tier[];
  status: RowStatus;
  error?: string;
};

function ensureTiers5(tiers: Tier[]): (Tier | null)[] {
  const result: (Tier | null)[] = Array(5).fill(null);
  for (let i = 0; i < Math.min(5, tiers.length); i++) {
    result[i] = tiers[i] ?? null;
  }
  return result;
}

function competitivenessBadge(status: PriceReferenceStatus | undefined): { label: string; className: string } {
  switch (status) {
    case "competitive":
      return { label: "Competitivo", className: "bg-green-200 text-green-800" };
    case "attention":
      return { label: "Atenção", className: "bg-amber-200 text-amber-800" };
    case "high":
      return { label: "Preço alto", className: "bg-red-200 text-red-800" };
    default:
      return { label: "Sem referência", className: "bg-gray-200 text-gray-700" };
  }
}

function formatRefPrice(summary: ReferenceSummary | null | undefined): string {
  if (!summary) return "—";
  const { suggested_price, min_reference_price, max_reference_price } = summary;
  if (min_reference_price != null && max_reference_price != null && min_reference_price !== max_reference_price) {
    return `R$ ${Number(min_reference_price).toFixed(2)} – R$ ${Number(max_reference_price).toFixed(2)}`;
  }
  const p = suggested_price ?? min_reference_price ?? max_reference_price;
  return p != null ? `R$ ${Number(p).toFixed(2)}` : "—";
}

function AtacadoPageContent() {
  const [accounts, setAccounts] = useState<MLAccount[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [rows, setRows] = useState<AtacadoRow[]>([]);
  const [edits, setEdits] = useState<Record<string, RowEditState>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [filter, setFilter] = useState("");
  const [mlbuCodeInput, setMlbuCodeInput] = useState("");
  const [mlbuCodeApplied, setMlbuCodeApplied] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importConfirming, setImportConfirming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [applyJobId, setApplyJobId] = useState<string | null>(null);
  const [applyJob, setApplyJob] = useState<{
    job: { id: string; status: string; total: number; processed: number; ok: number; errors: number };
    logs: Array<{ item_id: string | null; variation_id: number | null; status: string; message: string | null; response_json?: unknown }>;
  } | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);

  /** Texto digitado no campo de preço (por linha e tier) para permitir decimais com vírgula enquanto digita */
  const [editingPrice, setEditingPrice] = useState<Record<string, string>>({});

  /** Célula que acabou de ser copiada (ex: "mlb:MLB123:item") para mostrar "Copiado!" */
  const [copiedCell, setCopiedCell] = useState<string | null>(null);

  /** Linha cujo modal "Ver recebível" está aberto (rowKey ou null) */
  const [receivableRowKey, setReceivableRowKey] = useState<string | null>(null);

  /** Linha cujo popover de competitividade está aberto */
  const [competitivenessPopoverKey, setCompetitivenessPopoverKey] = useState<string | null>(null);
  const [refJobId, setRefJobId] = useState<string | null>(null);
  const [refJob, setRefJob] = useState<{ status: string } | null>(null);

  /** Famílias expandidas (family_id -> true). Novo family_id começa expandido. */
  const [expandedFamilies, setExpandedFamilies] = useState<Record<string, boolean>>({});

  const searchParams = useSearchParams();
  const rowKey = (r: AtacadoRow) => `${r.item_id}:${r.variation_id ?? "item"}`;

  /** Agrupa linhas consecutivas com o mesmo family_id para exibir como bloco "Família" expansível */
  const rowSections = React.useMemo(() => {
    const sections: Array<{ type: "family"; familyId: string; familyName: string; rows: AtacadoRow[] } | { type: "single"; rows: AtacadoRow[] }> = [];
    let i = 0;
    while (i < rows.length) {
      const r = rows[i];
      const fid = r.family_id ?? null;
      if (fid && r.family_name) {
        const familyRows: AtacadoRow[] = [];
        while (i < rows.length && (rows[i].family_id === fid)) {
          familyRows.push(rows[i]);
          i++;
        }
        sections.push({ type: "family", familyId: fid, familyName: r.family_name, rows: familyRows });
      } else {
        sections.push({ type: "single", rows: [r] });
        i++;
      }
    }
    return sections;
  }, [rows]);

  const setFamilyExpanded = useCallback((familyId: string, expanded: boolean) => {
    setExpandedFamilies((prev) => ({ ...prev, [familyId]: expanded }));
  }, []);
  const isFamilyExpanded = useCallback((familyId: string) => expandedFamilies[familyId] !== false, [expandedFamilies]);

  /** Renderiza uma linha editável; isInFamily aplica estilo visual de item da família */
  function renderAtacadoRow(r: AtacadoRow, isInFamily: boolean) {
    const cur = getEditState(r);
    const tiers5 = ensureTiers5(cur.tiers);
    const err = validateRow(r);
    const isInvalid = cur.status === "edited" && err != null;
    return (
      <tr
        key={rowKey(r)}
        className={`border-b border-gray-100 ${isInFamily ? "border-l-4 border-l-slate-300 bg-slate-50/50 " : ""}${isInvalid ? "bg-red-50" : ""} hover:bg-gray-50`}
      >
        <td className="p-2">
          <button type="button" onClick={() => copyToClipboard(r.item_id, `${rowKey(r)}-mlb`)} title="Clique para copiar" className="font-mono text-gray-600 hover:bg-gray-100 rounded px-1 py-0.5 -mx-1 text-left cursor-pointer">
            {copiedCell === `${rowKey(r)}-mlb` ? <span className="text-emerald-600 text-xs font-medium">Copiado!</span> : r.item_id}
          </button>
        </td>
        <td className="max-w-[180px] truncate p-2" title={r.title ?? ""}>{r.title ?? "—"}</td>
        <td className="p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {r.is_user_product && <span className="inline-flex items-center rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-800" title="MLBU">MLBU</span>}
            {r.user_product_id && <span className="font-mono text-xs text-gray-600">{r.user_product_id}</span>}
            {r.family_name && <span className="max-w-[120px] truncate inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700" title={`Família: ${r.family_name}`}>{r.family_name}</span>}
            {!r.is_user_product && !r.family_name && !r.user_product_id && <span className="text-gray-400 text-xs">—</span>}
          </div>
        </td>
        <td className="p-2">{r.variation_id ?? "—"}</td>
        <td className="p-2 text-gray-600" title={r.sku ? "Clique para copiar" : "Configure SELLER_SKU no ML."}>
          {r.sku ? (
            <button type="button" onClick={() => copyToClipboard(r.sku ?? "", `${rowKey(r)}-sku`)} className="hover:bg-gray-100 rounded px-1 py-0.5 -mx-1 text-left cursor-pointer max-w-full truncate block">
              {copiedCell === `${rowKey(r)}-sku` ? <span className="text-emerald-600 text-xs font-medium">Copiado!</span> : r.sku}
            </button>
          ) : (
            <span className="cursor-help text-amber-600">Não configurado</span>
          )}
        </td>
        <td className="p-2">{r.current_price != null ? Number(r.current_price).toFixed(2) : "—"}</td>
        <td className="relative p-2">
          {(() => {
            const status = r.price_reference_status ?? "none";
            const { label, className } = competitivenessBadge(status);
            const key = rowKey(r);
            const isOpen = competitivenessPopoverKey === key;
            return (
              <div className="relative inline-block">
                <button type="button" onClick={() => setCompetitivenessPopoverKey(isOpen ? null : key)} className={`rounded px-2 py-0.5 text-xs font-medium ${className} hover:opacity-90`}>{label}</button>
                {isOpen && (
                  <>
                    <div className="fixed inset-0 z-10" aria-hidden onClick={() => setCompetitivenessPopoverKey(null)} />
                    <div className="absolute left-0 top-full z-20 mt-1 min-w-[280px] rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
                      <p className="text-sm font-medium text-gray-800">Referência de preço</p>
                      <dl className="mt-2 space-y-1 text-sm">
                        <div><dt className="text-gray-500">Preço atual</dt><dd>{r.current_price != null ? `R$ ${Number(r.current_price).toFixed(2)}` : "—"}</dd></div>
                        <div><dt className="text-gray-500">Referência / sugestão</dt><dd>{formatRefPrice(r.reference_summary)}</dd></div>
                        {r.reference_summary?.explanation && <div><dt className="text-gray-500">Status</dt><dd className="text-gray-700">{r.reference_summary.explanation}</dd></div>}
                        {r.reference_summary?.updated_at && <div><dt className="text-gray-500">Última atualização</dt><dd className="text-gray-600">{new Date(r.reference_summary.updated_at).toLocaleString("pt-BR")}</dd></div>}
                      </dl>
                      <button type="button" disabled={!!refJobId && refJob?.status !== "success" && refJob?.status !== "failed" && refJob?.status !== "partial"} onClick={async () => { setRefJobId(null); setRefJob(null); const res = await fetch("/api/price-references/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, scope: "item", item_id: r.item_id }) }); const data = await res.json(); if (res.ok && data.job_id) { setRefJobId(data.job_id); setRefJob({ status: "queued" }); } setCompetitivenessPopoverKey(null); }} className="mt-3 w-full rounded bg-gray-100 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50">{refJobId && (refJob?.status === "running" || refJob?.status === "queued") ? "Atualizando…" : "Atualizar referência"}</button>
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </td>
        {[0, 1, 2, 3, 4].map((i) => {
          const priceInputKey = `${rowKey(r)}-${i}`;
          const priceDisplay = editingPrice[priceInputKey] !== undefined ? editingPrice[priceInputKey] : tiers5[i]?.price != null ? formatPriceDisplay(tiers5[i].price) : "";
          return (
            <React.Fragment key={i}>
              <td className="p-2">
                <input type="number" min={2} step={1} placeholder={i === 0 ? "2" : ""} value={tiers5[i]?.min_qty ?? ""} onChange={(e) => updateTier(r, i, "min_qty", e.target.value)} className={`w-16 rounded border px-1 py-0.5 text-sm ${isInvalid ? "border-red-500" : "border-gray-200"}`} />
              </td>
              <td className="p-2">
                <input type="text" inputMode="decimal" placeholder="0,00" value={priceDisplay} onChange={(e) => setEditingPrice((prev) => ({ ...prev, [priceInputKey]: e.target.value }))} onBlur={(e) => { const raw = e.target.value.trim(); const parsed = raw !== "" ? parsePriceInput(raw) : tiers5[i]?.price ?? 0; updateTier(r, i, "price", parsed); setEditingPrice((prev) => { const next = { ...prev }; delete next[priceInputKey]; return next; }); }} className={`w-20 rounded border px-1 py-0.5 text-sm ${isInvalid ? "border-red-500" : "border-gray-200"}`} />
              </td>
            </React.Fragment>
          );
        })}
        <td className="p-2">
          <span className={`rounded px-2 py-0.5 text-xs ${cur.status === "error" ? "bg-red-200 text-red-800" : cur.status === "edited" ? "bg-amber-200 text-amber-800" : "bg-green-100 text-green-800"}`}>{cur.status === "error" ? "erro" : cur.status === "edited" ? "alterado" : "salvo"}</span>
        </td>
        <td className="p-2">
          <button type="button" onClick={() => saveRow(r)} disabled={saving} className="mr-1 text-brand-blue hover:underline disabled:opacity-50">Salvar</button>
          <button type="button" onClick={() => revertRow(r)} className="mr-1 text-gray-600 hover:underline">Reverter</button>
          <button type="button" onClick={() => setReceivableRowKey(rowKey(r))} title="Ver recebível" className="text-gray-600 hover:underline">Ver recebível</button>
        </td>
      </tr>
    );
  }

  const copyToClipboard = useCallback((text: string, cellId: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCell(cellId);
      setTimeout(() => setCopiedCell(null), 1800);
    });
  }, []);

  const formatPriceDisplay = (n: number): string => (n == null || Number.isNaN(n) ? "" : Number(n).toFixed(2).replace(".", ","));

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/mercadolivre/accounts");
    if (res.ok) {
      const data = await res.json();
      const accs = data.accounts ?? [];
      setAccounts(accs);
      if (accs.length > 0 && !accountId) setAccountId(accs[0].id);
    }
    setLoading(false);
  }, [accountId]);

  const loadRows = useCallback(async (forceRefresh = false) => {
    if (!accountId) return;
    setLoading(true);
    const params = new URLSearchParams({ accountId, page: String(page), limit: String(limit) });
    if (search) params.set("search", search);
    if (filter) params.set("filter", filter);
    if (mlbuCodeApplied.trim()) params.set("mlbu_code", mlbuCodeApplied.trim());
    if (forceRefresh) params.set("_", String(Date.now()));
    const res = await fetch(`/api/atacado/rows?${params}`);
    if (res.ok) {
      const data = await res.json();
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setEdits({});
    }
    setLoading(false);
  }, [accountId, page, limit, search, filter, mlbuCodeApplied]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const urlAccountId = searchParams.get("accountId");
  const urlFilter = searchParams.get("filter");
  useEffect(() => {
    if (urlAccountId && accounts.some((a) => a.id === urlAccountId)) {
      setAccountId(urlAccountId);
    }
  }, [urlAccountId, accounts]);
  useEffect(() => {
    if (urlFilter === "price_high" || urlFilter === "mlbu" || urlFilter === "com_familia" || urlFilter === "com_variações" || urlFilter === "com_rascunho" || urlFilter === "sem_rascunho") {
      setFilter(urlFilter);
    }
  }, [urlFilter]);

  useEffect(() => {
    if (accountId) loadRows();
  }, [accountId, loadRows]);


  const editedCount = Object.values(edits).filter((e) => e.status === "edited" || e.status === "error").length;

  const getEditState = (r: AtacadoRow): RowEditState => {
    const key = rowKey(r);
    return edits[key] ?? { tiers: r.tiers, status: "saved" };
  };

  const parsePriceInput = (raw: string): number => {
    if (typeof raw !== "string") return raw || 0;
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    // Remove espaços e quaisquer caracteres que não sejam dígitos, vírgula, ponto ou sinal de menos
    const cleaned = trimmed.replace(/[^\d,.-]/g, "");
    // Se tiver vírgula e ponto, assumimos ponto como separador de milhar e vírgula como decimal
    if (cleaned.includes(",") && cleaned.includes(".")) {
      const noThousands = cleaned.replace(/\./g, "");
      return parseFloat(noThousands.replace(",", ".")) || 0;
    }
    // Apenas vírgula: tratamos como separador decimal
    if (cleaned.includes(",")) {
      return parseFloat(cleaned.replace(",", ".")) || 0;
    }
    // Caso geral: número simples com ponto ou só dígitos
    return parseFloat(cleaned) || 0;
  };

  const updateTier = (r: AtacadoRow, tierIdx: number, field: "min_qty" | "price", value: string | number) => {
    const key = rowKey(r);
    const cur = getEditState(r);
    const tiers5 = ensureTiers5(cur.tiers);
    const newTiers: (Tier | null)[] = [...tiers5];
    if (newTiers[tierIdx] == null) {
      newTiers[tierIdx] = { min_qty: 2, price: 0 };
    }
    const t = { ...newTiers[tierIdx]! };
    if (field === "min_qty") {
      t.min_qty = typeof value === "string" ? parseInt(value, 10) || 0 : value;
    } else {
      t.price = typeof value === "string" ? parsePriceInput(value) : value;
    }
    newTiers[tierIdx] = t;
    const toKeep = newTiers.filter((x): x is Tier => x != null && x.min_qty >= 2);
    const sorted = [...toKeep].sort((a, b) => a.min_qty - b.min_qty);
    setEdits((prev) => ({
      ...prev,
      [key]: { tiers: sorted, status: "edited" },
    }));
  };

  const revertRow = (r: AtacadoRow) => {
    const key = rowKey(r);
    setEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const validateRow = (r: AtacadoRow): string | null => {
    const cur = getEditState(r);
    const t = cur.tiers;
    if (t.length === 0) return null;
    const minQtys = new Set<number>();
    for (let i = 0; i < t.length; i++) {
      if (t[i].min_qty < 2 || !Number.isInteger(t[i].min_qty)) return `Tier ${i + 1}: min_qty deve ser inteiro >= 2`;
      if (t[i].price <= 0) return `Tier ${i + 1}: price deve ser > 0`;
      if (minQtys.has(t[i].min_qty)) return "Quantidades mínimas duplicadas";
      minQtys.add(t[i].min_qty);
    }
    const sorted = [...t].sort((a, b) => a.min_qty - b.min_qty);
    if (JSON.stringify(t) !== JSON.stringify(sorted)) return "Tiers devem estar em ordem crescente por min_qty";
    return null;
  };

  const saveRow = async (r: AtacadoRow) => {
    const cur = getEditState(r);
    const err = validateRow(r);
    if (err) {
      const key = rowKey(r);
      setEdits((prev) => ({ ...prev, [key]: { ...cur, status: "error", error: err } }));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/atacado/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          rows: [{ item_id: r.item_id, variation_id: r.variation_id, tiers: cur.tiers }],
        }),
      });
      const data = await res.json();
      if (data.ok || data.saved_count > 0) {
        setMessage({ type: "success", text: "Linha salva." });
        loadRows();
      } else {
        setMessage({ type: "error", text: data.errors?.[0]?.message ?? "Erro ao salvar." });
      }
    } catch {
      setMessage({ type: "error", text: "Erro de conexão." });
    } finally {
      setSaving(false);
    }
  };

  /** Salva alterações pendentes nos drafts. Retorna true se salvou (ou não havia nada) e false se deu erro. */
  const savePendingEdits = async (): Promise<boolean> => {
    const toSave = rows.filter((r) => getEditState(r).status === "edited");
    const valid: AtacadoRow[] = [];
    const invalid: { r: AtacadoRow; err: string }[] = [];
    for (const r of toSave) {
      const err = validateRow(r);
      if (err) invalid.push({ r, err });
      else valid.push(r);
    }
    if (invalid.length > 0) {
      for (const { r, err } of invalid) {
        const key = rowKey(r);
        setEdits((prev) => ({ ...prev, [key]: { ...getEditState(r), status: "error", error: err } }));
      }
      setMessage({ type: "error", text: `${invalid.length} linha(s) com erro. Corrija e tente novamente.` });
      return false;
    }
    if (valid.length === 0) return true;
    try {
      const payload = {
        accountId,
        rows: valid.map((r) => ({
          item_id: r.item_id,
          variation_id: r.variation_id,
          tiers: getEditState(r).tiers,
        })),
      };
      const res = await fetch("/api/atacado/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok !== false) {
        setMessage({ type: "success", text: `${data.saved_count ?? 0} linha(s) salva(s).` });
        await loadRows();
        return true;
      }
      setMessage({ type: "error", text: data.errors?.[0]?.message ?? "Erro ao salvar." });
      return false;
    } catch {
      setMessage({ type: "error", text: "Erro de conexão." });
      return false;
    }
  };

  const saveAll = async () => {
    if (editedCount === 0) {
      setMessage({ type: "success", text: "Nenhuma alteração pendente." });
      return;
    }
    setSaving(true);
    try {
      await savePendingEdits();
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const params = new URLSearchParams({ accountId });
    if (search) params.set("search", search);
    if (filter) params.set("filter", filter);
    window.open(`/api/atacado/export?${params}`, "_blank");
    setMessage({ type: "success", text: "Exportação iniciada." });
  };

  const openImportCsv = () => {
    setImportResult(null);
    setImportFile(null);
    fileInputRef.current?.click();
  };

  const onImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImportLoading(true);
    setImportResult(null);
    setImportFile(file);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/atacado/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Erro ao processar CSV." });
        setImportFile(null);
        return;
      }
      setImportResult(data);
      if (data.ok === false && (data.errors?.length || data.headerError)) {
        setMessage({ type: "error", text: data.errors?.[0]?.message ?? data.headerError ?? "Erro no CSV." });
      }
    } catch {
      setMessage({ type: "error", text: "Erro de conexão." });
      setImportFile(null);
    } finally {
      setImportLoading(false);
    }
  };

  const confirmImport = async () => {
    if (!accountId || !importResult) {
      setMessage({ type: "error", text: "Conta ou resultado da importação não encontrado. Refaça a importação do CSV." });
      return;
    }
    const items = importResult.valid_items;
    const hasItems = Array.isArray(items) && items.length > 0;
    if (!hasItems && !importFile) {
      setMessage({ type: "error", text: "Nada a confirmar (sem itens no preview). Refaça a importação do CSV." });
      return;
    }
    if (!hasItems && importFile) {
      console.log("[Confirmar Importação] Preview sem valid_items; usando arquivo (refaça a importação para usar o novo fluxo).");
    }
    setImportConfirming(true);
    setMessage(null);
    try {
      let res: Response;
      if (hasItems) {
        const body = { accountId, items };
        console.log("[Confirmar Importação] Enviando", items.length, "itens");
        res = await fetch("/api/atacado/import/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        console.log("[Confirmar Importação] Enviando arquivo CSV");
        const form = new FormData();
        form.append("file", importFile!);
        form.append("accountId", accountId);
        res = await fetch("/api/atacado/import/confirm", { method: "POST", body: form });
      }
      const text = await res.text();
      let data: { ok?: boolean; saved_count?: number; error?: string; warning?: string; details?: string[] };
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        console.error("[Confirmar Importação] Resposta não é JSON:", res.status, text.slice(0, 200));
        setMessage({ type: "error", text: `Erro do servidor (${res.status}). Veja o console (F12).` });
        return;
      }
      console.log("[Confirmar Importação] Resposta:", res.status, data);
      if (data.ok) {
        const msg = data.warning
          ? `${data.saved_count ?? 0} linha(s) importada(s). ${data.warning}`
          : `${data.saved_count ?? 0} linha(s) importada(s).`;
        setMessage({ type: "success", text: msg });
        if (data.details?.length) console.warn("[Confirmar Importação] Detalhes:", data.details);
        setImportResult(null);
        setImportFile(null);
        await loadRows(true);
      } else {
        const detail = data.details?.length ? ` — ${data.details[0]}` : "";
        setMessage({ type: "error", text: (data.error ?? "Erro ao confirmar importação.") + detail });
      }
    } catch (e) {
      console.error("[Confirmar Importação] Erro:", e);
      setMessage({ type: "error", text: "Erro de conexão. Veja o console (F12)." });
    } finally {
      setImportConfirming(false);
    }
  };

  const cancelImport = () => {
    setImportResult(null);
    setImportFile(null);
  };

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  const fetchApplyJob = useCallback(async (jobId: string) => {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) return;
    const data = await res.json();
    setApplyJob({ job: data.job, logs: data.logs ?? [] });
  }, []);

  const startApply = async () => {
    if (!accountId) return;
    setApplyLoading(true);
    setMessage(null);
    try {
      if (editedCount > 0) {
        setMessage({ type: "success", text: "Salvando alterações antes de aplicar…" });
        const saved = await savePendingEdits();
        if (!saved) {
          setApplyLoading(false);
          return;
        }
      }
      const res = await fetch("/api/atacado/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Erro ao iniciar aplicação." });
        return;
      }
      setApplyJobId(data.job_id);
      await fetchApplyJob(data.job_id);
    } catch {
      setMessage({ type: "error", text: "Erro de conexão." });
    } finally {
      setApplyLoading(false);
    }
  };

  useEffect(() => {
    if (!applyJobId) return;
    const status = applyJob?.job?.status;
    if (status === "queued" || status === "running") {
      const interval = setInterval(() => fetchApplyJob(applyJobId), 2500);
      return () => clearInterval(interval);
    }
  }, [applyJobId, applyJob?.job?.status, fetchApplyJob]);

  const fetchRefJob = useCallback(async (jobId: string) => {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) return;
    const data = await res.json();
    setRefJob({ status: data.job?.status ?? "unknown" });
    if (["success", "failed", "partial"].includes(data.job?.status ?? "")) {
      setRefJobId(null);
      loadRows(true);
    }
  }, [loadRows]);

  useEffect(() => {
    if (!refJobId) return;
    fetchRefJob(refJobId);
    const status = refJob?.status;
    if (status === "queued" || status === "running") {
      const interval = setInterval(() => fetchRefJob(refJobId), 2500);
      return () => clearInterval(interval);
    }
  }, [refJobId, refJob?.status, fetchRefJob]);

  const totalPages = Math.ceil(total / limit) || 1;

  const TABLE_COL_COUNT = 19;

  if (loading && accounts.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-gray-500">Carregando…</p>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <p className="text-amber-800">
          Conecte sua conta do Mercado Livre em{" "}
          <a href="/app/configuracao" className="font-medium underline">
            Configuração
          </a>{" "}
          para usar o editor de atacado.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h1 className="mb-6 text-xl font-semibold">Editor de Preço de Atacado</h1>

      {message && (
        <div
          className={`mb-4 rounded p-3 ${
            message.type === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div>
          <label className="mr-2 text-sm text-gray-600">Conta:</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.ml_nickname || a.id}
              </option>
            ))}
          </select>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
            setPage(1);
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por MLB, título, SKU ou família"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <button type="submit" className="rounded bg-gray-200 px-3 py-1 text-sm hover:bg-gray-300">
            Buscar
          </button>
        </form>
        <div className="flex items-center gap-1">
          <label className="text-sm text-gray-600">Cód. MLBU:</label>
          <input
            type="text"
            value={mlbuCodeInput}
            onChange={(e) => setMlbuCodeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setMlbuCodeApplied(mlbuCodeInput.trim());
                setPage(1);
              }
            }}
            placeholder="ex: MLAU123"
            className="w-28 rounded border border-gray-300 px-2 py-1 text-sm font-mono"
            title="Filtrar por código User Product (MLBU). Enter ou clique em Filtrar."
          />
          <button
            type="button"
            onClick={() => { setMlbuCodeApplied(mlbuCodeInput.trim()); setPage(1); }}
            className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-100"
          >
            Filtrar
          </button>
        </div>
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
          title="Filtrar linhas da tabela"
        >
          <option value="">Todos</option>
          <option value="com_variações">Com variações</option>
          <option value="mlbu">Só MLBU</option>
          <option value="com_familia">Com família</option>
          <option value="com_rascunho">Com rascunho</option>
          <option value="sem_rascunho">Sem rascunho</option>
          <option value="price_high">Preço alto</option>
        </select>
        <button
          type="button"
          disabled={!!refJobId && (refJob?.status === "queued" || refJob?.status === "running")}
          onClick={async () => {
            if (!accountId) return;
            const res = await fetch("/api/price-references/refresh", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accountId, scope: "all" }),
            });
            const data = await res.json();
            if (res.ok && data.job_id) {
              setRefJobId(data.job_id);
              setRefJob({ status: "queued" });
            }
          }}
          className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {refJobId && (refJob?.status === "queued" || refJob?.status === "running")
            ? "Atualizando referências…"
            : "Atualizar referências"}
        </button>
        <button
          type="button"
          onClick={saveAll}
          disabled={saving || editedCount === 0}
          className="rounded bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar alterações"}
        </button>
        <button
          type="button"
          onClick={exportCsv}
          className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Exportar CSV modelo
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={onImportFileChange}
        />
        <button
          type="button"
          onClick={openImportCsv}
          disabled={importLoading}
          className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {importLoading ? "Processando…" : "Importar CSV"}
        </button>
        <button
          type="button"
          onClick={startApply}
          disabled={applyLoading || saving || !accountId}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {applyLoading ? (editedCount > 0 ? "Salvando e aplicando…" : "Aplicando…") : "Aplicar Preços no Mercado Livre"}
        </button>
        <span className="text-sm text-gray-500">
          Aplicar envia os preços de atacado salvos para o Mercado Livre. Alterações não salvas serão salvas automaticamente ao clicar.
        </span>
        {editedCount > 0 && (
          <span className="text-sm text-amber-700">{editedCount} linha(s) alterada(s)</span>
        )}
      </div>

      {applyJob && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h2 className="mb-3 text-lg font-semibold">Aplicação de preços no ML</h2>
          <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
            <span className="font-medium">Status: {applyJob.job.status}</span>
            <span>
              Progresso: {applyJob.job.processed}/{applyJob.job.total}
            </span>
            <span className="text-green-700">OK: {applyJob.job.ok}</span>
            <span className="text-red-700">Erros: {applyJob.job.errors}</span>
            <button
              type="button"
              onClick={() => {
                const id = applyJobId ?? applyJob?.job?.id;
                if (id) fetchApplyJob(id);
              }}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-100"
            >
              Atualizar
            </button>
            <button
              type="button"
              onClick={() => { setApplyJob(null); setApplyJobId(null); }}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-100"
            >
              Fechar
            </button>
          </div>
          {applyJob.logs.filter((l) => l.status === "error").length > 0 && (
            <div className="max-h-48 overflow-auto rounded border border-red-200 bg-red-50 p-2 text-sm">
              <p className="mb-2 font-medium text-red-800">Erros:</p>
              <ul className="space-y-1">
                {applyJob.logs
                  .filter((l) => l.status === "error")
                  .slice(0, 20)
                  .map((log, idx) => (
                    <li key={idx} className="text-red-700">
                      {log.item_id ?? ""}
                      {log.variation_id != null ? ` (var ${log.variation_id})` : ""}: {log.message ?? "—"}
                    </li>
                  ))}
                {applyJob.logs.filter((l) => l.status === "error").length > 20 && (
                  <li className="text-red-600">… e mais erros (veja logs no servidor)</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {importResult && (
        <div className="mb-6 rounded-lg border-2 border-gray-300 bg-gray-50 p-4">
          <h2 className="mb-3 text-lg font-semibold">Preview da importação</h2>
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <span className="font-medium">Total de linhas: {importResult.total_rows}</span>
            <span className="text-green-700">Válidas: {importResult.valid_rows}</span>
            <span className="text-red-700">Com erro: {importResult.error_rows}</span>
          </div>
          {importResult.preview.length > 0 && (
            <div className="mb-4">
              <AppTable summary={`Preview: ${importResult.valid_rows} válidas, ${importResult.error_rows} com erro`} maxHeight="20rem">
                <thead>
                  <tr>
                    <th className="p-2 font-medium">Linha</th>
                    <th className="p-2 font-medium">item_id</th>
                    <th className="p-2 font-medium">variation_id</th>
                    <th className="p-2 font-medium">sku</th>
                    <th className="max-w-[120px] truncate p-2 font-medium">title</th>
                    <th className="p-2 font-medium">Preço atual R$</th>
                    <th className="p-2 font-medium">Tiers</th>
                    <th className="p-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.preview.map((pr) => (
                    <tr
                      key={pr.row}
                      className={`border-t border-gray-100 ${pr.valid ? "bg-white" : "bg-red-50"}`}
                    >
                      <td className="p-2">{pr.row}</td>
                      <td className="p-2 font-mono text-gray-700">{pr.item_id || "—"}</td>
                      <td className="p-2">{pr.variation_id || "—"}</td>
                      <td className="max-w-[80px] truncate p-2">{pr.sku || "—"}</td>
                      <td className="max-w-[120px] truncate p-2" title={pr.title}>
                        {pr.title || "—"}
                      </td>
                      <td className="p-2">{pr.price_atual || "—"}</td>
                      <td className="p-2">
                        {pr.tiers.length > 0
                          ? pr.tiers.map((t) => `${t.min_qty}→${t.price}`).join(", ")
                          : "—"}
                      </td>
                      <td className="p-2">
                        {pr.valid ? (
                          <span className="rounded bg-green-200 px-2 py-0.5 text-green-800">OK</span>
                        ) : (
                          <span className="rounded bg-red-200 px-2 py-0.5 text-red-800" title={pr.error}>
                            Erro
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AppTable>
            </div>
          )}
          {importResult.errors.length > 0 && (
            <div className="mb-4 max-h-40 overflow-auto rounded border border-red-200 bg-red-50 p-2 text-sm">
              <p className="mb-2 font-medium text-red-800">Erros por linha:</p>
              <ul className="list-inside list-disc space-y-1 text-red-700">
                {importResult.errors.slice(0, 50).map((err, idx) => (
                  <li key={idx}>
                    Linha {err.row}{err.field ? ` (${err.field})` : ""}: {err.message}
                  </li>
                ))}
                {importResult.errors.length > 50 && (
                  <li>… e mais {importResult.errors.length - 50} erros.</li>
                )}
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmImport}
              disabled={importConfirming || importResult.valid_rows === 0}
              className="rounded bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
            >
              {importConfirming ? "Importando…" : "Confirmar Importação"}
            </button>
            <button
              type="button"
              onClick={cancelImport}
              disabled={importConfirming}
              className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-500">
          Nenhum item encontrado. Sincronize anúncios em{" "}
          <a href="/app/anuncios" className="text-brand-blue hover:underline">
            Anúncios
          </a>
          .
        </p>
      ) : (
        <>
          <AppTable
            summary={`${total} linha(s) — página ${page} de ${totalPages}`}
            maxHeight="70vh"
          >
            <thead>
              <tr>
                <th className="whitespace-nowrap p-2 font-medium">MLB</th>
                  <th className="p-2 font-medium">Título</th>
                  <th className="p-2 font-medium" title="MLBU = User Product (preço por variação). Família = agrupamento de produtos no modelo MLBU.">
                    Modelo / Família
                  </th>
                  <th className="p-2 font-medium">Var.</th>
                  <th className="p-2 font-medium" title="SKU do atributo SELLER_SKU. Itens: Anúncio → Atributos do produto. Variações: atributo SELLER_SKU em cada variação.">
                    SKU
                  </th>
                  <th className="p-2 font-medium">Preço R$</th>
                  <th className="p-2 font-medium">Competitividade</th>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <th key={i} colSpan={2} className="whitespace-nowrap p-2 font-medium text-center">
                      T{i}
                    </th>
                  ))}
                  <th className="p-2 font-medium">Status</th>
                  <th className="p-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {rowSections.map((section) => {
                  if (section.type === "family") {
                    const expanded = isFamilyExpanded(section.familyId);
                    return (
                      <React.Fragment key={section.familyId}>
                        <tr className="border-b border-slate-200 bg-slate-100">
                          <td colSpan={TABLE_COL_COUNT} className="p-2">
                            <button
                              type="button"
                              onClick={() => setFamilyExpanded(section.familyId, !expanded)}
                              className="flex items-center gap-2 text-left font-medium text-slate-800 hover:bg-slate-200 rounded px-1 py-0.5 -mx-1"
                            >
                              <span className="text-slate-500 text-xs">{expanded ? "▼" : "▶"}</span>
                              Família: {section.familyName} ({section.rows.length} itens)
                            </button>
                          </td>
                        </tr>
                        {expanded &&
                          section.rows.map((r) => renderAtacadoRow(r, true))}
                        </React.Fragment>
                      );
                    }
                    return (
                      <React.Fragment key={`single-${section.rows[0] ? rowKey(section.rows[0]) : "s"}`}>
                        {section.rows.map((r) => renderAtacadoRow(r, false))}
                      </React.Fragment>
                    );
                  })}
              </tbody>
          </AppTable>

          {totalPages > 1 && (
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
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
                className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
          )}
        </>
      )}

      {receivableRowKey && (() => {
        const r = rows.find((x) => rowKey(x) === receivableRowKey);
        if (!r) return null;
        const cur = getEditState(r);
        const scenarios: { label: string; unitPrice: number }[] = [];
        const basePrice = r.current_price != null ? Number(r.current_price) : 0;
        if (basePrice > 0) scenarios.push({ label: "Base", unitPrice: basePrice });
        (cur.tiers ?? []).forEach((t, i) => {
          if (t && typeof t.min_qty === "number" && typeof t.price === "number" && t.price > 0) {
            scenarios.push({ label: `Tier ${i + 1} (${t.min_qty}+)`, unitPrice: t.price });
          }
        });
        return (
          <ReceivableModal
            open={true}
            onClose={() => setReceivableRowKey(null)}
            accountId={accountId}
            listingTypeId={r.listing_type_id ?? null}
            categoryId={r.category_id ?? null}
            scenarios={scenarios}
            onFetchFees={async (prices) => {
              const res = await fetch("/api/atacado/fees/simulate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  accountId,
                  item_id: r.item_id,
                  variation_id: r.variation_id,
                  listing_type_id: r.listing_type_id,
                  category_id: r.category_id ?? undefined,
                  prices,
                }),
              });
              const data = await res.json();
              if (!res.ok || !data.ok || !Array.isArray(data.results)) return null;
              return data.results as { price: number; fee: number; net: number }[];
            }}
          />
        );
      })()}

    </div>
  );
}

export default function AtacadoPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Carregando...</div>}>
      <AtacadoPageContent />
    </Suspense>
  );
}
