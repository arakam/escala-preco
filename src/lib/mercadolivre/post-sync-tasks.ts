/**
 * Tarefas pós sync de anúncios (fase A): produtos, cache de preços, vendas 30d.
 * Roda em background — não bloqueia a UI nem o job sync_items.
 */
export async function runPostSyncBackgroundTasks(
  accountId: string,
  triggerSyncJobId: string
): Promise<void> {
  try {
    const { autoCreateProductsFromMlSync } = await import("@/lib/products/auto-create-from-ml-sync");
    const autoProd = await autoCreateProductsFromMlSync(accountId);
    if (autoProd.ok && !autoProd.skipped_disabled) {
      console.log(`[sync:${triggerSyncJobId}] produtos auto (background)`, {
        created: autoProd.products_created,
        updated: autoProd.products_updated,
        linked: autoProd.items_linked + autoProd.variations_linked,
      });
    }
  } catch (err) {
    console.error(`[sync:${triggerSyncJobId}] auto-create products (background)`, err);
  }

  try {
    const { refreshPricingCache } = await import("@/lib/pricing-cache");
    await refreshPricingCache(accountId);
  } catch (err) {
    console.error(`[sync:${triggerSyncJobId}] pricing cache refresh (background)`, err);
  }

  try {
    const { maybeKickSalesBackfillAfterItemsSync } = await import(
      "@/lib/mercadolivre/schedule-sales-backfill"
    );
    await maybeKickSalesBackfillAfterItemsSync(accountId, { triggerSyncJobId });
  } catch (err) {
    console.error(`[sync:${triggerSyncJobId}] auto sales backfill (background)`, err);
  }
}
