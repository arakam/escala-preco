"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { AppTable } from "@/components/AppTable";
import { ProductTagInput } from "@/components/ProductTagInput";
import { TablePageSizeSelect } from "@/components/TablePageSizeSelect";
import { OnboardingGate } from "@/components/OnboardingGate";
import {
  apiListPage,
  computeTotalPages,
  TABLE_PAGE_SIZE_OPTIONS,
} from "@/lib/table-pagination";
import { useOnboarding } from "@/contexts/onboarding-context";
import {
  Product,
  ProductInput,
  ProductListingStats,
  ProductTag,
  ProductTagWithCount,
  UnregisteredSku,
} from "@/lib/db/types";

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
  pma: string;
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
  pma: "",
};

type ViewMode = "products" | "stats" | "tags" | "unregistered" | "operational" | "taxes" | "howitworks";

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
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [filterTagIds, setFilterTagIds] = useState<string[]>([]);
  const [draftFilterTagIds, setDraftFilterTagIds] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<ProductTag[]>([]);
  const [tagsTabList, setTagsTabList] = useState<ProductTagWithCount[]>([]);
  const [tagsTabLoading, setTagsTabLoading] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [tagSaving, setTagSaving] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState("");
  const [tagsTabMessage, setTagsTabMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [formTagNames, setFormTagNames] = useState<string[]>([]);
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);
  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false);
  const optionsMenuRef = useRef<HTMLDivElement>(null);

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
  const [importResult, setImportResult] = useState<{
    success: boolean;
    imported?: number;
    parsed?: number;
    partial?: boolean;
    rows_with_tags_in_file?: number;
    tags_linked?: number;
    errors?: string[];
  } | null>(null);
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
  const [unregisteredLoading, setUnregisteredLoading] = useState(false);

  const loadAllTags = useCallback(async () => {
    try {
      const res = await fetch("/api/product-tags");
      if (res.ok) {
        const data = await res.json();
        const tags = (data.tags ?? []) as ProductTagWithCount[];
        setAllTags(tags);
        return tags;
      }
    } catch {
      // ignore
    }
    return [];
  }, []);

  const loadTagsTab = useCallback(async () => {
    setTagsTabLoading(true);
    try {
      const res = await fetch("/api/product-tags");
      if (res.ok) {
        const data = await res.json();
        const tags = (data.tags ?? []) as ProductTagWithCount[];
        setTagsTabList(tags);
        setAllTags(tags);
      }
    } finally {
      setTagsTabLoading(false);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(apiListPage(pageSize, page)),
      limit: String(pageSize),
    });
    if (search) params.set("search", search);
    if (filterTagIds.length > 0) params.set("tags", filterTagIds.join(","));

    const res = await fetch(`/api/products?${params}`);
    if (res.ok) {
      const data = await res.json();
      setProducts(data.products ?? []);
      setTotal(data.total ?? 0);
    }
    setLoading(false);
  }, [page, pageSize, search, filterTagIds]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(apiListPage(pageSize, page)),
      limit: String(pageSize),
    });
    if (search) params.set("search", search);
    if (filterTagIds.length > 0) params.set("tags", filterTagIds.join(","));

    const res = await fetch(`/api/products/stats?${params}`);
    if (res.ok) {
      const data = await res.json();
      setStats(data.stats ?? []);
      setTotal(data.total ?? 0);
    }
    setLoading(false);
  }, [page, pageSize, search, filterTagIds]);

  const loadUnregisteredSkus = useCallback(async () => {
    setUnregisteredLoading(true);
    try {
      const res = await fetch("/api/products/unregistered-skus?limit=200");
      if (res.ok) {
        const data = await res.json();
        setUnregisteredSkus(data.skus ?? []);
      }
    } finally {
      setUnregisteredLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllTags();
  }, [loadAllTags]);

  useEffect(() => {
    if (viewMode === "products") loadProducts();
    else if (viewMode === "stats") loadStats();
    else if (viewMode === "tags") void loadTagsTab();
  }, [viewMode, loadProducts, loadStats, loadTagsTab]);

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
    else if (viewMode === "unregistered") void loadUnregisteredSkus();
  }, [viewMode, loadOperationalCosts, loadTaxParameters, loadUnregisteredSkus]);

  const tagNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of allTags) m.set(t.id, t.name);
    return m;
  }, [allTags]);

  const appliedListFilters = useMemo(() => {
    const labels: string[] = [];
    if (search.trim()) labels.push(`Busca: ${search.trim()}`);
    for (const id of filterTagIds) {
      const name = tagNameById.get(id);
      if (name) labels.push(`Tag: ${name}`);
    }
    return labels;
  }, [search, filterTagIds, tagNameById]);

  useEffect(() => {
    if (!optionsMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (optionsMenuRef.current && !optionsMenuRef.current.contains(e.target as Node)) {
        setOptionsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [optionsMenuOpen]);

  const clearListFilters = useCallback(() => {
    setSearch("");
    setSearchInput("");
    setFilterTagIds([]);
    setDraftFilterTagIds([]);
    setPage(1);
    setFiltersModalOpen(false);
  }, []);

  const refreshListView = useCallback(() => {
    if (viewMode === "products") void loadProducts();
    else if (viewMode === "stats") void loadStats();
    else if (viewMode === "unregistered") void loadUnregisteredSkus();
  }, [viewMode, loadProducts, loadStats, loadUnregisteredSkus]);

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

  function openNewProduct() {
    setEditingProduct(null);
    setForm(emptyForm);
    setFormTagNames([]);
    setFormError(null);
    setModalOpen(true);
  }

  function openEditProduct(product: Product) {
    setEditingProduct(product);
    setFormTagNames((product.tags ?? []).map((t) => t.name));
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
      pma: product.pma?.toString() ?? "",
    });
    setFormError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingProduct(null);
    setForm(emptyForm);
    setFormTagNames([]);
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
      pma: form.pma ? parseFloat(form.pma.replace(",", ".")) : null,
      tag_names: formTagNames,
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
      void loadAllTags();
      void loadUnregisteredSkus();
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
        const totalLinked = Number(data.items_linked ?? 0) + Number(data.variations_linked ?? 0);
        if (totalLinked > 0) {
          try {
            sessionStorage.setItem("escalapreco_pricing_listings_stale", "1");
          } catch {
            // ignore (modo privado, storage cheio, etc.)
          }
        }
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
    setFormTagNames([]);
    setFormError(null);
    setModalOpen(true);
  }

  async function handleCreateTag() {
    const name = newTagName.trim();
    if (!name) return;
    setTagSaving(true);
    setTagsTabMessage(null);
    try {
      const res = await fetch("/api/product-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTagsTabMessage({ type: "error", text: data.error ?? "Erro ao criar tag" });
        return;
      }
      setNewTagName("");
      setTagsTabMessage({ type: "success", text: "Tag criada." });
      await loadTagsTab();
    } catch {
      setTagsTabMessage({ type: "error", text: "Erro de conexão ao criar tag" });
    } finally {
      setTagSaving(false);
    }
  }

  async function handleSaveTagRename(tagId: string) {
    const name = editingTagName.trim();
    if (!name) return;
    setTagSaving(true);
    setTagsTabMessage(null);
    try {
      const res = await fetch(`/api/product-tags/${tagId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json();
        setTagsTabMessage({ type: "error", text: data.error ?? "Erro ao renomear tag" });
        return;
      }
      setEditingTagId(null);
      setEditingTagName("");
      setTagsTabMessage({ type: "success", text: "Tag atualizada." });
      await loadTagsTab();
      if (viewMode === "products") void loadProducts();
      else if (viewMode === "stats") void loadStats();
    } catch {
      setTagsTabMessage({ type: "error", text: "Erro de conexão" });
    } finally {
      setTagSaving(false);
    }
  }

  async function handleDeleteTag(tagId: string, tagName: string) {
    if (!window.confirm(`Excluir a tag «${tagName}»? Ela será removida de todos os produtos.`)) return;
    setTagSaving(true);
    try {
      const res = await fetch(`/api/product-tags/${tagId}`, { method: "DELETE" });
      if (res.ok) {
        setFilterTagIds((prev) => prev.filter((id) => id !== tagId));
        await loadTagsTab();
        if (viewMode === "products") void loadProducts();
        else if (viewMode === "stats") void loadStats();
      }
    } finally {
      setTagSaving(false);
    }
  }

  function toggleDraftFilterTag(tagId: string) {
    setDraftFilterTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  }

  function applyListFilters(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput.trim());
    setFilterTagIds(draftFilterTagIds);
    setPage(1);
    setFiltersModalOpen(false);
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

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 5 * 60 * 1000);

    try {
      const res = await fetch("/api/products/import", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const raw = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        setImportResult({
          success: false,
          errors: [
            res.ok
              ? "Resposta inválida do servidor."
              : `Erro ${res.status}: resposta não é JSON.`,
          ],
        });
        return;
      }

      if (res.ok) {
        const errs = data.errors as string[] | undefined;
        setImportResult({
          success: data.success !== false,
          imported: data.imported as number | undefined,
          parsed: data.parsed as number | undefined,
          partial: data.partial as boolean | undefined,
          rows_with_tags_in_file: data.rows_with_tags_in_file as number | undefined,
          tags_linked: data.tags_linked as number | undefined,
          errors: errs,
        });
        void loadProducts();
        void loadAllTags();
        void loadUnregisteredSkus();
        reloadOnboarding();
      } else {
        const details = data.details as string[] | undefined;
        const main = (data.error as string) || "Erro ao importar";
        setImportResult({
          success: false,
          errors: details?.length ? [main, ...details.slice(0, 5)] : [main],
        });
      }
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      setImportResult({
        success: false,
        errors: [
          aborted
            ? "Importação cancelada ou expirou (arquivo muito grande). Tente dividir o CSV."
            : "Erro de conexão ao importar.",
        ],
      });
    } finally {
      window.clearTimeout(timeoutId);
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const totalPages = computeTotalPages(total, pageSize);

  return (
    <div className="adminty-produtos-page space-y-5">
      <div className="overflow-hidden rounded border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <div className="border-b border-slate-200 bg-white px-3 pt-3">
          <div className="flex flex-wrap items-end gap-1">
            <button
              type="button"
              onClick={() => {
                setViewMode("products");
                setPage(1);
              }}
              className={
                viewMode === "products"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-500 hover:text-slate-800"
              }
            >
              Produtos
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("stats");
                setPage(1);
              }}
              className={
                viewMode === "stats"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-500 hover:text-slate-800"
              }
            >
              Estatísticas
            </button>
            <button
              type="button"
              onClick={() => setViewMode("tags")}
              className={
                viewMode === "tags"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-500 hover:text-slate-800"
              }
            >
              Tags
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("unregistered");
                setPage(1);
              }}
              className={
                viewMode === "unregistered"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-500 hover:text-slate-800"
              }
            >
              Não Cadastrados
            </button>
            <button
              type="button"
              onClick={() => setViewMode("operational")}
              className={
                viewMode === "operational"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-500 hover:text-slate-800"
              }
            >
              Custos operacionais
            </button>
            <button
              type="button"
              onClick={() => setViewMode("taxes")}
              className={
                viewMode === "taxes"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-500 hover:text-slate-800"
              }
            >
              Impostos
            </button>
            <button
              type="button"
              onClick={() => setViewMode("howitworks")}
              className={
                viewMode === "howitworks"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-500 hover:text-slate-800"
              }
            >
              Como Funciona?
            </button>
          </div>
        </div>

        <div className="border-b border-slate-100 px-3 py-3">
          {(viewMode === "stats" ||
            viewMode === "tags" ||
            viewMode === "unregistered" ||
            viewMode === "operational" ||
            viewMode === "taxes" ||
            viewMode === "howitworks") && (
            <p className="mb-2 text-[11px] text-slate-500">
              {viewMode === "stats" && "Anúncios e vendas vinculados a cada SKU cadastrado."}
              {viewMode === "tags" &&
                "Crie e gerencie tags para classificar produtos. Use nos filtros de Produtos, Estatísticas e Preços."}
              {viewMode === "unregistered" &&
                "SKUs presentes nos anúncios (seller_custom_field) que ainda não têm produto cadastrado na base."}
              {viewMode === "operational" && "Valores mensais estimados de custos operacionais da empresa."}
              {viewMode === "taxes" && "Percentuais de referência da carga tributária; complementam o imposto por produto."}
              {viewMode === "howitworks" &&
                "Visão geral das abas desta página e de como produtos, anúncios e parâmetros alimentam a calculadora de preços."}
            </p>
          )}
          {viewMode !== "howitworks" && viewMode !== "tags" && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleLinkSkus()}
              disabled={linking}
              className="btn btn-success btn-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {linking ? "Vinculando…" : "Vincular SKUs"}
            </button>
            {viewMode === "products" && (
              <>
                <button
                  type="button"
                  onClick={() => setImportModalOpen(true)}
                  className="btn btn-secondary btn-sm"
                >
                  Importar CSV
                </button>
                <button type="button" onClick={() => setDeleteAllOpen(true)} className="btn btn-danger btn-sm">
                  Excluir todos
                </button>
                <button type="button" onClick={openNewProduct} className="btn btn-primary btn-sm">
                  Novo produto
                </button>
              </>
            )}
          </div>
          )}
        </div>

        {(viewMode === "products" || viewMode === "stats") && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[12px] text-slate-600">
              <span className="font-semibold text-slate-700">Filtros:</span>
              {appliedListFilters.length > 0 ? (
                appliedListFilters.map((label, idx) => (
                  <span
                    key={`${idx}-${label}`}
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                  >
                    {label}
                  </span>
                ))
              ) : (
                <span className="text-slate-500">Nenhum filtro aplicado</span>
              )}
              {appliedListFilters.length > 0 && (
                <button
                  type="button"
                  onClick={() => clearListFilters()}
                  className="text-[11px] font-semibold text-[#0d6efd] hover:underline"
                >
                  Limpar
                </button>
              )}
            </div>
            <div className="btn-dropdown relative flex items-center gap-1" ref={optionsMenuRef}>
              <button
                type="button"
                onClick={() => {
                  setSearchInput(search);
                  setDraftFilterTagIds(filterTagIds);
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
                onClick={() => setOptionsMenuOpen((o) => !o)}
                className="btn btn-icon btn-sm btn-outline-secondary"
                title="Opções"
                aria-label="Opções"
                aria-expanded={optionsMenuOpen}
              >
                <KebabMenuIcon />
              </button>
              {optionsMenuOpen && (
                <div className="btn-dropdown-menu right-0 top-9 z-20 w-52">
                  {viewMode === "products" && (
                    <button
                      type="button"
                      onClick={() => {
                        void handleExport();
                        setOptionsMenuOpen(false);
                      }}
                      className="btn-dropdown-item"
                    >
                      Exportar CSV
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      refreshListView();
                      setOptionsMenuOpen(false);
                    }}
                    className="btn-dropdown-item"
                  >
                    Atualizar tabela
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {linkResult && (
          <div
            className={`mx-3 mt-3 rounded p-3 text-sm ${
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

      {viewMode === "tags" ? (
        tagsTabLoading ? (
          <p className="p-3 text-sm text-slate-500">Carregando tags…</p>
        ) : (
          <div className="space-y-4 px-3 pb-4">
            <p className="text-sm text-slate-600">
              Tags ajudam a filtrar produtos e anúncios vinculados (ex.: <em>full</em>, <em>queima estoque</em>).
              Também podem ser definidas no formulário do produto ou na coluna <strong>Tags</strong> do CSV de importação.
            </p>
            {tagsTabMessage && (
              <div
                className={`rounded px-3 py-2 text-sm ${
                  tagsTabMessage.type === "success"
                    ? "bg-green-50 text-green-800"
                    : "bg-red-50 text-red-800"
                }`}
              >
                {tagsTabMessage.text}
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Nova tag
                </label>
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreateTag();
                    }
                  }}
                  placeholder="Ex.: full, queima estoque…"
                  className="input w-full py-2 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleCreateTag()}
                disabled={tagSaving || !newTagName.trim()}
                className="btn btn-primary btn-sm disabled:opacity-50"
              >
                {tagSaving ? "Salvando…" : "Criar tag"}
              </button>
            </div>
            {tagsTabList.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma tag cadastrada ainda.</p>
            ) : (
              <div className="adminty-table-card">
                <AppTable
                  maxHeight="min(60vh, 24rem)"
                  className="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none"
                  tableClassName="min-w-full text-left text-sm"
                >
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/95">Tag</th>
                      <th className="p-2 text-center text-xs font-semibold uppercase tracking-wide text-white/95">Produtos</th>
                      <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/95">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tagsTabList.map((tag) => (
                      <tr
                        key={tag.id}
                        className="border-b border-slate-100 bg-white/50 hover:bg-primary/5"
                      >
                        <td className="p-2">
                          {editingTagId === tag.id ? (
                            <input
                              type="text"
                              value={editingTagName}
                              onChange={(e) => setEditingTagName(e.target.value)}
                              className="input w-full max-w-xs py-1 text-sm"
                              autoFocus
                            />
                          ) : (
                            <span className="inline-flex rounded bg-[#0d6efd]/10 px-2 py-0.5 text-sm font-medium text-[#0d6efd]">
                              {tag.name}
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-center tabular-nums">{tag.product_count}</td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-2">
                            {editingTagId === tag.id ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleSaveTagRename(tag.id)}
                                  disabled={tagSaving}
                                  className="text-sm text-[#0d6efd] hover:underline disabled:opacity-50"
                                >
                                  Salvar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTagId(null);
                                    setEditingTagName("");
                                  }}
                                  className="text-sm text-slate-600 hover:underline"
                                >
                                  Cancelar
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTagId(tag.id);
                                    setEditingTagName(tag.name);
                                  }}
                                  className="text-sm text-[#0d6efd] hover:underline"
                                >
                                  Renomear
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteTag(tag.id, tag.name)}
                                  disabled={tagSaving}
                                  className="text-sm text-red-600 hover:underline disabled:opacity-50"
                                >
                                  Excluir
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </AppTable>
              </div>
            )}
          </div>
        )
      ) : viewMode === "unregistered" ? (
        unregisteredLoading ? (
          <p className="p-3 text-sm text-slate-500">Carregando…</p>
        ) : unregisteredSkus.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-slate-500">
            Todos os SKUs dos anúncios já estão cadastrados como produtos.
          </p>
        ) : (
          <div className="space-y-4 px-3 pb-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Estes SKUs foram encontrados no campo &quot;seller_custom_field&quot; dos seus anúncios, mas não possuem um
              produto cadastrado. Clique em &quot;Cadastrar&quot; para abrir o formulário com o SKU preenchido.
            </p>
            <div className="space-y-2">
              {unregisteredSkus.map((item) => (
                <div
                  key={item.sku}
                  className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-600 dark:bg-slate-800/40"
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">{item.sku}</span>
                    {item.sample_title && (
                      <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400" title={item.sample_title}>
                        {item.sample_title}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                      {item.listing_count} anúncio(s)
                    </span>
                    <button
                      type="button"
                      onClick={() => openNewProductFromSku(item.sku, item.sample_title)}
                      className="rounded bg-[#0d6efd] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0b5ed7]"
                    >
                      Cadastrar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ) : loading && (viewMode === "products" || viewMode === "stats") ? (
        <p className="p-3 text-sm text-slate-500">Carregando…</p>
      ) : viewMode === "products" ? (
        products.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-slate-500">
            Nenhum produto cadastrado. Use &quot;Novo produto&quot; ou importe via CSV.
          </p>
        ) : (
          <div className="adminty-table-card">
            <div className="mb-1 flex min-h-8 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                <span className="font-medium text-slate-800 dark:text-slate-100">{products.length}</span>
                {" produto(s) na página · total "}
                <span className="font-medium text-slate-800 dark:text-slate-100">{total}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <TablePageSizeSelect
                  value={pageSize}
                  options={TABLE_PAGE_SIZE_OPTIONS}
                  onChange={(next) => {
                    setPageSize(next);
                    setPage(1);
                  }}
                />
                {totalPages > 1 && (
                  <>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Página {page}/{totalPages}
                    </span>
                    <div className="inline-flex items-center gap-px rounded border border-slate-200 bg-white p-px text-[11px] shadow-sm dark:border-slate-600 dark:bg-slate-800">
                      <button
                        type="button"
                        onClick={() => setPage(1)}
                        disabled={page === 1}
                        className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                        title="Primeira página"
                      >
                        «
                      </button>
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
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
                        disabled={page >= totalPages}
                        className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        Próxima
                      </button>
                      <button
                        type="button"
                        onClick={() => setPage(totalPages)}
                        disabled={page === totalPages}
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
              maxHeight="70vh"
              className="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none"
              tableClassName="min-w-full text-left text-sm"
            >
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/95">SKU</th>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/95">Título</th>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/95">Tags</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">Custo (R$)</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">Imposto (%)</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">Taxa Extra (%)</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">Desp. Fixas (R$)</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">PMA (R$)</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">Altura (cm)</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">Largura (cm)</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">Comprimento (cm)</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">Peso (kg)</th>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/95">Criado em</th>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/95">Ações</th>
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
                    <td className="max-w-[180px] p-2">
                      <div className="flex flex-wrap gap-1">
                        {(product.tags ?? []).length === 0 ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          (product.tags ?? []).map((t) => (
                            <span
                              key={t.id}
                              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                            >
                              {t.name}
                            </span>
                          ))
                        )}
                      </div>
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
                      {product.pma != null ? Number(product.pma).toFixed(2) : "—"}
                    </td>
                    <td className="p-2 text-right text-sm text-slate-700 dark:text-slate-200">{product.height ?? "—"}</td>
                    <td className="p-2 text-right text-sm text-slate-700 dark:text-slate-200">{product.width ?? "—"}</td>
                    <td className="p-2 text-right text-sm text-slate-700 dark:text-slate-200">{product.length ?? "—"}</td>
                    <td className="p-2 text-right text-sm text-slate-700 dark:text-slate-200">{product.weight ?? "—"}</td>
                    <td className="p-2 text-xs text-slate-500 dark:text-slate-400">
                      {new Date(product.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openEditProduct(product)}
                          className="text-sm text-[#0d6efd] hover:underline"
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
          </div>
        )
      ) : viewMode === "stats" ? (
        stats.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-slate-500">
            Nenhum produto com anúncios vinculados. Use &quot;Vincular SKUs&quot; para associar automaticamente.
          </p>
        ) : (
          <div className="adminty-table-card">
            <div className="mb-1 flex min-h-8 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                <span className="font-medium text-slate-800 dark:text-slate-100">{stats.length}</span>
                {" produto(s) na página · total "}
                <span className="font-medium text-slate-800 dark:text-slate-100">{total}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <TablePageSizeSelect
                  value={pageSize}
                  options={TABLE_PAGE_SIZE_OPTIONS}
                  onChange={(next) => {
                    setPageSize(next);
                    setPage(1);
                  }}
                />
                {totalPages > 1 && (
                  <>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Página {page}/{totalPages}
                    </span>
                    <div className="inline-flex items-center gap-px rounded border border-slate-200 bg-white p-px text-[11px] shadow-sm dark:border-slate-600 dark:bg-slate-800">
                      <button
                        type="button"
                        onClick={() => setPage(1)}
                        disabled={page === 1}
                        className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                        title="Primeira página"
                      >
                        «
                      </button>
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
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
                        disabled={page >= totalPages}
                        className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        Próxima
                      </button>
                      <button
                        type="button"
                        onClick={() => setPage(totalPages)}
                        disabled={page === totalPages}
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
              maxHeight="70vh"
              className="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none"
              tableClassName="min-w-full text-left text-sm"
            >
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/95">SKU</th>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/95">Título</th>
                  <th className="p-2 text-center text-xs font-semibold uppercase tracking-wide text-white/95">Anúncios</th>
                  <th className="p-2 text-center text-xs font-semibold uppercase tracking-wide text-white/95">Variações</th>
                  <th className="p-2 text-center text-xs font-semibold uppercase tracking-wide text-white/95">Total</th>
                  <th className="p-2 text-center text-xs font-semibold uppercase tracking-wide text-white/95">Ativos</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">Preço Mín</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">Preço Máx</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">Preço Médio</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">Custo</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">Estoque</th>
                  <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">Vendidos</th>
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
          </div>
        )
      ) : viewMode === "operational" ? (
        financeLoading ? (
          <p className="p-3 text-sm text-slate-500">Carregando custos…</p>
        ) : (
          <div className="space-y-4 px-3 pb-3">
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
            <div className="adminty-table-card">
              <p className="border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                Custos operacionais (R$ / mês)
              </p>
              <AppTable
                maxHeight="min(70vh, 32rem)"
                className="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none"
                tableClassName="min-w-full text-left text-sm"
              >
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/95">Categoria</th>
                    <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/95">Exemplos</th>
                    <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">
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
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-600">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                Total mensal (estimado):{" "}
                <span className="tabular-nums text-[#0d6efd]">
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
                className="btn btn-primary btn-sm disabled:opacity-50"
              >
                {savingOperational ? "Salvando…" : "Salvar custos operacionais"}
              </button>
            </div>
          </div>
        )
      ) : viewMode === "taxes" ? (
        financeLoading ? (
          <p className="p-3 text-sm text-slate-500">Carregando impostos…</p>
        ) : (
          <div className="space-y-4 px-3 pb-3">
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
            <div className="adminty-table-card">
              <p className="border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                Impostos e contribuições (%)
              </p>
              <AppTable
                maxHeight="min(70vh, 28rem)"
                className="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none"
                tableClassName="min-w-full text-left text-sm"
              >
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/95">Categoria</th>
                    <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/95">Exemplos</th>
                    <th className="p-2 text-right text-xs font-semibold uppercase tracking-wide text-white/95">
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
            </div>
            <div className="flex justify-end border-t border-slate-200 pt-4 dark:border-slate-600">
              <button
                type="button"
                onClick={() => void handleSaveTaxes()}
                disabled={savingTaxes}
                className="btn btn-primary btn-sm disabled:opacity-50"
              >
                {savingTaxes ? "Salvando…" : "Salvar impostos"}
              </button>
            </div>
          </div>
        )
      ) : viewMode === "howitworks" ? (
        <div className="space-y-5 px-3 pb-6 pt-1 text-sm text-slate-700 dark:text-slate-300">
          <section className="rounded border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-600 dark:bg-slate-800/30">
            <h3 className="mb-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100">Fluxo recomendado</h3>
            <ol className="list-inside list-decimal space-y-1.5 text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">
              <li>Cadastre produtos com o mesmo SKU usado no campo personalizado dos anúncios no Mercado Livre.</li>
              <li>Use <strong className="font-medium text-slate-800 dark:text-slate-200">Vincular SKUs</strong> para associar anúncios e variações aos produtos automaticamente.</li>
              <li>Revise <strong className="font-medium text-slate-800 dark:text-slate-200">Não Cadastrados</strong> para criar produtos que ainda faltam.</li>
              <li>Ajuste custos operacionais e impostos de referência quando fizer sentido para a sua operação.</li>
            </ol>
          </section>
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100">Produtos</h3>
            <p className="mb-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">
              Base de SKUs com custo, imposto por item, taxas extras, despesas fixas e dimensões. Inclua ou edite manualmente,
              importe CSV (menu <strong className="font-medium text-slate-800 dark:text-slate-200">Importar CSV</strong>) ou exporte
              para conferência. Esses dados entram nos cálculos de preço e margem.
            </p>
          </section>
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100">Tags</h3>
            <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">
              Classifique produtos com rótulos livres (ex.: full, queima). Crie na aba Tags, no formulário do produto ou na coluna{" "}
              <strong className="font-medium text-slate-800 dark:text-slate-200">Tags</strong> do CSV. Use os filtros em Produtos,
              Estatísticas e Preços para refinar listagens.
            </p>
          </section>
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100">Estatísticas</h3>
            <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">
              Após vincular, mostra por SKU quantos anúncios e variações existem, preços, estoque e vendas agregados dos itens ligados ao produto.
            </p>
          </section>
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100">Não Cadastrados</h3>
            <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">
              Lista SKUs encontrados em <strong className="font-medium text-slate-800 dark:text-slate-200">seller_custom_field</strong> dos
              anúncios que ainda não têm produto na base. Use <strong className="font-medium text-slate-800 dark:text-slate-200">Cadastrar</strong> para abrir o formulário já com o SKU.
            </p>
          </section>
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100">Custos operacionais e Impostos</h3>
            <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">
              Custos operacionais são valores mensais estimados da empresa. Impostos são percentuais de referência da carga tributária;
              complementam o campo <strong className="font-medium text-slate-800 dark:text-slate-200">Imposto (%)</strong> de cada produto na aba Produtos.
            </p>
          </section>
          <p className="text-[12px] text-slate-500 dark:text-slate-500">
            Depois de vincular, se a calculadora de preços não atualizar sozinha, use <strong className="font-medium text-slate-700 dark:text-slate-400">Preços → Ações → Atualizar dados</strong>.
          </p>
        </div>
      ) : null}

      </div>

      {filtersModalOpen && (viewMode === "products" || viewMode === "stats") && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setFiltersModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Filtros"
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-slate-800">Filtros</h2>
                <p className="text-xs text-slate-500">Busque por SKU, título ou filtre por tags.</p>
              </div>
              <button
                type="button"
                onClick={() => setFiltersModalOpen(false)}
                className="rounded border border-slate-200 px-2 py-1 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                aria-label="Fechar filtros"
              >
                ✕
              </button>
            </div>
            <form onSubmit={applyListFilters} className="space-y-4 p-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Buscar</label>
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="SKU ou título…"
                  className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd]"
                />
              </div>
              {allTags.length > 0 && (
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Tags (qualquer uma)
                  </label>
                  <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                    {allTags.map((t) => (
                      <label
                        key={t.id}
                        className={`cursor-pointer rounded border px-2 py-1 text-xs ${
                          draftFilterTagIds.includes(t.id)
                            ? "border-[#0d6efd] bg-[#0d6efd]/10 text-[#0d6efd]"
                            : "border-slate-200 bg-white text-slate-700"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={draftFilterTagIds.includes(t.id)}
                          onChange={() => toggleDraftFilterTag(t.id)}
                        />
                        {t.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => clearListFilters()}
                  className="rounded border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Limpar filtros
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                >
                  Aplicar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">PMA (R$)</label>
                  <input
                    type="text"
                    value={form.pma}
                    onChange={(e) => setForm({ ...form, pma: e.target.value })}
                    placeholder="0,00"
                    className="input w-full py-2 text-sm focus:border-brand-blue focus:ring-brand-blue dark:focus:border-brand-blue-light dark:focus:ring-brand-blue-light"
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-sm font-medium text-fg">Tags</label>
                  <ProductTagInput
                    value={formTagNames}
                    onChange={setFormTagNames}
                    availableTags={allTags}
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
                e opcionalmente: Titulo, Altura, Largura, Comprimento, Peso, PrecoCusto, Imposto, TaxaExtra, DespFixas, PMA, Tags
                (várias tags separadas por <code>;</code> ou <code>,</code>).
              </p>
              <p className="mb-4 text-sm text-fg">
                Produtos com SKU existente serão atualizados. A importação processa{" "}
                <strong>todas as linhas do arquivo</strong>, não só a página visível na tabela.
              </p>
              <p className="mb-4 text-xs text-slate-500">
                Na coluna <strong>Tags</strong>, use vírgula entre tags (ex.:{" "}
                <code>full, queima estoque</code>). Se o CSV usa <code>;</code> como separador de colunas,
                evite <code>;</code> dentro da célula de tags — ou deixe o campo entre aspas.
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

              {importing && (
                <p className="mb-4 text-sm text-slate-600">
                  Importando… arquivos grandes podem levar alguns minutos. Não feche esta janela.
                </p>
              )}

              {importResult && (
                <div
                  className={`mb-4 rounded p-3 text-sm ${
                    importResult.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                  }`}
                >
                  {importResult.success && !importResult.partial ? (
                    <div className="space-y-1">
                      <p>
                        {importResult.imported ?? 0} produto(s) importado(s) ou atualizado(s) com sucesso
                        {importResult.parsed != null && importResult.parsed !== importResult.imported
                          ? ` (${importResult.parsed} no arquivo)`
                          : ""}
                        .
                      </p>
                      {(importResult.rows_with_tags_in_file ?? 0) > 0 && (
                        <p className="text-xs">
                          Tags: {importResult.tags_linked ?? 0} de{" "}
                          {importResult.rows_with_tags_in_file} linha(s) com tags no CSV tiveram vínculos
                          aplicados.
                        </p>
                      )}
                    </div>
                  ) : importResult.partial ? (
                    <p>
                      Importação parcial: {importResult.imported ?? 0} de {importResult.parsed ?? "?"} produto(s).
                      Veja os avisos abaixo.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <p>{importResult.errors?.[0] || "Erro ao importar"}</p>
                      {importResult.errors && importResult.errors.length > 1 && (
                        <ul className="list-inside list-disc text-xs">
                          {importResult.errors.slice(1, 6).map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      )}
                    </div>
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

    </div>
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

export default function ProdutosPage() {
  return (
    <OnboardingGate required="sync">
      <ProdutosPageContent />
    </OnboardingGate>
  );
}
