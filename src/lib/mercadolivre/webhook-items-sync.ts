import { runSyncInBackground } from "@/lib/server/after-response";
import { syncSingleItem } from "./sync-worker";

export function isItemsWebhookTopic(topic: string): boolean {
  const t = topic.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  return t === "items";
}

/** Ex.: `/items/MLB5097086620` → `MLB5097086620` */
export function parseItemIdFromWebhookResource(resource: string | null): string | null {
  if (!resource) return null;
  const trimmed = resource.trim();
  const match = trimmed.match(/\/items\/(ML[A-Z]?\d+)/i);
  if (match?.[1]) return match[1].toUpperCase();
  if (/^ML[A-Z]?\d+$/i.test(trimmed)) return trimmed.toUpperCase();
  return null;
}

interface WebhookAccountRow {
  id: string;
  auto_sync_items_webhook?: boolean | null;
}

/**
 * Se a conta tiver sync automático ativo, agenda atualização do anúncio em background.
 * Chamado após persistir a notificação no webhook público.
 */
export function scheduleItemsWebhookSync(
  accounts: WebhookAccountRow[],
  topic: string,
  resource: string | null
): void {
  if (!isItemsWebhookTopic(topic)) return;

  const itemId = parseItemIdFromWebhookResource(resource);
  if (!itemId) {
    console.warn("[ML webhook items] resource sem item_id reconhecível:", resource);
    return;
  }

  for (const acc of accounts) {
    if (!acc.auto_sync_items_webhook) continue;

    runSyncInBackground(async () => {
      const result = await syncSingleItem(acc.id, itemId);
      if (!result.ok) {
        console.warn(
          `[ML webhook items] sync falhou account=${acc.id} item=${itemId}: ${result.error}`
        );
        return;
      }
      console.info(`[ML webhook items] sync OK account=${acc.id} item=${itemId}`);
    });
  }
}
