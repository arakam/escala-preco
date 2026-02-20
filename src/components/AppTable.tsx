"use client";

import * as React from "react";

/**
 * Modelo padrão de tabela para o app:
 * - Usa a largura disponível (tela cheia dentro do container)
 * - Suporta 15+ colunas com scroll horizontal
 * - Cabeçalho fixo ao rolar verticalmente
 * - Layout organizado e compacto
 */
export interface AppTableProps {
  /** Conteúdo da tabela (thead + tbody) */
  children: React.ReactNode;
  /** Texto ou elemento acima da tabela (ex: "X itens — página Y de Z") */
  summary?: React.ReactNode;
  /** Altura máxima para scroll vertical (cabeçalho fica fixo). Ex: "70vh" */
  maxHeight?: string;
  /** Classe extra no wrapper da tabela */
  className?: string;
}

export function AppTable({ children, summary, maxHeight = "70vh", className = "" }: AppTableProps) {
  return (
    <div className={`w-full ${className}`}>
      {summary != null && (
        <div className="mb-3 text-sm text-gray-600">{summary}</div>
      )}
      <div
        className="w-full overflow-x-auto overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-sm"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="app-table min-w-full text-left text-sm">
          {children}
        </table>
      </div>
    </div>
  );
}

/**
 * Cabeçalho da tabela com estilo padrão (degradê azul, borda, sticky).
 * Use dentro de <table><thead><AppTableHead>...</AppTableHead></thead></table>
 * Estilo do header vem de .app-table thead em globals.css
 */
export function AppTableHead({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className="sticky top-0 z-10" {...props}>
      {children}
    </thead>
  );
}

/**
 * Linha de cabeçalho padrão.
 */
export function AppTableHeadRow({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props}>{children}</tr>;
}

/**
 * Célula de cabeçalho padrão (evita quebra, padding compacto).
 */
export function AppTableTh({
  children,
  className = "",
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`whitespace-nowrap p-2 font-medium ${className}`}
      {...props}
    >
      {children}
    </th>
  );
}

/**
 * Linha do corpo com hover.
 */
export function AppTableBodyRow({
  children,
  className = "",
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={`border-b border-gray-100 hover:bg-gray-50 ${className}`} {...props}>
      {children}
    </tr>
  );
}

/**
 * Célula do corpo padrão.
 */
export function AppTableTd({
  children,
  className = "",
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`p-2 ${className}`} {...props}>
      {children}
    </td>
  );
}
