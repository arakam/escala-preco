"use client";

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from "react";

export type PrecosTableActions = {
  rowSelectShiftRef: MutableRefObject<boolean>;
  onRowSelectChange: (selectionKey: string, shiftKey: boolean, checked: boolean) => void;
  onCopyToClipboard: (value: string, cellKey: string) => void;
  onRefreshItem: (itemId: string) => void;
  onPriceChange: (id: string, variationId: number | null, value: string) => void;
  onPriceRowCommit: (selectionKey: string, committedPrice: number) => void;
  onMarginCommit: (selectionKey: string, pct: number) => void;
  onApplyMinDiscount: (selectionKey: string) => void;
  getProfitPercent: (selectionKey: string) => number | null;
  formatBRL: (value: number | null | undefined) => string;
};

const PrecosTableActionsContext = createContext<PrecosTableActions | null>(null);

export function usePrecosTableActions(): PrecosTableActions {
  const ctx = useContext(PrecosTableActionsContext);
  if (!ctx) {
    throw new Error("usePrecosTableActions must be used within PrecosTableActionsProvider");
  }
  return ctx;
}

export function PrecosTableActionsProvider({
  actions,
  children,
}: {
  actions: PrecosTableActions;
  children: ReactNode;
}) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const stable = useMemo<PrecosTableActions>(
    () => ({
      rowSelectShiftRef: actions.rowSelectShiftRef,
      onRowSelectChange: (selectionKey, shiftKey, checked) =>
        actionsRef.current.onRowSelectChange(selectionKey, shiftKey, checked),
      onCopyToClipboard: (value, cellKey) => actionsRef.current.onCopyToClipboard(value, cellKey),
      onRefreshItem: (itemId) => actionsRef.current.onRefreshItem(itemId),
      onPriceChange: (id, variationId, value) =>
        actionsRef.current.onPriceChange(id, variationId, value),
      onPriceRowCommit: (selectionKey, committedPrice) =>
        actionsRef.current.onPriceRowCommit(selectionKey, committedPrice),
      onMarginCommit: (selectionKey, pct) => actionsRef.current.onMarginCommit(selectionKey, pct),
      onApplyMinDiscount: (selectionKey) => actionsRef.current.onApplyMinDiscount(selectionKey),
      getProfitPercent: (selectionKey) => actionsRef.current.getProfitPercent(selectionKey),
      formatBRL: (value) => actionsRef.current.formatBRL(value),
    }),
    // rowSelectShiftRef is stable; dispatchers read latest actions via ref
    [actions.rowSelectShiftRef]
  );

  return (
    <PrecosTableActionsContext.Provider value={stable}>{children}</PrecosTableActionsContext.Provider>
  );
}
