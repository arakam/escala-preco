"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ProductTag } from "@/lib/db/types";

type Props = {
  value: string[];
  onChange: (names: string[]) => void;
  availableTags: ProductTag[];
  disabled?: boolean;
  placeholder?: string;
};

function normalize(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

export function ProductTagInput({
  value,
  onChange,
  availableTags,
  disabled,
  placeholder = "Digite e Enter para adicionar…",
}: Props) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const lowerSelected = useMemo(() => new Set(value.map((v) => v.toLowerCase())), [value]);

  const suggestions = useMemo(() => {
    const q = normalize(input).toLowerCase();
    return availableTags
      .filter((t) => !lowerSelected.has(t.name.toLowerCase()))
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [availableTags, input, lowerSelected]);

  const addTag = useCallback(
    (raw: string) => {
      const name = normalize(raw);
      if (!name || lowerSelected.has(name.toLowerCase())) {
        setInput("");
        return;
      }
      onChange([...value, name]);
      setInput("");
      setOpen(false);
      inputRef.current?.focus();
    },
    [value, onChange, lowerSelected]
  );

  const removeTag = useCallback(
    (name: string) => {
      onChange(value.filter((v) => v.toLowerCase() !== name.toLowerCase()));
    },
    [value, onChange]
  );

  return (
    <div className="space-y-2">
      <div className="flex min-h-[2.25rem] flex-wrap gap-1.5 rounded border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-900">
        {value.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 rounded bg-[#0d6efd]/10 px-2 py-0.5 text-xs font-medium text-[#0d6efd]"
          >
            {name}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeTag(name)}
                className="rounded hover:bg-[#0d6efd]/20"
                aria-label={`Remover tag ${name}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag(input);
              } else if (e.key === "Backspace" && !input && value.length > 0) {
                removeTag(value[value.length - 1]);
              }
            }}
            placeholder={value.length === 0 ? placeholder : ""}
            className="min-w-[8rem] flex-1 border-0 bg-transparent py-0.5 text-sm outline-none focus:ring-0"
          />
        )}
      </div>
      {open && !disabled && suggestions.length > 0 && (
        <ul className="max-h-40 overflow-y-auto rounded border border-slate-200 bg-white py-1 text-sm shadow-md dark:border-slate-600 dark:bg-slate-800">
          {suggestions.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addTag(t.name)}
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-slate-500">
        Separe várias tags com Enter. Tags novas são criadas automaticamente ao salvar.
      </p>
    </div>
  );
}
