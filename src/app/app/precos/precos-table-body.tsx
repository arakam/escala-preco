"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useRef, type CSSProperties, type RefObject } from "react";
import type { PriceRoundingConfig } from "@/lib/pricing/price-rounding";
import { PrecosTableActionsProvider, type PrecosTableActions } from "./precos-table-actions";
import { PrecosTableRow } from "./precos-table-row";
import type { ListingWithPricing, PriceReferenceCell } from "./precos-table-utils";
import { listingSelectionKey, priceRefRowKey } from "./precos-table-utils";

/** A partir deste número de linhas, renderiza só as visíveis no viewport. */
const VIRTUALIZE_THRESHOLD = 80;
const PRICING_COLUMN_COUNT = 21;
const ROW_ESTIMATE_PX = 56;
const ROW_OVERSCAN = 10;

export type PrecosTableBodyProps = {
  tableFilterEpoch: string;
  listings: ListingWithPricing[];
  selectedIds: Set<string>;
  stickyColumns: Set<number>;
  stickyBodyStyles: (CSSProperties | undefined)[];
  ordersData: Record<string, number>;
  priceRefsByRow: Record<string, PriceReferenceCell>;
  copiedCell: string | null;
  refreshingItemId: string | null;
  priceRounding: PriceRoundingConfig;
  tableActions: PrecosTableActions;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
};

type PrecosTableBodyInnerProps = Omit<PrecosTableBodyProps, "tableActions">;

function renderPrecosRow(
  listing: ListingWithPricing,
  selectedIds: Set<string>,
  stickyColumns: Set<number>,
  stickyBodyStyles: (CSSProperties | undefined)[],
  ordersData: Record<string, number>,
  priceRefsByRow: Record<string, PriceReferenceCell>,
  copiedCell: string | null,
  refreshingItemId: string | null,
  priceRounding: PriceRoundingConfig
) {
  const selectionKey = listingSelectionKey(listing);
  const mlbCellKey = `mlb-${listing.id}-${listing.variation_id ?? "n"}`;
  const skuCellKey = `sku-${listing.id}-${listing.variation_id ?? "n"}`;

  return (
    <PrecosTableRow
      key={selectionKey}
      listing={listing}
      selectionKey={selectionKey}
      mlbCellKey={mlbCellKey}
      skuCellKey={skuCellKey}
      isSelected={selectedIds.has(selectionKey)}
      stickyColumns={stickyColumns}
      stickyBodyStyles={stickyBodyStyles}
      ordersCount={ordersData[listing.item_id]}
      priceRef={priceRefsByRow[priceRefRowKey(listing.item_id, listing.variation_id)]}
      mlbCopied={copiedCell === mlbCellKey}
      skuCopied={copiedCell === skuCellKey}
      isRefreshing={refreshingItemId === listing.item_id}
      priceRounding={priceRounding}
    />
  );
}

function PlainPrecosTableBodyInner(props: PrecosTableBodyInnerProps) {
  const {
    tableFilterEpoch,
    listings,
    selectedIds,
    stickyColumns,
    stickyBodyStyles,
    ordersData,
    priceRefsByRow,
    copiedCell,
    refreshingItemId,
    priceRounding,
  } = props;

  return (
    <tbody key={tableFilterEpoch}>
      {listings.map((listing) =>
        renderPrecosRow(
          listing,
          selectedIds,
          stickyColumns,
          stickyBodyStyles,
          ordersData,
          priceRefsByRow,
          copiedCell,
          refreshingItemId,
          priceRounding
        )
      )}
    </tbody>
  );
}

function VirtualizedPrecosTableBodyInner(props: PrecosTableBodyInnerProps) {
  const {
    tableFilterEpoch,
    listings,
    selectedIds,
    stickyColumns,
    stickyBodyStyles,
    ordersData,
    priceRefsByRow,
    copiedCell,
    refreshingItemId,
    priceRounding,
    scrollContainerRef,
  } = props;

  const listingsRef = useRef(listings);
  listingsRef.current = listings;

  const virtualizer = useVirtualizer({
    count: listings.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: ROW_OVERSCAN,
    getItemKey: (index) => listingSelectionKey(listingsRef.current[index]!),
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0]!.start : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalHeight - virtualItems[virtualItems.length - 1]!.end : 0;

  return (
    <tbody key={tableFilterEpoch}>
      {paddingTop > 0 && (
        <tr aria-hidden="true">
          <td
            colSpan={PRICING_COLUMN_COUNT}
            style={{ height: paddingTop, padding: 0, border: "none", lineHeight: 0 }}
          />
        </tr>
      )}
      {virtualItems.map((virtualRow) => {
        const listing = listings[virtualRow.index];
        if (!listing) return null;
        return renderPrecosRow(
          listing,
          selectedIds,
          stickyColumns,
          stickyBodyStyles,
          ordersData,
          priceRefsByRow,
          copiedCell,
          refreshingItemId,
          priceRounding
        );
      })}
      {paddingBottom > 0 && (
        <tr aria-hidden="true">
          <td
            colSpan={PRICING_COLUMN_COUNT}
            style={{ height: paddingBottom, padding: 0, border: "none", lineHeight: 0 }}
          />
        </tr>
      )}
    </tbody>
  );
}

function PrecosTableBodyInner(props: PrecosTableBodyInnerProps) {
  if (props.listings.length >= VIRTUALIZE_THRESHOLD) {
    return <VirtualizedPrecosTableBodyInner {...props} />;
  }
  return <PlainPrecosTableBodyInner {...props} />;
}

const MemoPrecosTableBodyInner = memo(PrecosTableBodyInner);

export function PrecosTableBody({ tableActions, ...props }: PrecosTableBodyProps) {
  return (
    <PrecosTableActionsProvider actions={tableActions}>
      <MemoPrecosTableBodyInner {...props} />
    </PrecosTableActionsProvider>
  );
}

export const MemoPrecosTableBody = memo(PrecosTableBody);
