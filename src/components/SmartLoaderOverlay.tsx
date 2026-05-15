"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  /**
   * Progresso real (0–100). Quando definido, a barra reflete esse valor e não usa animação “fake” até 90%.
   */
  determinatePercent?: number | null;
  /** Substitui o rodapé padrão do phase (ex.: status + contagens) */
  footerHint?: string;
  /** Conteúdo abaixo do rodapé: erros, botões, etc. */
  children?: ReactNode;
  /** Classes do cartão interno (ex.: `max-w-lg` para painéis com lista de erros) */
  panelClassName?: string;
}

/**
 * Overlay de trabalho em andamento (mensagens rotativas + barra de progresso indeterminada).
 * Travar o progresso em ~90% deixa a sensação de operação longa mais natural até `open` virar false.
 */
export function SmartLoaderOverlay({
  open,
  messages,
  phase = "default",
  determinatePercent,
  footerHint: footerHintProp,
  children,
  panelClassName,
}: SmartLoaderOverlayProps) {
  const lines = useMemo(() => {
    if (messages && messages.length > 0) return messages;
    if (phase === "refresh-cache") return Array.from(REFRESH_CACHE_MESSAGES);
    if (phase === "calculate") return Array.from(CALCULATE_MESSAGES);
    return Array.from(DEFAULT_MESSAGES);
  }, [messages, phase]);

  const footerHintDefault = messages?.length ? FOOTER_HINT.default : FOOTER_HINT[phase];
  const footerHint = footerHintProp ?? footerHintDefault;

  const isDeterminate =
    determinatePercent != null && Number.isFinite(determinatePercent);

  const [text, setText] = useState(lines[0] ?? "");
  const [progress, setProgress] = useState(10);

  useEffect(() => {
    if (!open) {
      document.body.style.overflow = "";
      return;
    }
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setText(lines[0] ?? "");
    let messageIndex = 0;
    const messageInterval = setInterval(() => {
      messageIndex = (messageIndex + 1) % lines.length;
      setText(lines[messageIndex] ?? "");
    }, 2000);
    return () => clearInterval(messageInterval);
  }, [open, lines]);

  useEffect(() => {
    if (!open) return;
    if (isDeterminate) {
      setProgress(Math.min(100, Math.max(0, determinatePercent as number)));
      return;
    }
    setProgress(10);
    const progressInterval = setInterval(() => {
      setProgress((prev) => (prev >= 90 ? prev : prev + Math.random() * 10));
    }, 800);
    return () => clearInterval(progressInterval);
  }, [open, isDeterminate, determinatePercent]);

  if (!open) return null;

  const cardClass = panelClassName ?? "max-w-sm";

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/45 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div
        className={`flex w-full flex-col items-center rounded-app-lg bg-card px-8 py-10 shadow-card ring-1 ring-stroke dark:ring-slate-600 ${cardClass}`}
      >
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
        {footerHint ? (
          <p className="mt-4 text-center text-xs text-fg-muted">{footerHint}</p>
        ) : null}
        {children != null && (
          <div className="mt-4 w-full min-w-0 border-t border-stroke pt-4 dark:border-slate-600">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
