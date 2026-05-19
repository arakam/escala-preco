import { createServiceClient } from "@/lib/supabase/service";
import { refreshPromotionsForItems } from "@/lib/mercadolivre/promotions-cache";
import { runSyncInBackground } from "@/lib/server/after-response";

const DEBOUNCE_MS = 8_000;

/** accountId:itemId → timer */
const pendingRefresh = new Map<string, ReturnType<typeof setTimeout>>();

interface WebhookAccountRow {
  id: string;
  user_id: string;
}

/**
 * Após webhook de promoção (public_candidates / public_offers), atualiza o cache
 * do anúncio no ML em background (debounce por conta + item).
 */
export function schedulePromotionsWebhookCacheRefresh(
  accounts: WebhookAccountRow[],
  itemId: string | null | undefined
): void {
  const id = itemId != null ? String(itemId).trim().toUpperCase() : "";
  if (!id || !/^ML[A-Z]?\d+$/i.test(id)) return;

  for (const acc of accounts) {
    const key = `${acc.id}:${id}`;
    const prev = pendingRefresh.get(key);
    if (prev) clearTimeout(prev);

    const timer = setTimeout(() => {
      pendingRefresh.delete(key);
      runSyncInBackground(async () => {
        try {
          const supabase = createServiceClient();
          const result = await refreshPromotionsForItems({
            supabase,
            accountId: acc.id,
            userId: acc.user_id,
            itemIds: [id],
          });
          if (result.refreshed.length > 0) {
            console.info(
              `[ML webhook promotions] cache OK account=${acc.id} item=${id}`
            );
          } else if (result.skipped.length > 0) {
            console.warn(
              `[ML webhook promotions] cache skip account=${acc.id} item=${id}`
            );
          }
        } catch (e) {
          console.error(
            `[ML webhook promotions] cache refresh account=${acc.id} item=${id}:`,
            e
          );
        }
      });
    }, DEBOUNCE_MS);

    pendingRefresh.set(key, timer);
  }
}
