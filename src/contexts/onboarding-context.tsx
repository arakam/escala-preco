"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type OnboardingStatus = {
  ml_connected: boolean;
  listings_synced: boolean;
  products_imported: boolean;
  current_step: 1 | 2 | 3 | 4;
};

type OnboardingContextValue = {
  status: OnboardingStatus | null;
  loading: boolean;
  reload: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const params = new URLSearchParams();
        if (accountId) params.set("accountId", accountId);
        const res = await fetch(`/api/onboarding/status?${params.toString()}`);
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as OnboardingStatus;
          setStatus(data);
        } else {
          setStatus(null);
        }
      } catch {
        if (!cancelled) setStatus(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, refreshKey]);

  const reload = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <OnboardingContext.Provider value={{ status, loading, reload }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding deve ser usado dentro de OnboardingProvider");
  }
  return ctx;
}
