import type { RawCharge, RawOwner } from "./build";
import type { CollectionUnit } from "./suggest";

/**
 * "Who would get a reminder today" for a standing rule, read-only (money spec
 * 8.4). The same conditions email_run_rules applies in SQL, evaluated on what
 * the Collections page already loaded. It sends and writes nothing. If it and
 * the SQL ever disagree, the SQL wins: the rule only ever emails who it allows.
 */
export interface PreviewRule {
  kind: "dues_upcoming" | "dues_overdue";
  days: number;
  minAmountCents: number;
  repeatEveryDays: number;
  maxReminders: number;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function previewRule(
  rule: PreviewRule,
  input: {
    todayIso: string;
    behind: CollectionUnit[];
    units: { id: string; label: string }[];
    charges: RawCharge[];
    owners: RawOwner[];
    suppressed: Map<string, "bounce" | "complaint">;
    optedOutPersonIds: Set<string>;
    /** Unit ids that were emailed a dues reminder within the last 7 days. */
    recentlyEmailedUnitIds: Set<string>;
  },
): { labels: string[] } {
  const { todayIso } = input;
  const reachable = (unitId: string) =>
    input.owners.some(
      (o) =>
        o.unit_id === unitId &&
        (o.email ?? "").trim() !== "" &&
        !input.suppressed.has((o.email ?? "").toLowerCase()) &&
        !input.optedOutPersonIds.has(o.person_id),
    );

  if (rule.kind === "dues_overdue") {
    const labels = input.behind
      .filter(
        (u) =>
          u.daysOverdue >= rule.days &&
          u.owedCents >= rule.minAmountCents &&
          u.remindersSent < rule.maxReminders &&
          (u.lastReminderOn === null || daysBetween(u.lastReminderOn, todayIso) >= rule.repeatEveryDays) &&
          !input.recentlyEmailedUnitIds.has(u.unitId) &&
          reachable(u.unitId),
      )
      .map((u) => u.label);
    return { labels };
  }

  const behindIds = new Set(input.behind.map((u) => u.unitId));
  const labels: string[] = [];
  for (const unit of input.units) {
    if (behindIds.has(unit.id)) continue;
    const open = input.charges.filter((c) => c.unit_id === unit.id && c.balanceCents > 0);
    const owed = open.reduce((s, c) => s + c.balanceCents, 0);
    const upcoming = open.filter((c) => c.due_on >= todayIso).map((c) => c.due_on).sort()[0];
    if (!upcoming || owed < rule.minAmountCents) continue;
    if (daysBetween(todayIso, upcoming) > rule.days) continue;
    if (input.recentlyEmailedUnitIds.has(unit.id) || !reachable(unit.id)) continue;
    labels.push(unit.label);
  }
  return { labels };
}

/** "Today this would email 2 owners: Unit 2, Unit 5." */
export function previewSentence(labels: string[]): string {
  if (labels.length === 0) return "Today this would email nobody.";
  const owners = labels.length === 1 ? "1 owner" : `${labels.length} owners`;
  return `Today this would email ${owners}: ${labels.join(", ")}.`;
}
