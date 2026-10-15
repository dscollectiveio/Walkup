/**
 * Small, timezone-safe date words for lists. Dates arrive as "YYYY-MM-DD"
 * (a bank's posting date has no time of day); timestamps as ISO strings.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 14", or "Sep 14, 2025" when it isn't this year. */
export function shortDate(dateIso: string, todayIso: string): string {
  const [y, m, d] = dateIso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return dateIso;
  const base = `${MONTHS[m - 1]} ${d}`;
  return String(y) === todayIso.slice(0, 4) ? base : `${base}, ${y}`;
}

/** Today as "YYYY-MM-DD" in the machine's local zone. */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** "synced just now" / "synced 3 hours ago" / "synced yesterday" / "synced 4 days ago" / "not synced yet". */
export function syncedAgo(lastSyncedAt: string | null, now: Date = new Date()): string {
  if (!lastSyncedAt) return "not synced yet";
  const ms = now.getTime() - new Date(lastSyncedAt).getTime();
  if (Number.isNaN(ms)) return "not synced yet";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 2) return "synced just now";
  if (minutes < 60) return `synced ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `synced ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "synced yesterday";
  return `synced ${days} days ago`;
}

const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The building's "today" (America/Chicago) as YYYY-MM-DD, regardless of the
 * server's zone (Vercel runs in UTC). Walkup is Illinois-only, and the AI
 * quota day in SQL (`ai_day_start()`) uses the same zone.
 */
export function buildingTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** "October 14, 2026" from "2026-10-14" or an ISO timestamp (date part, no zone shift). Junk passes through. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return iso;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return iso;
  return `${LONG_MONTHS[mo - 1]} ${d}, ${y}`;
}
