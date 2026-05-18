"use client";

import { PAGE_SIZE_ALL } from "@/lib/table-pagination";

type Props = {
  value: number;
  onChange: (pageSize: number) => void;
  options: readonly number[];
  className?: string;
  showAllOption?: boolean;
};

const selectClassName =
  "h-6 rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-700 shadow-sm focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200";

export function TablePageSizeSelect({
  value,
  onChange,
  options,
  className,
  showAllOption = true,
}: Props) {
  return (
    <label
      className={
        className ?? "flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"
      }
    >
      Linhas
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={selectClassName}
        aria-label="Linhas por página"
      >
        {options.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
        {showAllOption && (
          <option value={PAGE_SIZE_ALL}>Todos</option>
        )}
      </select>
    </label>
  );
}
