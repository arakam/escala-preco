"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { AppTable } from "@/components/AppTable";
import { OnboardingGate } from "@/components/OnboardingGate";
import { useOnboarding } from "@/contexts/onboarding-context";
import { Product, ProductInput, ProductListingStats, UnregisteredSku } from "@/lib/db/types";

interface ProductFormData {
  sku: string;
  title: string;
  description: string;
  ean: string;
  height: string;
  width: string;
  length: string;
  weight: string;
  cost_price: string;
  tax_percent: string;
  extra_fee_percent: string;
  fixed_expenses: string;
}

const emptyForm: ProductFormData = {
  sku: "",
  title: "",
  description: "",
  ean: "",
  height: "",
  width: "",
  length: "",
  weight: "",
  cost_price: "",
  tax_percent: "",
  extra_fee_percent: "",
  fixed_expenses: "",
};

type ViewMode = "products" | "stats" | "operational" | "taxes";

type FinanceOpRow = {
  category_key: string;
  label: string;
  examples: string;
  monthly_amount: number;
};

type FinanceTaxRow = {
  category_key: string;
  label: string;
  examples: string;
  percent: number;
};

function parsePtBrMoney(s: string): number {
  const t = s.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function parsePtBrPercent(s: string): number {
  const t = s.trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function ProdutosPageContent() {
  const { reload: reloadOnboarding } = useOnboarding();
  const [viewMode, setViewMode] = useState<ViewMode>("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [stats, setStats] = useState<ProductListingStats[]>([]);
  const [unregisteredSkus, setUnregisteredSkus] = useState<UnregisteredSku[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; imported?: number; errors?: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeMessage, setFinanceMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [opRows, setOpRows] = useState<FinanceOpRow[]>([]);
  const [opInputs, setOpInputs] = useState<Record<string, string>>({});
  const [opTotalMonthly, setOpTotalMonthly] = useState(0);
  const [savingOperational, setSavingOperational] = useState(false);
  const [taxRows, setTaxRows] = useState<FinanceTaxRow[]>([]);
  const [taxInputs, setTaxInputs] = useState<Record<string, string>>({});
  const [savingTaxes, setSavingTaxes] = useState(false);

  const [linking, setLinking] = useState(false);
  const [linkResult, setLinkResult] = useState<{
    items_linked: number;
    variations_linked: number;
    cache_refresh_ok?: boolean;
    cache_refresh_error?: string | null;
  } | null>(null);
  const [unregisteredModalOpen, setUnregisteredModalOpen] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
    if (search) params.set("search", search);

    const res = await fetch(`/api/products?${params}`);
    if (res.ok) {
      const data = await res.json();
      setProducts(data.products ?? []);
      setTotal(data.total ?? 0);
    }
    setLoading(false);
  }, [page, pageSize, search]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
    if (search) params.set("search", search);

    const res = await fetch(`/api/products/stats?${params}`);
    if (res.ok) {
      const data = await res.json();
      setStats(data.stats ?? []);
      setTotal(data.total ?? 0);
    }
    setLoading(false);
  }, [page, pageSize, search]);

  const loadUnregisteredSkus = useCallback(async () => {
    const res = await fetch("/api/products/unregistered-skus?limit=50");
    if (res.ok) {
      const data = await res.json();
      setUnregisteredSkus(data.skus ?? []);
    }
  }, []);

  useEffect(() => {
    if (viewMode === "products") loadProducts();
    else if (viewMode === "stats") loadStats();
  }, [viewMode, loadProducts, loadStats]);

  const loadOperationalCosts = useCallback(async () => {
    setFinanceLoading(true);
    setFinanceMessage(null);
    try {
      const res = await fetch("/api/finance/operational-costs");
      const data = await res.json();
      if (!res.ok) {
        setFinanceMessage({ type: "error", text: data.error ?? "Erro ao carregar custos." });
        setOpRows([]);
        setOpInputs({});
        return;
      }
      const rows = (data.rows ?? []) as FinanceOpRow[];
      setOpRows(rows);
      setOpTotalMonthly(Number(data.total_monthly) || 0);
      setOpInputs(
        Object.fromEntries(
          rows.map((r) => [
            r.category_key,
            r.monthly_amount === 0 ? "" : String(r.monthly_amount).replace(".", ","),
          ])
        )
      );
    } catch {
      setFinanceMessage({ type: "error", text: "Erro de conexão ao carregar custos." });
    } finally {
      setFinanceLoading(false);
    }
  }, []);

  const loadTaxParameters = useCallback(async () => {
    setFinanceLoading(true);
    setFinanceMessage(null);
    try {
      const res = await fetch("/api/finance/tax-parameters");
      const data = await res.json();
      if (!res.ok) {
        setFinanceMessage({ type: "error", text: data.error ?? "Erro ao carregar impostos." });
        setTaxRows([]);
        setTaxInputs({});
        return;
      }
      const rows = (data.rows ?? []) as FinanceTaxRow[];
      setTaxRows(rows);
      setTaxInputs(
        Object.fromEntries(
          rows.map((r) => [
            r.category_key,
            r.percent === 0 ? "" : String(r.percent).replace(".", ","),
          ])
        )
      );
    } catch {
      setFinanceMessage({ type: "error", text: "Erro de conexão ao carregar impostos." });
    } finally {
      setFinanceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewMode === "operational") void loadOperationalCosts();
    else if (viewMode === "taxes") void loadTaxParameters();
  }, [viewMode, loadOperationalCosts, loadTaxParameters]);

  useEffect(() => {
    loadUnregisteredSkus();
  }, [loadUnregisteredSkus]);

  async function handleSaveOperational() {
    setSavingOperational(true);
    setFinanceMessage(null);
    const rows: { category_key: string; monthly_amount: number }[] = [];
    for (const r of opRows) {
      const raw = opInputs[r.category_key] ?? "";
      const n = parsePtBrMoney(raw);
      if (Number.isNaN(n)) {
        setFinanceMessage({
          type: "error",
          text: `Valor inválido em «${r.label}». Use números (ex.: 1500 ou 1.500,50).`,
        });
        setSavingOperational(false);
        return;
      }
      rows.push({ category_key: r.category_key, monthly_amount: n });
    }
    try {
      const res = await fetch("/api/finance/operational-costs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFinanceMessage({ type: "error", text: data.error ?? "Erro ao salvar." });
        return;
      }
      setFinanceMessage({ type: "success", text: "Custos operacionais salvos." });
      await loadOperationalCosts();
    } catch {
      setFinanceMessage({ type: "error", text: "Erro de conexão ao salvar." });
    } finally {
      setSavingOperational(false);
    }
  }

  async function handleSaveTaxes() {
    setSavingTaxes(true);
    setFinanceMessage(null);
    const rows: { category_key: string; percent: number }[] = [];
    for (const r of taxRows) {
      const raw = taxInputs[r.category_key] ?? "";
      const n = parsePtBrPercent(raw);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        setFinanceMessage({
          type: "error",
          text: `Percentual inválido (0–100) em «${r.label}».`,
        });
        setSavingTaxes(false);
        return;
      }
      rows.push({ category_key: r.category_key, percent: n });
    }
    try {
      const res = await fetch("/api/finance/tax-parameters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFinanceMessage({ type: "error", text: data.error ?? "Erro ao salvar." });
        return;
      }
      setFinanceMessage({ type: "success", text: "Parâmetros de impostos salvos." });
      await loadTaxParameters();
    } catch {
      setFinanceMessage({ type: "error", text: "Erro de conexão ao salvar." });
    } finally {
      setSavingTaxes(false);
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  function openNewProduct() {
    setEditingProduct(null);
    setForm(emptyForm);
    setFormError(null);
    setModalOpen(true);
  }

  function openEditProduct(product: Product) {
    setEditingProduct(product);
    setForm({
      sku: product.sku,
      title: product.title,
      description: product.description ?? "",
      ean: product.ean ?? "",
      height: product.height?.toString() ?? "",
      width: product.width?.toString() ?? "",
      length: product.length?.toString() ?? "",
      weight: product.weight?.toString() ?? "",
      cost_price: product.cost_price?.toString() ?? "",
      tax_percent: product.tax_percent?.toString() ?? "",
      extra_fee_percent: product.extra_fee_percent?.toString() ?? "",
      fixed_expenses: product.fixed_expenses?.toString() ?? "",
    });
    setFormError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingProduct(null);
    setForm(emptyForm);
    setFormError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.sku.trim()) {
      setFormError("SKU é obrigatório");
      return;
    }

    setSaving(true);
    setFormError(null);

    const payload: ProductInput = {
      sku: form.sku.trim(),
      title: form.title.trim() || form.sku.trim(),
      description: form.description.trim() || null,
      ean: form.ean.trim() || null,
      height: form.height ? parseFloat(form.height.replace(",", ".")) : null,
      width: form.width ? parseFloat(form.width.replace(",", ".")) : null,
      length: form.length ? parseFloat(form.length.replace(",", ".")) : null,
      weight: form.weight ? parseFloat(form.weight.replace(",", ".")) : null,
      cost_price: form.cost_price ? parseFloat(form.cost_price.replace(",", ".")) : null,
      tax_percent: form.tax_percent ? parseFloat(form.tax_percent.replace(",", ".")) : null,
      extra_fee_percent: form.extra_fee_percent ? parseFloat(form.extra_fee_percent.replace(",", ".")) : null,
      fixed_expenses: form.fixed_expenses ? parseFloat(form.fixed_expenses.replace(",", ".")) : null,
    };

    try {
      const url = editingProduct ? `/api/products/${editingProduct.id}` : "/api/products";
      const method = editingProduct ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setFormError(data.error || "Erro ao salvar produto");
        setSaving(false);
        return;
      }

      closeModal();
      loadProducts();
      reloadOnboarding();
    } catch {
      setFormError("Erro de conexão");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    setDeleting(true);

    try {
      const res = await fetch(`/api/products/${deleteConfirm.id}`, { method: "DELETE" });
      if (res.ok) {
        setDeleteConfirm(null);
        loadProducts();
        reloadOnboarding();
      }
    } catch {
      // ignore
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeleteAll() {
    setDeletingAll(true);

    try {
      const res = await fetch("/api/products", { method: "DELETE" });
      if (res.ok) {
        setDeleteAllOpen(false);
        setPage(1);
        loadProducts();
        reloadOnboarding();
      }
    } catch {
      // ignore
    } finally {
      setDeletingAll(false);
    }
  }

  async function handleExport() {
    window.location.href = "/api/products/export";
  }

  async function handleLinkSkus() {
    setLinking(true);
    setLinkResult(null);

    try {
      const res = await fetch("/api/products/link", { method: "POST" });
      const data = await res.json();

      if (res.ok) {
        setLinkResult({
          items_linked: data.items_linked,
          variations_linked: data.variations_linked,
          cache_refresh_ok: data.cache_refresh?.ok ?? true,
          cache_refresh_error: data.cache_refresh?.error ?? null,
        });
        if (viewMode === "stats") {
          loadStats();
        }
        loadUnregisteredSkus();
      }
    } catch {
      // ignore
    } finally {
      setLinking(false);
    }
  }

  function openNewProductFromSku(sku: string, title?: string | null) {
    setEditingProduct(null);
    setForm({
      ...emptyForm,
      sku,
      title: title ?? "",
    });
    setFormError(null);
    setUnregisteredModalOpen(false);
    setModalOpen(true);
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("mode", "upsert");

    try {
      const res = await fetch("/api/products/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (res.ok) {
        setImportResult({ success: true, imported: data.imported, errors: data.errors });
        loadProducts();
        reloadOnboarding();
      } else {
        setImportResult({ success: false, errors: [data.error || "Erro ao importar"] });
      }
    } catch {
      setImportResult({ success: false, errors: ["Erro de conexão"] });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="rounded-app bg-white/90 p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800/90 dark:ring-slate-600">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50 sm:text-xl">Cadastro de Produtos</h1>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 sm:text-sm">
            Organize seus produtos, custos e parâmetros usados nas demais telas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {unregisteredSkus.length > 0 && (
            <button
              type="button"
              onClick={() => setUnregisteredModalOpen(true)}
              className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"
            >
              {unregisteredSkus.length} SKU(s) não cadastrado(s)
            </button>
          )}
          <button
            type="button"
            onClick={handleLinkSkus}
            disabled={linking}
            className="rounded border border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
          >
            {linking ? "Vinculando…" : "Vincular SKUs"}
          </button>
          {viewMode === "products" && (
            <>
              <button
                type="button"
                onClick={() => setImportModalOpen(true)}
                className="btn btn-secondary px-4 py-2 text-sm"
              >
                Importar CSV
              </button>
              <button
                type="button"
                onClick={handleExport}
                className="btn btn-secondary px-4 py-2 text-sm"
              >
                Exportar CSV
              </button>
              <button
                type="button"
                onClick={() => setDeleteAllOpen(true)}
                className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
              >
                Excluir todos os produtos
              </button>
              <button
                type="button"
                onClick={openNewProduct}
                className="rounded bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark"
              >
                Novo Produto
              </button>
            </>
          )}
        </div>
      </div>

      {linkResult && (
        <div
          className={`mb-4 rounded p-3 text-sm ${
            linkResult.cache_refresh_ok === false
              ? "bg-amber-50 text-amber-800"
              : "bg-green-50 text-green-700"
          }`}
        >
          Vinculação concluída: {linkResult.items_linked} anúncio(s) e {linkResult.variations_linked} variação(ões) vinculados.
          {linkResult.cache_refresh_ok === false ? (
            <span className="ml-1">
              O cache da Calculadora de Preços não atualizou automaticamente ({linkResult.cache_refresh_error ?? "erro"}). Atualize em{" "}
              <code>Preços &gt; Ações &gt; Atualizar dados</code>.
            </span>
          ) : (
            <span className="ml-1">A Calculadora de Preços já foi atualizada com os novos vínculos.</span>
          )}
          <button
            type="button"
            onClick={() => setLinkResult(null)}
            className="ml-2 underline hover:no-underline"
          >
            Fechar
          </button>
        </div>
      )}

      <div className="mb-4 mt-2 flex gap-2 border-b border-slate-200 dark:border-slate-600">
        <button
          type="button"
          onClick={() => {
            setViewMode("products");
            setPage(1);
          }}
          className={`px-4 py-2 text-sm font-medium ${
            viewMode === "products"
              ? "border-b-2 border-brand-blue text-brand-blue"
              : "text-fg hover:text-fg-strong"
          }`}
        >
          Produtos
        </button>
        <button
          type="button"
          onClick={() => {
            setViewMode("stats");
            setPage(1);
          }}
          className={`px-4 py-2 text-sm font-medium ${
            viewMode === "stats"
              ? "border-b-2 border-brand-blue text-brand-blue"
              : "text-fg hover:text-fg-strong"
          }`}
        >
          Estatísticas de Anúncios
        </button>
        <button
          type="button"
          onClick={() => setViewMode("operational")}
          className={`px-4 py-2 text-sm font-medium ${
            viewMode === "operational"
              ? "border-b-2 border-brand-blue text-brand-blue"
              : "text-fg hover:text-fg-strong"
          }`}
        >
          Custos Operacionais
        </button>
        <button
          type="button"
          onClick={() => setViewMode("taxes")}
          className={`px-4 py-2 text-sm font-medium ${
            viewMode === "taxes"
              ? "border-b-2 border-brand-blue text-brand-blue"
              : "text-fg hover:text-fg-strong"
          }`}
        >
          Impostos
        </button>
      </div>

      {(viewMode === "products" || viewMode === "stats") && (
      <form onSubmit={handleSearchSubmit} className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-1 items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 ring-1 ring-slate-200">
          <span className="text-xs text-slate-500 dark:text-slate-400">Buscar</span>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="SKU ou título…"
            className="h-7 flex-1 border-0 bg-transparent text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
        >
          Aplicar filtros
        </button>
        {search && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setSearchInput("");
              setPage(1);
            }}
            className="text-xs font-medium text-slate-500 dark:text-slate-400 underline-offset-4 hover:text-slate-800 dark:text-slate-100 hover:underline"
          >
            Limpar
          </button>
        )}
      </form>
      )}

      {loading && (viewMode === "products" || viewMode === "stats") ? (
        <p className="text-fg-muted">Carregando…</p>
      ) : viewMode === "products" ? (
        products.length === 0 ? (
          <p className="text-fg-muted">
            Nenhum produto cadastrado. Clique em &quot;Novo Produto&quot; ou importe via CSV.
          </p>
        ) : (
          <>
            <AppTable
              summary={`${total} produto(s) — página ${page} de ${totalPages || 1}`}
              maxHeight="70vh"
            >
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    SKU
                  </th>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Título
                  </th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Custo (R$)
                  </th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Imposto (%)
                  </th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Taxa Extra (%)
                  </th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Desp. Fixas (R$)
                  </th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Altura (cm)
                  </th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Largura (cm)
                  </th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Comprimento (cm)
                  </th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Peso (kg)
                  </th>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Criado em
                  </th>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr
                    key={product.id}
                    className="border-b border-slate-100 bg-white/50 hover:bg-primary/5 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:bg-primary/10"
                  >
                    <td className="p-2 font-mono text-xs text-slate-700 dark:text-slate-200">{product.sku}</td>
                    <td className="max-w-[240px] p-2" title={product.title}>
                      <span className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-50">
                        {product.title}
                      </span>
                    </td>
                    <td className="p-2 text-right text-sm text-slate-700 dark:text-slate-200">
                      {product.cost_price != null ? Number(product.cost_price).toFixed(2) : "—"}
                    </td>
                    <td className="p-2 text-right text-sm text-slate-700 dark:text-slate-200">
                      {product.tax_percent != null ? Number(product.tax_percent).toFixed(2) : "—"}
                    </td>
                    <td className="p-2 text-right text-sm text-slate-700 dark:text-slate-200">
                      {product.extra_fee_percent != null ? Number(product.extra_fee_percent).toFixed(2) : "—"}
                    </td>
                    <td className="p-2 text-right text-sm text-slate-700 dark:text-slate-200">
                      {product.fixed_expenses != null ? Number(product.fixed_expenses).toFixed(2) : "—"}
                    </td>
                    <td className="p-2 text-right text-sm text-slate-700 dark:text-slate-200">
                      {product.height ?? "—"}
                    </td>
                    <td className="p-2 text-right text-sm text-slate-700 dark:text-slate-200">
                      {product.width ?? "—"}
                    </td>
                    <td className="p-2 text-right text-sm text-slate-700 dark:text-slate-200">
                      {product.length ?? "—"}
                    </td>
                    <td className="p-2 text-right text-sm text-slate-700 dark:text-slate-200">
                      {product.weight ?? "—"}
                    </td>
                    <td className="p-2 text-xs text-slate-500 dark:text-slate-400">
                      {new Date(product.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openEditProduct(product)}
                          className="text-sm text-brand-blue hover:underline"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm(product)}
                          className="text-sm text-red-600 hover:underline"
                        >
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </AppTable>

            {totalPages > 1 && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Mostrando página {page} de {totalPages} · {total} produto(s)
                </p>
                <div className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 text-xs ring-1 ring-slate-200">
                  <button
                    type="button"
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                    className="rounded-full px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    «
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-full px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <span className="px-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
                    {page}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="rounded-full px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Próxima
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages}
                    className="rounded-full px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    »
                  </button>
                </div>
              </div>
            )}
          </>
        )
      ) : viewMode === "stats" ? (
        stats.length === 0 ? (
        <p className="text-fg-muted">
          Nenhum produto com anúncios vinculados. Clique em &quot;Vincular SKUs&quot; para associar automaticamente.
        </p>
        ) : (
        <>
          <AppTable
            summary={`${total} produto(s) com anúncios — página ${page} de ${totalPages || 1}`}
            maxHeight="70vh"
          >
            <thead className="bg-slate-50">
              <tr>
                <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  SKU
                </th>
                <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Título
                </th>
                <th className="p-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Anúncios
                </th>
                <th className="p-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Variações
                </th>
                <th className="p-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Total
                </th>
                <th className="p-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Ativos
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Preço Mín
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Preço Máx
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Preço Médio
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Custo
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Estoque
                </th>
                <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Vendidos
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.map((stat) => (
                <tr
                  key={stat.product_id}
                  className="border-b border-slate-100 bg-white/50 hover:bg-primary/5 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:bg-primary/10"
                >
                  <td className="p-2 font-mono text-xs text-slate-700 dark:text-slate-200">{stat.sku}</td>
                  <td className="max-w-[200px] p-2" title={stat.title}>
                    <span className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-50">
                      {stat.title}
                    </span>
                  </td>
                  <td className="p-2 text-center">{stat.total_items}</td>
                  <td className="p-2 text-center">{stat.total_variations}</td>
                  <td className="p-2 text-center font-semibold">{stat.total_listings}</td>
                  <td className="p-2 text-center">
                    <span className={stat.active_items > 0 ? "text-green-600" : "text-fg-muted"}>
                      {stat.active_items + stat.active_variations}
                    </span>
                  </td>
                  <td className="p-2 text-right">
                    {stat.min_item_price != null ? `R$ ${Number(stat.min_item_price).toFixed(2)}` : "—"}
                  </td>
                  <td className="p-2 text-right">
                    {stat.max_item_price != null ? `R$ ${Number(stat.max_item_price).toFixed(2)}` : "—"}
                  </td>
                  <td className="p-2 text-right">
                    {stat.avg_item_price != null ? `R$ ${Number(stat.avg_item_price).toFixed(2)}` : "—"}
                  </td>
                  <td className="p-2 text-right text-fg">
                    {stat.cost_price != null ? `R$ ${Number(stat.cost_price).toFixed(2)}` : "—"}
                  </td>
                  <td className="p-2 text-right">{stat.total_available_qty}</td>
                  <td className="p-2 text-right text-green-600">{stat.total_sold_qty}</td>
                </tr>
              ))}
            </tbody>
          </AppTable>

          {totalPages > 1 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Mostrando página {page} de {totalPages} · {total} produto(s) com anúncios
              </p>
              <div className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 text-xs ring-1 ring-slate-200">
                <button
                  type="button"
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="rounded-full px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  «
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-full px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Anterior
                </button>
                <span className="px-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
                  {page}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-full px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Próxima
                </button>
                <button
                  type="button"
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  className="rounded-full px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  »
                </button>
              </div>
            </div>
          )}
        </>
        )
      ) : viewMode === "operational" ? (
        financeLoading ? (
          <p className="text-fg-muted">Carregando custos…</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Informe o valor <span className="font-medium">mensal estimado</span> de cada custo operacional da empresa.
              Os dados serão usados nas análises e telas futuras.
            </p>
            {financeMessage && (
              <div
                className={`rounded-lg px-3 py-2 text-sm ${
                  financeMessage.type === "success"
                    ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-200"
                    : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200"
                }`}
              >
                {financeMessage.text}
              </div>
            )}
            <AppTable summary="Custos operacionais (R$ / mês)" maxHeight="min(70vh, 32rem)">
              <thead className="bg-slate-50 dark:bg-slate-800/80">
                <tr>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Categoria
                  </th>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Exemplos
                  </th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Valor mensal (R$)
                  </th>
                </tr>
              </thead>
              <tbody>
                {opRows.map((r) => (
                  <tr
                    key={r.category_key}
                    className="border-b border-slate-100 bg-white/50 dark:border-slate-700 dark:bg-slate-800/40"
                  >
                    <td className="p-2 text-sm font-medium text-slate-900 dark:text-slate-50">{r.label}</td>
                    <td className="max-w-md p-2 text-xs text-slate-600 dark:text-slate-400">{r.examples}</td>
                    <td className="p-2 text-right">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={opInputs[r.category_key] ?? ""}
                        onChange={(e) =>
                          setOpInputs((prev) => ({ ...prev, [r.category_key]: e.target.value }))
                        }
                        placeholder="0,00"
                        className="input w-36 py-1.5 text-right text-sm"
                        aria-label={`Valor mensal ${r.label}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </AppTable>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-600">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                Total mensal (estimado):{" "}
                <span className="tabular-nums text-brand-blue">
                  R$ {opTotalMonthly.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                  (atualizado após salvar)
                </span>
              </p>
              <button
                type="button"
                onClick={() => void handleSaveOperational()}
                disabled={savingOperational}
                className="rounded bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
              >
                {savingOperational ? "Salvando…" : "Salvar custos operacionais"}
              </button>
            </div>
          </div>
        )
      ) : viewMode === "taxes" ? (
        financeLoading ? (
          <p className="text-fg-muted">Carregando impostos…</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Cadastre <span className="font-medium">percentuais de referência</span> da sua carga tributária (empresa).
              Isso complementa o campo <span className="font-medium">Imposto (%)</span> de cada produto na aba Produtos.
            </p>
            {financeMessage && (
              <div
                className={`rounded-lg px-3 py-2 text-sm ${
                  financeMessage.type === "success"
                    ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-200"
                    : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200"
                }`}
              >
                {financeMessage.text}
              </div>
            )}
            <AppTable summary="Impostos e contribuições (%)" maxHeight="min(70vh, 28rem)">
              <thead className="bg-slate-50 dark:bg-slate-800/80">
                <tr>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Categoria
                  </th>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Exemplos
                  </th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    % (referência)
                  </th>
                </tr>
              </thead>
              <tbody>
                {taxRows.map((r) => (
                  <tr
                    key={r.category_key}
                    className="border-b border-slate-100 bg-white/50 dark:border-slate-700 dark:bg-slate-800/40"
                  >
                    <td className="p-2 text-sm font-medium text-slate-900 dark:text-slate-50">{r.label}</td>
                    <td className="max-w-md p-2 text-xs text-slate-600 dark:text-slate-400">{r.examples}</td>
                    <td className="p-2 text-right">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={taxInputs[r.category_key] ?? ""}
                        onChange={(e) =>
                          setTaxInputs((prev) => ({ ...prev, [r.category_key]: e.target.value }))
                        }
                        placeholder="0,00"
                        className="input w-28 py-1.5 text-right text-sm"
                        aria-label={`Percentual ${r.label}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </AppTable>
            <div className="flex justify-end border-t border-slate-200 pt-4 dark:border-slate-600">
              <button
                type="button"
                onClick={() => void handleSaveTaxes()}
                disabled={savingTaxes}
                className="rounded bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
              >
                {savingTaxes ? "Salvando…" : "Salvar impostos"}
              </button>
            </div>
          </div>
        )
      ) : null}

      {/* Modal: Novo/Editar Produto */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={closeModal}
          role="dialog"
          aria-modal="true"
          aria-label={editingProduct ? "Editar Produto" : "Novo Produto"}
        >
          <div
            className="w-full max-w-lg rounded-lg border border-stroke bg-card shadow-xl dark:border-slate-600"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stroke p-4 dark:border-slate-600">
              <h2 className="text-lg font-semibold text-fg-strong">
                {editingProduct ? "Editar Produto" : "Novo Produto"}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="rounded p-1 text-fg-muted hover:bg-gray-100 hover:text-fg dark:hover:bg-slate-700"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSave} className="p-4">
              {formError && (
                <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{formError}</div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-1">
                  <label className="mb-1 block text-sm font-medium text-fg">
                    SKU <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    className="input w-full py-2 text-sm focus:border-brand-blue focus:ring-brand-blue dark:focus:border-brand-blue-light dark:focus:ring-brand-blue-light"
                    required
                  />
                </div>
                <div className="col-span-1">
                  <label className="mb-1 block text-sm font-medium text-fg">Título</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="input w-full py-2 text-sm focus:border-brand-blue focus:ring-brand-blue dark:focus:border-brand-blue-light dark:focus:ring-brand-blue-light"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Altura (cm)</label>
                  <input
                    type="text"
                    value={form.height}
                    onChange={(e) => setForm({ ...form, height: e.target.value })}
                    placeholder="0,00"
                    className="input w-full py-2 text-sm focus:border-brand-blue focus:ring-brand-blue dark:focus:border-brand-blue-light dark:focus:ring-brand-blue-light"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Largura (cm)</label>
                  <input
                    type="text"
                    value={form.width}
                    onChange={(e) => setForm({ ...form, width: e.target.value })}
                    placeholder="0,00"
                    className="input w-full py-2 text-sm focus:border-brand-blue focus:ring-brand-blue dark:focus:border-brand-blue-light dark:focus:ring-brand-blue-light"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Comprimento (cm)</label>
                  <input
                    type="text"
                    value={form.length}
                    onChange={(e) => setForm({ ...form, length: e.target.value })}
                    placeholder="0,00"
                    className="input w-full py-2 text-sm focus:border-brand-blue focus:ring-brand-blue dark:focus:border-brand-blue-light dark:focus:ring-brand-blue-light"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Peso (kg)</label>
                  <input
                    type="text"
                    value={form.weight}
                    onChange={(e) => setForm({ ...form, weight: e.target.value })}
                    placeholder="0,000"
                    className="input w-full py-2 text-sm focus:border-brand-blue focus:ring-brand-blue dark:focus:border-brand-blue-light dark:focus:ring-brand-blue-light"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Preço de Custo (R$)</label>
                  <input
                    type="text"
                    value={form.cost_price}
                    onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                    placeholder="0,00"
                    className="input w-full py-2 text-sm focus:border-brand-blue focus:ring-brand-blue dark:focus:border-brand-blue-light dark:focus:ring-brand-blue-light"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Imposto (%)</label>
                  <input
                    type="text"
                    value={form.tax_percent}
                    onChange={(e) => setForm({ ...form, tax_percent: e.target.value })}
                    placeholder="0,00"
                    className="input w-full py-2 text-sm focus:border-brand-blue focus:ring-brand-blue dark:focus:border-brand-blue-light dark:focus:ring-brand-blue-light"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Taxa Extra (%)</label>
                  <input
                    type="text"
                    value={form.extra_fee_percent}
                    onChange={(e) => setForm({ ...form, extra_fee_percent: e.target.value })}
                    placeholder="0,00"
                    className="input w-full py-2 text-sm focus:border-brand-blue focus:ring-brand-blue dark:focus:border-brand-blue-light dark:focus:ring-brand-blue-light"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Desp. Fixas (R$)</label>
                  <input
                    type="text"
                    value={form.fixed_expenses}
                    onChange={(e) => setForm({ ...form, fixed_expenses: e.target.value })}
                    placeholder="0,00"
                    className="input w-full py-2 text-sm focus:border-brand-blue focus:ring-brand-blue dark:focus:border-brand-blue-light dark:focus:ring-brand-blue-light"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="btn btn-secondary px-4 py-2 text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
                >
                  {saving ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirmar exclusão */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setDeleteConfirm(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar exclusão"
        >
          <div
            className="w-full max-w-sm rounded-lg border border-stroke bg-card p-6 shadow-xl dark:border-slate-600"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold text-fg-strong">Excluir Produto</h2>
            <p className="mb-6 text-sm text-fg">
              Tem certeza que deseja excluir o produto <strong>{deleteConfirm.sku}</strong>?
              Esta ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="btn btn-secondary px-4 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Excluindo…" : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmar exclusão em massa */}
      {deleteAllOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setDeleteAllOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar exclusão de todos os produtos"
        >
          <div
            className="w-full max-w-sm rounded-lg border border-stroke bg-card p-6 shadow-xl dark:border-slate-600"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold text-fg-strong">Excluir todos os produtos</h2>
            <p className="mb-3 text-sm text-fg font-medium">
              Esta ação irá remover <span className="font-semibold">todos os produtos da sua base</span>.
            </p>
            <p className="mb-4 text-sm text-fg">
              Os anúncios do Mercado Livre <span className="font-semibold">não serão apagados</span>, apenas ficarão
              <span className="font-semibold"> desvinculados dos produtos</span>.
            </p>
            <p className="mb-6 text-xs text-fg-muted">
              Depois você poderá importar ou vincular novamente os produtos a partir dos anúncios.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteAllOpen(false)}
                className="btn btn-secondary px-4 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteAll}
                disabled={deletingAll}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deletingAll ? "Excluindo…" : "Excluir tudo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Importar CSV */}
      {importModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => {
            setImportModalOpen(false);
            setImportResult(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Importar CSV"
        >
          <div
            className="w-full max-w-md rounded-lg border border-stroke bg-card shadow-xl dark:border-slate-600"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stroke p-4 dark:border-slate-600">
              <h2 className="text-lg font-semibold text-fg-strong">Importar Produtos via CSV</h2>
              <button
                type="button"
                onClick={() => {
                  setImportModalOpen(false);
                  setImportResult(null);
                }}
                className="rounded p-1 text-fg-muted hover:bg-gray-100 hover:text-fg dark:hover:bg-slate-700"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleImport} className="p-4">
              <p className="mb-4 text-sm text-fg">
                O arquivo CSV deve conter a coluna <strong>SKU</strong> (obrigatório),
                e opcionalmente: Titulo, Altura, Largura, Comprimento, Peso, PrecoCusto, Imposto, TaxaExtra, DespFixas.
              </p>
              <p className="mb-4 text-sm text-fg">
                Produtos com SKU existente serão atualizados.
              </p>
              <a
                href="/api/products/template"
                download="modelo_produtos.csv"
                className="btn btn-secondary mb-4 inline-flex items-center gap-2"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Baixar modelo CSV
              </a>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="input mb-4 w-full py-2 text-sm"
                required
              />

              {importResult && (
                <div
                  className={`mb-4 rounded p-3 text-sm ${
                    importResult.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                  }`}
                >
                  {importResult.success ? (
                    <p>{importResult.imported} produto(s) importado(s) com sucesso!</p>
                  ) : (
                    <p>{importResult.errors?.[0] || "Erro ao importar"}</p>
                  )}
                  {importResult.errors && importResult.errors.length > 0 && importResult.success && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-amber-700">
                        {importResult.errors.length} aviso(s)
                      </summary>
                      <ul className="mt-1 list-inside list-disc text-xs">
                        {importResult.errors.slice(0, 10).map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setImportModalOpen(false);
                    setImportResult(null);
                  }}
                  className="btn btn-secondary px-4 py-2 text-sm"
                >
                  Fechar
                </button>
                <button
                  type="submit"
                  disabled={importing}
                  className="rounded bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
                >
                  {importing ? "Importando…" : "Importar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: SKUs não cadastrados */}
      {unregisteredModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setUnregisteredModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="SKUs não cadastrados"
        >
          <div
            className="w-full max-w-2xl rounded-lg border border-stroke bg-card shadow-xl dark:border-slate-600"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stroke p-4 dark:border-slate-600">
              <h2 className="text-lg font-semibold text-fg-strong">
                SKUs encontrados em anúncios sem produto cadastrado
              </h2>
              <button
                type="button"
                onClick={() => setUnregisteredModalOpen(false)}
                className="rounded p-1 text-fg-muted hover:bg-gray-100 hover:text-fg dark:hover:bg-slate-700"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-4">
              <p className="mb-4 text-sm text-fg">
                Estes SKUs foram encontrados no campo &quot;seller_custom_field&quot; dos seus anúncios,
                mas não possuem um produto cadastrado. Clique em um SKU para criar o produto.
              </p>
              {unregisteredSkus.length === 0 ? (
                <p className="text-fg-muted">Todos os SKUs já estão cadastrados!</p>
              ) : (
                <div className="space-y-2">
                  {unregisteredSkus.map((item) => (
                    <div
                      key={item.sku}
                      className="flex items-center justify-between rounded border border-stroke p-3 hover:bg-gray-50 dark:border-slate-600 dark:hover:bg-slate-700/50"
                    >
                      <div className="flex-1">
                        <span className="font-mono text-sm font-medium">{item.sku}</span>
                        {item.sample_title && (
                          <p className="mt-1 truncate text-xs text-fg-muted" title={item.sample_title}>
                            {item.sample_title}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
                          {item.listing_count} anúncio(s)
                        </span>
                        <button
                          type="button"
                          onClick={() => openNewProductFromSku(item.sku, item.sample_title)}
                          className="rounded bg-brand-blue px-3 py-1 text-xs font-medium text-white hover:bg-brand-blue-dark"
                        >
                          Cadastrar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end border-t border-stroke p-4 dark:border-slate-600">
              <button
                type="button"
                onClick={() => setUnregisteredModalOpen(false)}
                className="btn btn-secondary px-4 py-2 text-sm"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProdutosPage() {
  return (
    <OnboardingGate required="sync">
      <ProdutosPageContent />
    </OnboardingGate>
  );
}
