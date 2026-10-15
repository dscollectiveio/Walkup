import "server-only";
import type { Supabase } from "./usage";

/**
 * Background AI runs (foundation-spec 5.3): an area table carries
 * ai_state / ai_started_at / ai_finished_at / ai_error, the start action
 * claims the row, after() does the work, and the page polls. These helpers
 * make "running" impossible to show forever: a run older than the platform's
 * limit is reported as stalled.
 */

/** Must equal the literal `export const maxDuration = 300` on every page hosting AI actions (unit test 12.2). */
export const AI_JOB_SECONDS = 300;
/** A run still "running" after this many seconds was killed by the platform. Also the in_flight window in SQL. */
export const AI_STALE_AFTER_SECONDS = 330;

export type AiRunState = "idle" | "running" | "done" | "failed";

/** What the UI should show. Pure. A running row without a start time can't be trusted: stalled. */
export function aiRunStatus(
  state: AiRunState,
  startedAt: string | null,
  now: Date = new Date(),
): "idle" | "running" | "stalled" | "done" | "failed" {
  if (state !== "running") return state;
  if (!startedAt) return "stalled";
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return "stalled";
  return now.getTime() - started > AI_STALE_AFTER_SECONDS * 1000 ? "stalled" : "running";
}

/**
 * Atomically mark a row running unless it already is (and isn't stale). Returns false when
 * nothing was updated (already running, or RLS). ai_attempts, if an area keeps one, is
 * bumped by the area's own trigger or RPC (supabase-js can't express col = col + 1).
 */
export async function claimAiRun(supabase: Supabase, table: string, id: string): Promise<boolean> {
  const now = new Date();
  const nowIso = now.toISOString();
  const staleIso = new Date(now.getTime() - AI_STALE_AFTER_SECONDS * 1000).toISOString();
  try {
    const { data, error } = await supabase
      .from(table)
      .update({ ai_state: "running", ai_started_at: nowIso, ai_finished_at: null, ai_error: null })
      .eq("id", id)
      .or(`ai_state.neq.running,ai_started_at.lt.${staleIso}`)
      .select("id");
    if (error) {
      console.error("claimAiRun failed", table, error.code);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/** Write the finished state. Never throws. */
export async function finishAiRun(
  supabase: Supabase,
  table: string,
  id: string,
  outcome: { ok: true } | { ok: false; reason: string },
): Promise<void> {
  try {
    const { error } = await supabase
      .from(table)
      .update({
        ai_state: outcome.ok ? "done" : "failed",
        ai_finished_at: new Date().toISOString(),
        ai_error: outcome.ok ? null : outcome.reason.slice(0, 500),
      })
      .eq("id", id);
    if (error) console.error("finishAiRun failed", table, error.code);
  } catch (e) {
    console.error("finishAiRun failed", table, e instanceof Error ? e.name : "unknown");
  }
}
