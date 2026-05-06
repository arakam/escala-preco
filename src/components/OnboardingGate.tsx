"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useOnboarding } from "@/contexts/onboarding-context";

export type OnboardingRequirement = "ml" | "sync" | "catalog";

const REDIRECTS: Record<OnboardingRequirement, (s: {
  ml_connected: boolean;
  listings_synced: boolean;
  products_imported: boolean;
}) => string | null> = {
  ml: (s) => (s.ml_connected ? null : "/app/configuracao"),
  sync: (s) => {
    if (!s.ml_connected) return "/app/configuracao";
    if (!s.listings_synced) return "/app/anuncios";
    return null;
  },
  catalog: (s) => {
    if (!s.ml_connected) return "/app/configuracao";
    if (!s.listings_synced) return "/app/anuncios";
    if (!s.products_imported) return "/app/produtos";
    return null;
  },
};

export function OnboardingGate({
  required,
  children,
}: {
  required: OnboardingRequirement;
  children: ReactNode;
}) {
  const { status, loading } = useOnboarding();
  const router = useRouter();

  useEffect(() => {
    if (loading || !status) return;
    const path = REDIRECTS[required](status);
    if (path) router.replace(path);
  }, [loading, status, required, router]);

  if (loading || !status) {
    return (
      <div className="rounded-lg border border-stroke bg-card p-8 dark:border-slate-700">
        <p className="text-fg-muted">Verificando etapas de configuração…</p>
      </div>
    );
  }

  if (REDIRECTS[required](status)) {
    return (
      <div className="rounded-lg border border-stroke bg-card p-8 dark:border-slate-700">
        <p className="text-fg-muted">Redirecionando…</p>
      </div>
    );
  }

  return <>{children}</>;
}
