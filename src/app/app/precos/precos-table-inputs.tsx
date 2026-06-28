"use client";

import { useEffect, useState } from "react";

export function PriceInput({
  value,
  onChange,
  onCommit,
  dirty,
}: {
  value: number;
  onChange: (value: number) => void;
  onCommit: (committedPrice: number) => void;
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
      onCommit(num);
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
      className={`pricing-inline-input w-24 px-2 py-1 ${
        dirty ? "pricing-inline-input--dirty" : ""
      }`}
    />
  );
}

export function MarginInput({
  valuePercent,
  disabled,
  dirty,
  onCommit,
}: {
  valuePercent: number | null;
  disabled?: boolean;
  dirty?: boolean;
  onCommit: (pct: number) => void;
}) {
  const fmt = (v: number) => v.toFixed(1).replace(".", ",");
  const [localValue, setLocalValue] = useState(() => (valuePercent != null ? fmt(valuePercent) : ""));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      if (valuePercent != null) setLocalValue(fmt(valuePercent));
      else setLocalValue("");
    }
  }, [valuePercent, isFocused]);

  if (disabled) {
    return <span className="text-fg-muted text-sm">—</span>;
  }

  const handleBlur = () => {
    setIsFocused(false);
    const cleaned = localValue.replace(/[^\d,.-]/g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    if (!isNaN(num)) {
      setLocalValue(fmt(num));
      onCommit(num);
    } else if (valuePercent != null) {
      setLocalValue(fmt(valuePercent));
    } else {
      setLocalValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex items-center justify-end gap-0.5">
      <input
        type="text"
        inputMode="decimal"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        title="Margem líquida sobre o preço calculado. Ao confirmar, o preço calculado é ajustado pela calculadora (taxas ML, frete, impostos)."
        className={`pricing-inline-input w-[4.25rem] px-1.5 py-1 ${
          dirty ? "pricing-inline-input--dirty" : ""
        }`}
      />
      <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">%</span>
    </div>
  );
}
