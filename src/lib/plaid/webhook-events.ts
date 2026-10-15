/**
 * Which verified Plaid webhooks Walkup acts on. A deliberately tiny allow-list:
 * only item-level problems that need a person, and only the item id and the
 * code are ever read from the body. Everything else (including
 * SYNC_UPDATES_AVAILABLE, which the daily cron covers) is a no-op.
 */
const ITEM_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function itemToFlag(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as {
    webhook_type?: unknown;
    webhook_code?: unknown;
    item_id?: unknown;
    error?: { error_code?: unknown } | null;
  };
  if (p.webhook_type !== "ITEM") return null;
  if (typeof p.item_id !== "string" || !ITEM_ID.test(p.item_id)) return null;

  switch (p.webhook_code) {
    case "ERROR":
      return p.error?.error_code === "ITEM_LOGIN_REQUIRED" ? p.item_id : null;
    case "PENDING_DISCONNECT":
    case "USER_PERMISSION_REVOKED":
    case "USER_ACCOUNT_REVOKED":
      return p.item_id;
    default:
      return null;
  }
}
