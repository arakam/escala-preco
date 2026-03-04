"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { AppTable } from "@/components/AppTable";
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

type ViewMode = "products" | "stats";

export default function ProdutosPage() {
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

  const [linking, setLinking] = useState(false);
  const [linkResult, setLinkResult] = useState<{ items_linked: number; variations_linked: number } | null>(null);
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
    if (viewMode === "products") {
      loadProducts();
    } else {
      loadStats();
    }
  }, [viewMode, loadProducts, loadStats]);

  useEffect(() => {
    loadUnregisteredSkus();
  }, [loadUnregisteredSkus]);

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
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Cadastro de Produtos</h1>
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
          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Importar CSV
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
        </div>
      </div>

      {linkResult && (
        <div className="mb-4 rounded bg-green-50 p-3 text-sm text-green-700">
          Vinculação concluída: {linkResult.items_linked} anúncio(s) e {linkResult.variations_linked} variação(ões) vinculados.
          <button
            type="button"
            onClick={() => setLinkResult(null)}
            className="ml-2 text-green-900 underline hover:no-underline"
          >
            Fechar
          </button>
        </div>
      )}

      <div className="mb-4 flex gap-2 border-b border-gray-200">
        <button
          type="button"
          onClick={() => {
            setViewMode("products");
            setPage(1);
          }}
          className={`px-4 py-2 text-sm font-medium ${
            viewMode === "products"
              ? "border-b-2 border-brand-blue text-brand-blue"
              : "text-gray-600 hover:text-gray-900"
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
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Estatísticas de Anúncios
        </button>
      </div>

      <form onSubmit={handleSearchSubmit} className="mb-6 flex flex-wrap gap-3">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por SKU ou título…"
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded bg-gray-200 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-300"
        >
          Buscar
        </button>
        {search && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setSearchInput("");
              setPage(1);
            }}
            className="text-sm text-gray-600 underline hover:text-gray-900"
          >
            Limpar
          </button>
        )}
      </form>

      {loading ? (
        <p className="text-gray-500">Carregando…</p>
      ) : viewMode === "products" ? (
        products.length === 0 ? (
          <p className="text-gray-500">
            Nenhum produto cadastrado. Clique em &quot;Novo Produto&quot; ou importe via CSV.
          </p>
        ) : (
          <>
            <AppTable
              summary={`${total} produto(s) — página ${page} de ${totalPages || 1}`}
              maxHeight="70vh"
            >
              <thead>
                <tr>
                  <th className="p-2 font-medium text-gray-700">SKU</th>
                  <th className="p-2 font-medium text-gray-700">Título</th>
                  <th className="p-2 font-medium text-gray-700">Custo (R$)</th>
                  <th className="p-2 font-medium text-gray-700">Imposto (%)</th>
                  <th className="p-2 font-medium text-gray-700">Taxa Extra (%)</th>
                  <th className="p-2 font-medium text-gray-700">Desp. Fixas (R$)</th>
                  <th className="p-2 font-medium text-gray-700">Altura (cm)</th>
                  <th className="p-2 font-medium text-gray-700">Largura (cm)</th>
                  <th className="p-2 font-medium text-gray-700">Comprimento (cm)</th>
                  <th className="p-2 font-medium text-gray-700">Peso (kg)</th>
                  <th className="p-2 font-medium text-gray-700">Criado em</th>
                  <th className="p-2 font-medium text-gray-700">Ações</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="p-2 font-mono text-sm">{product.sku}</td>
                    <td className="max-w-[240px] truncate p-2" title={product.title}>
                      {product.title}
                    </td>
                    <td className="p-2 text-right">{product.cost_price != null ? Number(product.cost_price).toFixed(2) : "—"}</td>
                    <td className="p-2 text-right">{product.tax_percent != null ? Number(product.tax_percent).toFixed(2) : "—"}</td>
                    <td className="p-2 text-right">{product.extra_fee_percent != null ? Number(product.extra_fee_percent).toFixed(2) : "—"}</td>
                    <td className="p-2 text-right">{product.fixed_expenses != null ? Number(product.fixed_expenses).toFixed(2) : "—"}</td>
                    <td className="p-2 text-right">{product.height ?? "—"}</td>
                    <td className="p-2 text-right">{product.width ?? "—"}</td>
                    <td className="p-2 text-right">{product.length ?? "—"}</td>
                    <td className="p-2 text-right">{product.weight ?? "—"}</td>
                    <td className="p-2 text-gray-500 text-sm">
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
        )
      ) : stats.length === 0 ? (
        <p className="text-gray-500">
          Nenhum produto com anúncios vinculados. Clique em &quot;Vincular SKUs&quot; para associar automaticamente.
        </p>
      ) : (
        <>
          <AppTable
            summary={`${total} produto(s) com anúncios — página ${page} de ${totalPages || 1}`}
            maxHeight="70vh"
          >
            <thead>
              <tr>
                <th className="p-2 font-medium text-gray-700">SKU</th>
                <th className="p-2 font-medium text-gray-700">Título</th>
                <th className="p-2 font-medium text-gray-700 text-center">Anúncios</th>
                <th className="p-2 font-medium text-gray-700 text-center">Variações</th>
                <th className="p-2 font-medium text-gray-700 text-center">Total</th>
                <th className="p-2 font-medium text-gray-700 text-center">Ativos</th>
                <th className="p-2 font-medium text-gray-700 text-right">Preço Mín</th>
                <th className="p-2 font-medium text-gray-700 text-right">Preço Máx</th>
                <th className="p-2 font-medium text-gray-700 text-right">Preço Médio</th>
                <th className="p-2 font-medium text-gray-700 text-right">Custo</th>
                <th className="p-2 font-medium text-gray-700 text-right">Estoque</th>
                <th className="p-2 font-medium text-gray-700 text-right">Vendidos</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((stat) => (
                <tr key={stat.product_id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="p-2 font-mono text-sm">{stat.sku}</td>
                  <td className="max-w-[200px] truncate p-2" title={stat.title}>
                    {stat.title}
                  </td>
                  <td className="p-2 text-center">{stat.total_items}</td>
                  <td className="p-2 text-center">{stat.total_variations}</td>
                  <td className="p-2 text-center font-semibold">{stat.total_listings}</td>
                  <td className="p-2 text-center">
                    <span className={stat.active_items > 0 ? "text-green-600" : "text-gray-400"}>
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
                  <td className="p-2 text-right text-gray-600">
                    {stat.cost_price != null ? `R$ ${Number(stat.cost_price).toFixed(2)}` : "—"}
                  </td>
                  <td className="p-2 text-right">{stat.total_available_qty}</td>
                  <td className="p-2 text-right text-green-600">{stat.total_sold_qty}</td>
                </tr>
              ))}
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
            className="w-full max-w-lg rounded-lg border border-gray-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingProduct ? "Editar Produto" : "Novo Produto"}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
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
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    SKU <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none"
                    required
                  />
                </div>
                <div className="col-span-1">
                  <label className="mb-1 block text-sm font-medium text-gray-700">Título</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Altura (cm)</label>
                  <input
                    type="text"
                    value={form.height}
                    onChange={(e) => setForm({ ...form, height: e.target.value })}
                    placeholder="0,00"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Largura (cm)</label>
                  <input
                    type="text"
                    value={form.width}
                    onChange={(e) => setForm({ ...form, width: e.target.value })}
                    placeholder="0,00"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Comprimento (cm)</label>
                  <input
                    type="text"
                    value={form.length}
                    onChange={(e) => setForm({ ...form, length: e.target.value })}
                    placeholder="0,00"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Peso (kg)</label>
                  <input
                    type="text"
                    value={form.weight}
                    onChange={(e) => setForm({ ...form, weight: e.target.value })}
                    placeholder="0,000"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Preço de Custo (R$)</label>
                  <input
                    type="text"
                    value={form.cost_price}
                    onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                    placeholder="0,00"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Imposto (%)</label>
                  <input
                    type="text"
                    value={form.tax_percent}
                    onChange={(e) => setForm({ ...form, tax_percent: e.target.value })}
                    placeholder="0,00"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Taxa Extra (%)</label>
                  <input
                    type="text"
                    value={form.extra_fee_percent}
                    onChange={(e) => setForm({ ...form, extra_fee_percent: e.target.value })}
                    placeholder="0,00"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Desp. Fixas (R$)</label>
                  <input
                    type="text"
                    value={form.fixed_expenses}
                    onChange={(e) => setForm({ ...form, fixed_expenses: e.target.value })}
                    placeholder="0,00"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
            className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Excluir Produto</h2>
            <p className="mb-6 text-sm text-gray-600">
              Tem certeza que deseja excluir o produto <strong>{deleteConfirm.sku}</strong>?
              Esta ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
            className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Excluir todos os produtos</h2>
            <p className="mb-3 text-sm text-gray-700 font-medium">
              Esta ação irá remover <span className="font-semibold">todos os produtos da sua base</span>.
            </p>
            <p className="mb-4 text-sm text-gray-600">
              Os anúncios do Mercado Livre <span className="font-semibold">não serão apagados</span>, apenas ficarão
              <span className="font-semibold"> desvinculados dos produtos</span>.
            </p>
            <p className="mb-6 text-xs text-gray-500">
              Depois você poderá importar ou vincular novamente os produtos a partir dos anúncios.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteAllOpen(false)}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <h2 className="text-lg font-semibold text-gray-900">Importar Produtos via CSV</h2>
              <button
                type="button"
                onClick={() => {
                  setImportModalOpen(false);
                  setImportResult(null);
                }}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleImport} className="p-4">
              <p className="mb-4 text-sm text-gray-600">
                O arquivo CSV deve conter a coluna <strong>SKU</strong> (obrigatório),
                e opcionalmente: Titulo, Altura, Largura, Comprimento, Peso, PrecoCusto, Imposto, TaxaExtra, DespFixas.
              </p>
              <p className="mb-4 text-sm text-gray-600">
                Produtos com SKU existente serão atualizados.
              </p>
              <a
                href="/api/products/template"
                download="modelo_produtos.csv"
                className="mb-4 inline-flex items-center gap-2 rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
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
                className="mb-4 w-full rounded border border-gray-300 px-3 py-2 text-sm"
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
                  className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
            className="w-full max-w-2xl rounded-lg border border-gray-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <h2 className="text-lg font-semibold text-gray-900">
                SKUs encontrados em anúncios sem produto cadastrado
              </h2>
              <button
                type="button"
                onClick={() => setUnregisteredModalOpen(false)}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-4">
              <p className="mb-4 text-sm text-gray-600">
                Estes SKUs foram encontrados no campo &quot;seller_custom_field&quot; dos seus anúncios,
                mas não possuem um produto cadastrado. Clique em um SKU para criar o produto.
              </p>
              {unregisteredSkus.length === 0 ? (
                <p className="text-gray-500">Todos os SKUs já estão cadastrados!</p>
              ) : (
                <div className="space-y-2">
                  {unregisteredSkus.map((item) => (
                    <div
                      key={item.sku}
                      className="flex items-center justify-between rounded border border-gray-200 p-3 hover:bg-gray-50"
                    >
                      <div className="flex-1">
                        <span className="font-mono text-sm font-medium">{item.sku}</span>
                        {item.sample_title && (
                          <p className="mt-1 truncate text-xs text-gray-500" title={item.sample_title}>
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
            <div className="flex justify-end border-t border-gray-200 p-4">
              <button
                type="button"
                onClick={() => setUnregisteredModalOpen(false)}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
