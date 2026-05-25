"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { communicationCategoryLabel } from "@/lib/mercadolivre/communication-labels";

export interface MLCommunicationNoticeRow {
  id: string;
  notice_id: string;
  label: string;
  title: string | null;
  description: string | null;
  highlighted: boolean;
  from_date: string | null;
  category: string | null;
  sub_category: string | null;
  tags: Array<{ tag?: string; type?: string }>;
  actions: Array<{ text?: string; link?: string }>;
  read_at: string | null;
}

function formatNoticeDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"
      />
    </svg>
  );
}

export function MlCommunicationsBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connected, setConnected] = useState(true);
  const [notices, setNotices] = useState<MLCommunicationNoticeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    try {
      const res = await fetch("/api/mercadolivre/communications/unread-count");
      if (!res.ok) return;
      const data = (await res.json()) as { unread_count?: number; connected?: boolean };
      setUnreadCount(data.unread_count ?? 0);
      setConnected(data.connected !== false);
    } catch {
      /* ignore polling errors */
    }
  }, []);

  const loadPanel = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mercadolivre/communications?sync=1");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || "Não foi possível carregar avisos.");
        setNotices([]);
        return;
      }
      const payload = data as {
        notices?: MLCommunicationNoticeRow[];
        unread_count?: number;
      };
      setNotices(payload.notices ?? []);
      setUnreadCount(payload.unread_count ?? 0);
      setConnected(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    const id = window.setInterval(() => void refreshCount(), 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [refreshCount]);

  useEffect(() => {
    if (open) void loadPanel();
  }, [open, loadPanel]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function markRead(noticeId: string) {
    const res = await fetch(`/api/mercadolivre/communications/${encodeURIComponent(noticeId)}/read`, {
      method: "PATCH",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { unread_count?: number };
    const nextUnread = data.unread_count ?? Math.max(0, unreadCount - 1);
    setUnreadCount(nextUnread);
    setNotices((prev) =>
      prev.map((n) =>
        n.notice_id === noticeId ? { ...n, read_at: new Date().toISOString() } : n
      )
    );
  }

  async function markAllRead() {
    const res = await fetch("/api/mercadolivre/communications/read-all", { method: "POST" });
    if (!res.ok) return;
    setUnreadCount(0);
    setNotices((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
  }

  const panelNotices = [...notices].sort((a, b) => {
    if (!a.read_at && b.read_at) return -1;
    if (a.read_at && !b.read_at) return 1;
    const da = a.from_date ? new Date(a.from_date).getTime() : 0;
    const db = b.from_date ? new Date(b.from_date).getTime() : 0;
    return db - da;
  });

  const preview = panelNotices.slice(0, 8);

  if (!connected && unreadCount === 0 && !open) {
    return null;
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn btn-icon btn-sm btn-outline-secondary relative"
        aria-label={
          unreadCount > 0
            ? `Avisos do Mercado Livre, ${unreadCount} não lida${unreadCount === 1 ? "" : "s"}`
            : "Avisos do Mercado Livre"
        }
        aria-expanded={open}
        aria-haspopup="true"
      >
        <BellIcon className="h-5 w-5 text-slate-600 dark:text-slate-300" />
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white"
            style={{ backgroundColor: "var(--adminty-accent, #01a9ac)" }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-900"
          role="dialog"
          aria-label="Avisos do Mercado Livre"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Avisos do Mercado Livre</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                Marcar todas como lidas
              </button>
            )}
          </div>

          <div className="max-h-[min(24rem,70vh)] overflow-y-auto">
            {loading && notices.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-500">Carregando…</p>
            )}
            {error && (
              <p className="px-3 py-4 text-sm text-amber-700 dark:text-amber-300">{error}</p>
            )}
            {!loading && !error && preview.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                Nenhuma comunicação vigente no momento.
              </p>
            )}
            {preview.map((n) => {
              const cat = communicationCategoryLabel(n.category);
              const isUnread = !n.read_at;
              return (
                <article
                  key={n.id}
                  className={`border-b border-slate-100 px-3 py-3 last:border-b-0 dark:border-slate-800 ${
                    isUnread ? "bg-teal-50/50 dark:bg-teal-950/20" : ""
                  }`}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    {isUnread && (
                      <span className="rounded bg-teal-600/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-800 dark:text-teal-300">
                        Nova
                      </span>
                    )}
                    {n.highlighted && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                        Destaque
                      </span>
                    )}
                    {cat && (
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">{cat}</span>
                    )}
                  </div>
                  <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {n.title?.trim() || n.label}
                  </h3>
                  {n.description && (
                    <p className="mt-1 line-clamp-3 text-xs text-slate-600 dark:text-slate-400">
                      {n.description.trim()}
                    </p>
                  )}
                  {n.from_date && (
                    <p className="mt-1 text-[10px] text-slate-400">{formatNoticeDate(n.from_date)}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {isUnread && (
                      <button
                        type="button"
                        onClick={() => void markRead(n.notice_id)}
                        className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Marcar como lida
                      </button>
                    )}
                    {(n.actions ?? []).map((action, i) =>
                      action.link ? (
                        <a
                          key={`${n.notice_id}-action-${i}`}
                          href={action.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                          onClick={() => {
                            if (isUnread) void markRead(n.notice_id);
                          }}
                        >
                          {action.text || "Abrir"}
                        </a>
                      ) : null
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/80">
            <Link
              href="/app/configuracao?tab=comunicacoes"
              className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              onClick={() => setOpen(false)}
            >
              Ver todas em Configuração
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
