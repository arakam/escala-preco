/** PMA cadastrado no produto (> 0) usado como piso da promoção na tela de preços. */
export function listingPmaFloor(pma: number | null | undefined): number | null {
  if (pma == null || !Number.isFinite(Number(pma))) return null;
  const n = Number(pma);
  if (n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function clampPromoPriceToPmaFloor(
  price: number,
  pma: number | null | undefined
): { price: number; clamped: boolean; pmaFloor: number | null } {
  const floor = listingPmaFloor(pma);
  if (floor == null || !Number.isFinite(price)) {
    return { price, clamped: false, pmaFloor: floor };
  }
  const rounded = Math.round(price * 100) / 100;
  if (rounded < floor) {
    return { price: floor, clamped: true, pmaFloor: floor };
  }
  return { price: rounded, clamped: false, pmaFloor: floor };
}

export function formatPmaFloorBrl(pmaFloor: number): string {
  return pmaFloor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPmaClampSingleMessage(
  listing: { title?: string | null; item_id: string },
  pmaFloor: number
): string {
  const label = listing.title?.trim() || listing.item_id;
  return `Promoção ajustada ao PMA (R$ ${formatPmaFloorBrl(pmaFloor)}) em ${label}.`;
}

export function formatPmaClampBulkSuffix(clampedCount: number): string {
  if (clampedCount <= 0) return "";
  if (clampedCount === 1) {
    return " 1 anúncio teve a promoção ajustada ao PMA cadastrado no produto.";
  }
  return ` ${clampedCount} anúncios tiveram a promoção ajustada ao PMA cadastrado no produto.`;
}
