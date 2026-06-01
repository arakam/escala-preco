"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ProductTag } from "@/lib/db/types";
import { PrecosFiltersModal, type PrecosFiltersValues } from "./precos-filters-modal";

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

type PrecosToolbarIconsProps = {
  applied: PrecosFiltersValues;
  allTags: ProductTag[];
  onApply: (values: PrecosFiltersValues) => void;
  onClearAll: () => void;
  lastUpdatedAt: string | null;
  lastUpdatedFormatted: string;
  exportDisabled: boolean;
  precosImportLoading: boolean;
  onOpenImport: () => void;
  onExport: () => void;
  onRefreshTable: () => void;
};

/**
 * Ícones da barra de filtros (relógio, filtros, opções) com estado local.
 * Evita re-renderizar a tabela inteira ao abrir modal/dropdown — crítico com "Linhas: Todos".
 */
export const PrecosToolbarIcons = memo(function PrecosToolbarIcons({
  applied,
  allTags,
  onApply,
  onClearAll,
  lastUpdatedAt,
  lastUpdatedFormatted,
  exportDisabled,
  precosImportLoading,
  onOpenImport,
  onExport,
  onRefreshTable,
}: PrecosToolbarIconsProps) {
  const [lastUpdatedInfoOpen, setLastUpdatedInfoOpen] = useState(false);
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);
  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const closeAllPopovers = useCallback(() => {
    setLastUpdatedInfoOpen(false);
    setOptionsMenuOpen(false);
  }, []);

  const handleApply = useCallback(
    (values: PrecosFiltersValues) => {
      onApply(values);
      setFiltersModalOpen(false);
    },
    [onApply]
  );

  const handleClearAll = useCallback(() => {
    onClearAll();
    setFiltersModalOpen(false);
  }, [onClearAll]);

  useEffect(() => {
    if (!lastUpdatedInfoOpen && !optionsMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = toolbarRef.current;
      if (el && !el.contains(e.target as Node)) {
        closeAllPopovers();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [lastUpdatedInfoOpen, optionsMenuOpen, closeAllPopovers]);

  return (
    <>
      <div className="btn-dropdown relative flex items-center gap-1" ref={toolbarRef}>
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setOptionsMenuOpen(false);
              setFiltersModalOpen(false);
              setLastUpdatedInfoOpen((o) => !o);
            }}
            title={
              lastUpdatedAt
                ? `Última atualização: ${lastUpdatedFormatted} (horário de São Paulo).`
                : "Ainda não há registro da última atualização do cache nesta conta."
            }
            aria-label="Última atualização do cache"
            aria-expanded={lastUpdatedInfoOpen}
            className="btn btn-icon btn-sm btn-outline-secondary"
          >
            <ClockIcon />
          </button>
          {lastUpdatedInfoOpen && (
            <div className="absolute right-0 top-9 z-30 w-72 rounded border border-slate-200 bg-card px-3 py-2 text-left text-[11px] leading-snug text-slate-700 shadow-lg dark:border-slate-600 dark:text-slate-200">
              {lastUpdatedAt ? (
                <>
                  <span className="font-semibold text-slate-800 dark:text-slate-100">Última atualização</span>
                  {": "}
                  {lastUpdatedFormatted}
                  <span className="text-slate-500"> (horário de São Paulo).</span>
                </>
              ) : (
                <>Ainda não há registro da última atualização do cache nesta conta.</>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            closeAllPopovers();
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
            setLastUpdatedInfoOpen(false);
            setFiltersModalOpen(false);
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
          <div className="btn-dropdown-menu right-0 top-full w-52">
            <button
              type="button"
              onClick={() => {
                onOpenImport();
                setOptionsMenuOpen(false);
              }}
              disabled={precosImportLoading}
              className="btn-dropdown-item disabled:cursor-not-allowed disabled:opacity-50"
            >
              {precosImportLoading ? "Processando CSV…" : "Importar CSV"}
            </button>
            <button
              type="button"
              onClick={() => {
                onExport();
                setOptionsMenuOpen(false);
              }}
              disabled={exportDisabled}
              className="btn-dropdown-item disabled:cursor-not-allowed disabled:opacity-50"
              title={
                exportDisabled
                  ? "Não há linhas na tabela para exportar"
                  : "Exporta as linhas visíveis na tabela (página e filtros atuais)"
              }
            >
              Exportar CSV
            </button>
            <button
              type="button"
              onClick={() => {
                onRefreshTable();
                setOptionsMenuOpen(false);
              }}
              className="btn-dropdown-item"
            >
              Atualizar tabela
            </button>
          </div>
        )}
      </div>

      <PrecosFiltersModal
        open={filtersModalOpen}
        onClose={() => setFiltersModalOpen(false)}
        applied={applied}
        allTags={allTags}
        onApply={handleApply}
        onClearAll={handleClearAll}
      />
    </>
  );
});
