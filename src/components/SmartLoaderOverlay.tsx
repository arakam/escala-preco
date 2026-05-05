"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

const DEFAULT_MESSAGES = [
  "Processando…",
  "Sincronizando com o Mercado Livre…",
  "Quase lá…",
] as const;

/** Alinhado às operações reais do app (prioridade: `messages` > `phase` > genérico). */
export type SmartLoaderPhase = "default" | "refresh-cache" | "calculate";

/** POST /api/pricing/cache/refresh → refreshPricingCache (ml_items, variações, planned_prices, vendas 30d). */
const REFRESH_CACHE_MESSAGES = [
  "Lendo anúncios e variações do banco…",
  "Montando o cache de preços (MLB, SKU, custos)…",
  "Carregando preços planejados salvos…",
  "Buscando vendas e pedidos dos últimos 30 dias no ML…",
  "Gravando o cache para a calculadora…",
] as const;

/** POST /api/pricing/calculate → taxas listing_prices, frete Líder, persistindo calculated_* no cache. */
const CALCULATE_MESSAGES = [
  "Consultando taxas de venda no Mercado Livre…",
  "Calculando comissão por anúncio e categoria…",
  "Aplicando regras de frete (Mercado Líder)…",
  "Salvando taxa e frete simulados no cache…",
] as const;

const FOOTER_HINT: Record<SmartLoaderPhase, string> = {
  default: "Aguarde, o sistema está processando…",
  "refresh-cache": "Atualizando dados dos anúncios para a tela de Preços…",
  calculate: "Calculando taxas e frete para cada preço simulado…",
};

export interface SmartLoaderOverlayProps {
  /** Quando true, cobre a tela com o loader (backdrop + cartão central) */
  open: boolean;
  /**
   * Cenário da operação — escolhe mensagens coerentes com o backend.
   * Ignorado se `messages` tiver itens.
   */
  phase?: SmartLoaderPhase;
  /** Frases que alternam a cada ~2s; se definido, substitui `phase` e o texto genérico */
  messages?: string[];
}

/**
 * Overlay de trabalho em andamento (mensagens rotativas + barra de progresso indeterminada).
 * Travar o progresso em ~90% deixa a sensação de operação longa mais natural até `open` virar false.
 */
export function SmartLoaderOverlay({ open, messages, phase = "default" }: SmartLoaderOverlayProps) {
  const lines = useMemo(() => {
    if (messages && messages.length > 0) return messages;
    if (phase === "refresh-cache") return Array.from(REFRESH_CACHE_MESSAGES);
    if (phase === "calculate") return Array.from(CALCULATE_MESSAGES);
    return Array.from(DEFAULT_MESSAGES);
  }, [messages, phase]);

  const footerHint = messages?.length ? FOOTER_HINT.default : FOOTER_HINT[phase];

  const [text, setText] = useState(lines[0] ?? "");
  const [progress, setProgress] = useState(10);

  useEffect(() => {
    if (!open) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";
    setProgress(10);
    setText(lines[0] ?? "");

    let messageIndex = 0;
    const messageInterval = setInterval(() => {
      messageIndex = (messageIndex + 1) % lines.length;
      setText(lines[messageIndex] ?? "");
    }, 2000);

    const progressInterval = setInterval(() => {
      setProgress((prev) => (prev >= 90 ? prev : prev + Math.random() * 10));
    }, 800);

    return () => {
      document.body.style.overflow = "";
      clearInterval(messageInterval);
      clearInterval(progressInterval);
    };
  }, [open, lines]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/45 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex max-w-sm flex-col items-center rounded-app-lg bg-card px-8 py-10 shadow-card ring-1 ring-stroke dark:ring-slate-600">
        <Image
          src="/logo.png"
          alt=""
          width={360}
          height={100}
          className="mb-6 h-14 w-auto animate-pulse object-contain sm:h-16"
          priority
        />
        <p className="mb-4 text-center text-sm text-fg-muted">{text}</p>
        <div className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-stroke dark:bg-slate-600">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-warning transition-[width] duration-500 ease-out"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
        <p className="mt-4 text-xs text-fg-muted">{footerHint}</p>
      </div>
    </div>
  );
}
