"use client";

import { memo, type CSSProperties } from "react";
import { splitMlActivePromotionsCell } from "@/lib/mercadolivre/seller-promotions-item";
import {
  applyPriceRounding,
  type PriceRoundingConfig,
} from "@/lib/pricing/price-rounding";
import { usePrecosTableActions } from "./precos-table-actions";
import { MarginInput, PriceInput } from "./precos-table-inputs";
import type { ListingWithPricing, PriceReferenceCell } from "./precos-table-utils";
import {
  competitivenessBadge,
  meetsMlMinCampaignDiscount,
  skuDisplayParts,
} from "./precos-table-utils";

function LinkStatusIcon({ linked }: { linked: boolean }) {
  if (linked) {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className="h-3.5 w-3.5 text-slate-400 dark:text-slate-300"
      >
        <path
          d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0 0-7.07a5 5 0 0 0-7.07 0L10.5 5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14 11a5 5 0 0 0-7.07 0L5.5 12.5a5 5 0 0 0 0 7.07a5 5 0 0 0 7.07 0L13.5 19"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className="h-3.5 w-3.5 text-slate-400 dark:text-slate-300"
    >
      <path
        d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0 0-7.07a5 5 0 0 0-7.07 0L10.5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 11a5 5 0 0 0-7.07 0L5.5 12.5a5 5 0 0 0 0 7.07a5 5 0 0 0 7.07 0L13.5 19"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 3l18 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function mlPromotionsBadge(count: number): { label: string; className: string } {
  if (count <= 0) {
    return { label: "0", className: "bg-gray-200 text-fg dark:bg-slate-600 dark:text-slate-200" };
  }
  return {
    label: count === 1 ? "1 campanha" : `${count} campanhas`,
    className: "bg-green-200 text-green-800 dark:bg-green-900/50 dark:text-green-200",
  };
}

function MlActivePromotionsCell({ text }: { text: string | null | undefined }) {
  const lines = splitMlActivePromotionsCell(text ?? "");
  const count = lines.length;
  const { label, className } = mlPromotionsBadge(count);
  const title =
    count > 0
      ? lines.join("\n")
      : "Nenhuma promoção ativa no cache. Atualize em Promoções (Recarregar) e depois o cache de Preços.";
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${className}`} title={title}>
      {label}
    </span>
  );
}

function MLIcon({ className }: { className?: string }) {
  return (
    <img
      src="https://www.mercadolivre.com.br/favicon.ico"
      alt=""
      width={20}
      height={20}
      className={className}
    />
  );
}

export type PrecosTableRowProps = {
  listing: ListingWithPricing;
  selectionKey: string;
  mlbCellKey: string;
  skuCellKey: string;
  isSelected: boolean;
  stickyColumns: Set<number>;
  stickyBodyStyles: (CSSProperties | undefined)[];
  ordersCount?: number;
  priceRef?: PriceReferenceCell;
  mlbCopied: boolean;
  skuCopied: boolean;
  isRefreshing: boolean;
  priceRounding: PriceRoundingConfig;
};

export const PrecosTableRow = memo(function PrecosTableRow({
  listing,
  selectionKey,
  mlbCellKey,
  skuCellKey,
  isSelected,
  stickyColumns,
  stickyBodyStyles,
  ordersCount,
  priceRef,
  mlbCopied,
  skuCopied,
  isRefreshing,
  priceRounding,
}: PrecosTableRowProps) {
  const actions = usePrecosTableActions();
  const formatBRL = actions.formatBRL;

  const profit =
    listing.calculated && listing.cost_price != null
      ? listing.calculated.net_amount - listing.cost_price
      : null;
  const profitPercent =
    profit != null && listing.new_price > 0 ? (profit / listing.new_price) * 100 : null;

  const mlFeeSharePct = listing.calculating
    ? null
    : listing.calculated && listing.calculated.price > 0
      ? (listing.calculated.fee / listing.calculated.price) * 100
      : listing.reference_fee_percent != null && Number.isFinite(Number(listing.reference_fee_percent))
        ? Number(listing.reference_fee_percent)
        : null;
  const mlFeeShareIsReference = !listing.calculating && !listing.calculated && mlFeeSharePct != null;

  const competitiveness = (() => {
    const st = priceRef?.status ?? "none";
    const { label, className } = competitivenessBadge(st);
    const tip = [
      priceRef?.explanation,
      priceRef?.updated_at ? `Atualizado: ${new Date(priceRef.updated_at).toLocaleString("pt-BR")}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    return { label, className, tip };
  })();

  return (
    <tr className="table-body-row">
      <td
        className={`p-2 text-center ${stickyColumns.has(0) ? "sticky-col" : ""}`}
        style={stickyBodyStyles[0]}
      >
        <input
          type="checkbox"
          className="rounded border-gray-300"
          checked={isSelected}
          onMouseDown={(e) => {
            actions.rowSelectShiftRef.current = e.shiftKey;
          }}
          onChange={(e) => {
            actions.onRowSelectChange(selectionKey, actions.rowSelectShiftRef.current, e.target.checked);
          }}
        />
      </td>
      <td className={`p-2 ${stickyColumns.has(1) ? "sticky-col" : ""}`} style={stickyBodyStyles[1]}>
        {listing.thumbnail ? (
          <img
            src={listing.thumbnail.replace(/^http:/, "https:")}
            alt=""
            className="h-10 w-10 rounded-lg border border-slate-100 bg-slate-50 object-contain"
          />
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </td>
      <td className={`p-2 ${stickyColumns.has(2) ? "sticky-col" : ""}`} style={stickyBodyStyles[2]}>
        <div className="flex items-center gap-1">
          <span
            role="button"
            tabIndex={0}
            onClick={() => actions.onCopyToClipboard(listing.item_id, mlbCellKey)}
            onKeyDown={(e) => e.key === "Enter" && actions.onCopyToClipboard(listing.item_id, mlbCellKey)}
            title="Clique para copiar"
            className="pricing-cell-chip font-mono text-xs"
          >
            {mlbCopied ? (
              <span className="text-xs font-semibold text-emerald-600">Copiado!</span>
            ) : (
              listing.item_id
            )}
            {listing.variation_id && <span className="block text-fg-muted">var: {listing.variation_id}</span>}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              actions.onRefreshItem(listing.item_id);
            }}
            disabled={isRefreshing}
            title="Atualizar este item no cache"
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:text-slate-300 disabled:opacity-50"
          >
            {isRefreshing ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            )}
          </button>
        </div>
      </td>
      <td
        className={`p-2 text-sm ${stickyColumns.has(3) ? "sticky-col" : ""}`}
        style={stickyBodyStyles[3]}
        title={listing.title ?? ""}
      >
        <span className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-50">
          {listing.title ?? "—"}
        </span>
      </td>
      <td
        className={`p-2 font-mono text-xs text-slate-700 dark:text-slate-200 ${stickyColumns.has(4) ? "sticky-col" : ""}`}
        style={stickyBodyStyles[4]}
      >
        {listing.sku ? (
          (() => {
            const { primary, extraCount } = skuDisplayParts(listing.sku);
            if (!primary) return <span className="text-fg-muted">—</span>;
            const linked = Boolean(listing.product_id);
            return (
              <span
                role="button"
                tabIndex={0}
                onClick={() => actions.onCopyToClipboard(primary, skuCellKey)}
                onKeyDown={(e) => e.key === "Enter" && actions.onCopyToClipboard(primary, skuCellKey)}
                title={listing.sku}
                className="pricing-cell-chip inline-flex items-center gap-1 text-left"
              >
                {skuCopied ? (
                  <span className="text-xs font-semibold text-emerald-600">Copiado!</span>
                ) : (
                  <>
                    <span>{primary}</span>
                    {extraCount > 0 && (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                        +{extraCount}
                      </span>
                    )}
                    <span
                      title={linked ? "Vinculado a produto" : "Sem vínculo com produto"}
                      className="ml-0.5 inline-flex"
                    >
                      <LinkStatusIcon linked={linked} />
                    </span>
                  </>
                )}
              </span>
            );
          })()
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </td>
      <td
        className={`p-2 text-right text-sm tabular-nums ${stickyColumns.has(5) ? "sticky-col" : ""}`}
        style={stickyBodyStyles[5]}
        title={
          ordersCount != null
            ? `${ordersCount} pedido(s) pago(s) em 30 dias`
            : "Número de pedidos pagos que contêm este item."
        }
      >
        {ordersCount != null ? ordersCount : <span className="text-fg-muted">—</span>}
      </td>
      <td
        className={`p-2 text-right text-sm font-medium ${stickyColumns.has(6) ? "sticky-col" : ""}`}
        style={stickyBodyStyles[6]}
      >
        R$ {formatBRL(listing.current_price)}
      </td>
      <td className={`p-2 text-right ${stickyColumns.has(7) ? "sticky-col" : ""}`} style={stickyBodyStyles[7]}>
        {listing.calculating ? (
          <span className="text-fg-muted">…</span>
        ) : (
          <MarginInput
            valuePercent={actions.getProfitPercent(selectionKey)}
            disabled={listing.cost_price == null || !listing.listing_type_id || !listing.category_id}
            dirty={listing.dirty}
            onCommit={(pct) => actions.onMarginCommit(selectionKey, pct)}
          />
        )}
      </td>
      <td className={`p-2 ${stickyColumns.has(8) ? "sticky-col" : ""}`} style={stickyBodyStyles[8]}>
        <div className="flex flex-col items-end gap-0.5">
          <PriceInput
            value={listing.new_price}
            onChange={(newValue) =>
              actions.onPriceChange(listing.id, listing.variation_id, String(newValue))
            }
            onCommit={(committed) => actions.onPriceRowCommit(selectionKey, committed)}
            dirty={listing.dirty}
          />
          {listing.current_price > 0 && listing.new_price > 0 && !meetsMlMinCampaignDiscount(listing) && (
            <button
              type="button"
              onClick={() => actions.onApplyMinDiscount(selectionKey)}
              disabled={listing.calculating}
              className="text-xs whitespace-nowrap text-amber-600 underline hover:text-amber-700 disabled:opacity-50"
              title="Clique para ajustar ao desconto mínimo de 5% (preço calculado = 95% do preço ML)"
            >
              Ajustar para 5%
            </button>
          )}
        </div>
      </td>
      <td
        className={`p-2 text-right text-sm font-medium ${stickyColumns.has(9) ? "sticky-col" : ""}`}
        style={stickyBodyStyles[9]}
      >
        {listing.new_price > 0 ? (
          (() => {
            const finalPrice = applyPriceRounding(listing.new_price, priceRounding);
            const rounded = priceRounding.enabled && Math.abs(finalPrice - listing.new_price) >= 0.005;
            return (
              <span
                className={rounded ? "text-indigo-700 dark:text-indigo-300" : "text-fg"}
                title={
                  rounded
                    ? `Arredondado de R$ ${formatBRL(listing.new_price)} (Configuração → Preços)`
                    : priceRounding.enabled
                      ? "Igual ao Preço Calculado"
                      : "Arredondamento desativado em Configuração → Preços"
                }
              >
                R$ {formatBRL(finalPrice)}
              </span>
            );
          })()
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </td>
      <td
        className={`p-2 text-right text-sm font-semibold ${stickyColumns.has(10) ? "sticky-col" : ""}`}
        style={stickyBodyStyles[10]}
      >
        {listing.calculating ? (
          <span className="text-fg-muted">…</span>
        ) : listing.calculated ? (
          <span className="text-green-700">R$ {formatBRL(listing.calculated.vai_receber)}</span>
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </td>
      <td className={`p-2 text-right text-sm ${stickyColumns.has(11) ? "sticky-col" : ""}`} style={stickyBodyStyles[11]}>
        {listing.calculating ? (
          <span className="text-fg-muted">…</span>
        ) : profit != null ? (
          <div className="flex flex-col items-end">
            <span className={profit >= 0 ? "text-green-600" : "text-red-600"}>R$ {formatBRL(profit)}</span>
            {profitPercent != null && (
              <span className={`text-xs ${profitPercent >= 0 ? "text-green-500" : "text-red-500"}`}>
                {profitPercent >= 0 ? "+" : ""}
                {profitPercent.toFixed(1)}%
              </span>
            )}
          </div>
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </td>
      <td className={`p-2 text-right text-sm ${stickyColumns.has(12) ? "sticky-col" : ""}`} style={stickyBodyStyles[12]}>
        {listing.calculating ? (
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-fg-muted">…</span>
            <span className="text-xs text-fg-muted">…</span>
          </div>
        ) : listing.calculated ? (
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-amber-700">R$ {formatBRL(listing.calculated.fee)}</span>
            {mlFeeSharePct != null && (
              <span
                className={`text-xs tabular-nums ${
                  mlFeeShareIsReference ? "text-slate-400 dark:text-slate-500" : "text-amber-600 dark:text-amber-500"
                }`}
                title={
                  mlFeeShareIsReference
                    ? "Referência por categoria/tipo (última sync)"
                    : "Taxa ML ÷ Preço Calculado (último cálculo)"
                }
              >
                {mlFeeSharePct.toFixed(1).replace(".", ",")}%
              </span>
            )}
          </div>
        ) : !listing.listing_type_id ? (
          <span className="text-red-400" title="Tipo de anúncio não disponível">
            N/D
          </span>
        ) : (
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-fg-muted">—</span>
            {mlFeeSharePct != null && mlFeeShareIsReference ? (
              <span
                className="text-xs tabular-nums text-slate-400 dark:text-slate-500"
                title="Referência de taxa por categoria/tipo (última sincronização). Calcule ou edite o Preço Calculado para ver o valor em R$."
              >
                {mlFeeSharePct.toFixed(1).replace(".", ",")}%
              </span>
            ) : null}
          </div>
        )}
      </td>
      <td className={`p-2 text-right text-sm ${stickyColumns.has(13) ? "sticky-col" : ""}`} style={stickyBodyStyles[13]}>
        {listing.calculating ? (
          <span className="text-fg-muted">…</span>
        ) : listing.calculated ? (
          <span className={listing.calculated.shipping_cost > 0 ? "text-red-600" : "text-fg-muted"}>
            {listing.calculated.shipping_cost > 0
              ? `R$ ${formatBRL(listing.calculated.shipping_cost)}`
              : "—"}
          </span>
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </td>
      <td className={`p-2 text-right text-sm ${stickyColumns.has(14) ? "sticky-col" : ""}`} style={stickyBodyStyles[14]}>
        {listing.cost_price != null ? (
          <span className="text-fg">R$ {formatBRL(listing.cost_price)}</span>
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </td>
      <td className={`p-2 text-right text-sm ${stickyColumns.has(15) ? "sticky-col" : ""}`} style={stickyBodyStyles[15]}>
        {listing.calculating ? (
          <span className="text-fg-muted">…</span>
        ) : listing.calculated ? (
          <span
            className={listing.calculated.tax_amount > 0 ? "text-orange-600" : "text-fg-muted"}
            title={listing.tax_percent ? `${listing.tax_percent}%` : undefined}
          >
            {listing.calculated.tax_amount > 0 ? `R$ ${formatBRL(listing.calculated.tax_amount)}` : "—"}
          </span>
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </td>
      <td className={`p-2 text-right text-sm ${stickyColumns.has(16) ? "sticky-col" : ""}`} style={stickyBodyStyles[16]}>
        {listing.calculating ? (
          <span className="text-fg-muted">…</span>
        ) : listing.calculated ? (
          <span
            className={listing.calculated.extra_fee_amount > 0 ? "text-purple-600" : "text-fg-muted"}
            title={listing.extra_fee_percent ? `${listing.extra_fee_percent}%` : undefined}
          >
            {listing.calculated.extra_fee_amount > 0
              ? `R$ ${formatBRL(listing.calculated.extra_fee_amount)}`
              : "—"}
          </span>
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </td>
      <td className={`p-2 text-right text-sm ${stickyColumns.has(17) ? "sticky-col" : ""}`} style={stickyBodyStyles[17]}>
        {listing.calculating ? (
          <span className="text-fg-muted">…</span>
        ) : listing.calculated ? (
          <span
            className={listing.calculated.fixed_expenses_amount > 0 ? "text-indigo-600" : "text-fg-muted"}
            title={listing.fixed_expenses != null ? `R$ ${formatBRL(listing.fixed_expenses)}` : undefined}
          >
            {listing.calculated.fixed_expenses_amount > 0
              ? `R$ ${formatBRL(listing.calculated.fixed_expenses_amount)}`
              : "—"}
          </span>
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </td>
      <td className={`p-2 text-right ${stickyColumns.has(18) ? "sticky-col" : ""}`} style={stickyBodyStyles[18]}>
        <MlActivePromotionsCell text={listing.ml_active_promotions} />
      </td>
      <td className={`p-2 text-right ${stickyColumns.has(19) ? "sticky-col" : ""}`} style={stickyBodyStyles[19]}>
        <span
          className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${competitiveness.className}`}
          title={competitiveness.tip || undefined}
        >
          {competitiveness.label}
        </span>
      </td>
      <td className={`p-2 ${stickyColumns.has(20) ? "sticky-col" : ""}`} style={stickyBodyStyles[20]}>
        {listing.permalink ? (
          <a
            href={listing.permalink}
            target="_blank"
            rel="noopener noreferrer"
            title="Ver no Mercado Livre"
            className="inline-flex items-center justify-center rounded-full bg-primary/10 p-1.5 text-primary hover:bg-primary/15"
          >
            <MLIcon className="h-5 w-5" />
          </a>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </td>
    </tr>
  );
});
