/**
 * The one word that says whether Walkup can send for this building right now
 * (money spec 8.4). Pure: the page passes in the configuration result and the
 * email_settings row.
 */
export type EmailStatus = "not_set_up" | "off" | "on" | "suspended";

export interface SettingsRow {
  sending_enabled: boolean;
  enabled_at: string | null;
  daily_cap: number;
  suspended_at: string | null;
  suspended_reason: string | null;
}

export function emailStatus(configOk: boolean, settings: SettingsRow | null): EmailStatus {
  if (settings?.suspended_at) return "suspended";
  if (!configOk) return "not_set_up";
  return settings?.sending_enabled ? "on" : "off";
}

export const WARM_UP_DAYS = 7;
export const WARM_UP_DAILY = 20;

/** The limit for today: 20 a day for the first week after sending is switched on, then the board's own limit. */
export function dailyLimit(settings: Pick<SettingsRow, "daily_cap" | "enabled_at">, nowMs: number): number {
  const enabled = settings.enabled_at ? Date.parse(settings.enabled_at) : NaN;
  const warming = Number.isFinite(enabled) && nowMs - enabled < WARM_UP_DAYS * 86_400_000;
  return warming ? Math.min(settings.daily_cap, WARM_UP_DAILY) : settings.daily_cap;
}

export function isWarmingUp(settings: Pick<SettingsRow, "enabled_at">, nowMs: number): boolean {
  const enabled = settings.enabled_at ? Date.parse(settings.enabled_at) : NaN;
  return Number.isFinite(enabled) && nowMs - enabled < WARM_UP_DAYS * 86_400_000;
}

export const OFF_STRIP = "Reminders open in your own email app. Turn on sending to send them from Walkup after you approve them.";

/** "reminders", "statements", "announcements" or "all", for the board's opt-out line. */
export function optoutWords(f: { dues_reminders: boolean; statements: boolean; announcements: boolean; unsubscribed_all: boolean }): string {
  if (f.unsubscribed_all) return "all";
  const parts: string[] = [];
  if (!f.dues_reminders) parts.push("reminders");
  if (!f.statements) parts.push("statements");
  if (!f.announcements) parts.push("announcements");
  return parts.join(", ");
}
