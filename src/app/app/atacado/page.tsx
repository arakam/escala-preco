"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { Tier } from "@/lib/atacado";

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
  tiers: Tier[];
  has_draft: boolean;
  has_variations: boolean;
  draft_updated_at: string | null;
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

export default function AtacadoPage() {
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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const rowKey = (r: AtacadoRow) => `${r.item_id}:${r.variation_id ?? "item"}`;

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

  const loadRows = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const params = new URLSearchParams({ accountId, page: String(page), limit: String(limit) });
    if (search) params.set("search", search);
    if (filter) params.set("filter", filter);
    const res = await fetch(`/api/atacado/rows?${params}`);
    if (res.ok) {
      const data = await res.json();
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setEdits({});
    }
    setLoading(false);
  }, [accountId, page, limit, search, filter]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (accountId) loadRows();
  }, [accountId, loadRows]);

  const editedCount = Object.values(edits).filter((e) => e.status === "edited" || e.status === "error").length;

  const getEditState = (r: AtacadoRow): RowEditState => {
    const key = rowKey(r);
    return edits[key] ?? { tiers: r.tiers, status: "saved" };
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
    if (field === "min_qty") t.min_qty = typeof value === "string" ? parseInt(value, 10) || 0 : value;
    else t.price = typeof value === "string" ? parseFloat(value.replace(",", ".")) || 0 : value;
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

  const saveAll = async () => {
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
      return;
    }
    if (valid.length === 0) {
      setMessage({ type: "success", text: "Nenhuma alteração pendente." });
      return;
    }
    setSaving(true);
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

  const exportCsv = () => {
    const params = new URLSearchParams({ accountId });
    if (search) params.set("search", search);
    if (filter) params.set("filter", filter);
    window.open(`/api/atacado/export?${params}`, "_blank");
    setMessage({ type: "success", text: "Exportação iniciada." });
  };

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  const totalPages = Math.ceil(total / limit) || 1;

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
            placeholder="Buscar por MLB, título ou SKU"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <button type="submit" className="rounded bg-gray-200 px-3 py-1 text-sm hover:bg-gray-300">
            Buscar
          </button>
        </form>
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="">Todos</option>
          <option value="com_variações">Com variações</option>
          <option value="com_rascunho">Com rascunho</option>
          <option value="sem_rascunho">Sem rascunho</option>
        </select>
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
        {editedCount > 0 && (
          <span className="text-sm text-amber-700">{editedCount} linha(s) alterada(s)</span>
        )}
      </div>

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
          <p className="mb-4 text-sm text-gray-600">
            {total} linha(s) — página {page} de {totalPages}
          </p>
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="whitespace-nowrap p-2 font-medium">MLB</th>
                  <th className="p-2 font-medium">Título</th>
                  <th className="p-2 font-medium">Var.</th>
                  <th className="p-2 font-medium">SKU</th>
                  <th className="p-2 font-medium">Preço</th>
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
                {rows.map((r) => {
                  const cur = getEditState(r);
                  const tiers5 = ensureTiers5(cur.tiers);
                  const err = validateRow(r);
                  const isInvalid = cur.status === "edited" && err != null;
                  return (
                    <tr
                      key={rowKey(r)}
                      className={`border-b border-gray-100 ${isInvalid ? "bg-red-50" : ""} hover:bg-gray-50`}
                    >
                      <td className="p-2 font-mono text-gray-600">{r.item_id}</td>
                      <td className="max-w-[180px] truncate p-2" title={r.title ?? ""}>
                        {r.title ?? "—"}
                      </td>
                      <td className="p-2">{r.variation_id ?? "—"}</td>
                      <td className="p-2 text-gray-600">{r.sku ?? "—"}</td>
                      <td className="p-2">
                        {r.current_price != null ? `R$ ${Number(r.current_price).toFixed(2)}` : "—"}
                      </td>
                      {[0, 1, 2, 3, 4].map((i) => (
                        <React.Fragment key={i}>
                          <td className="p-2">
                            <input
                              type="number"
                              min={2}
                              placeholder={i === 0 ? "2" : ""}
                              value={tiers5[i]?.min_qty ?? ""}
                              onChange={(e) => updateTier(r, i, "min_qty", e.target.value)}
                              className={`w-16 rounded border px-1 py-0.5 text-sm ${
                                isInvalid ? "border-red-500" : "border-gray-200"
                              }`}
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              placeholder="0,00"
                              value={tiers5[i]?.price ? String(tiers5[i].price) : ""}
                              onChange={(e) => updateTier(r, i, "price", e.target.value)}
                              className={`w-20 rounded border px-1 py-0.5 text-sm ${
                                isInvalid ? "border-red-500" : "border-gray-200"
                              }`}
                            />
                          </td>
                        </React.Fragment>
                      ))}
                      <td className="p-2">
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${
                            cur.status === "error"
                              ? "bg-red-200 text-red-800"
                              : cur.status === "edited"
                                ? "bg-amber-200 text-amber-800"
                                : "bg-green-100 text-green-800"
                          }`}
                        >
                          {cur.status === "error" ? "erro" : cur.status === "edited" ? "alterado" : "salvo"}
                        </span>
                      </td>
                      <td className="p-2">
                        <button
                          type="button"
                          onClick={() => saveRow(r)}
                          disabled={saving}
                          className="mr-1 text-brand-blue hover:underline disabled:opacity-50"
                        >
                          Salvar
                        </button>
                        <button type="button" onClick={() => revertRow(r)} className="text-gray-600 hover:underline">
                          Reverter
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

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
    </div>
  );
}
