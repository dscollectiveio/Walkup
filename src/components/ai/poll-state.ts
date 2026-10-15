/**
 * Pure state and copy behind PollWhileRunning (foundation-spec 5.4).
 *
 *   polling       refresh every interval while visible
 *   finalRefresh  the deadline passed: refresh once more
 *   stalled       5 s after that the server still said running: stop and offer "Try again"
 *   idle          not running: render nothing
 *
 * A running row without a start time is treated as past its deadline, so
 * nothing can spin forever.
 */

/** AI_STALE_AFTER_SECONDS (src/lib/ai/jobs.ts), duplicated as a literal because jobs.ts is server-only. */
export const STALE_AFTER_SECONDS = 330;
/** How long after the final refresh the client waits before deciding the run stalled. */
export const FINAL_REFRESH_GRACE_MS = 5_000;
/** When the "This can take up to a few minutes" line appears. */
export const LONG_WAIT_SECONDS = 45;

export type PollPhase = "polling" | "finalRefresh" | "stalled" | "idle";

export function pollPhase(
  running: boolean,
  startedAt: string | null,
  now: number,
  finalRefreshDone: boolean,
  staleAfterSeconds: number = STALE_AFTER_SECONDS,
): PollPhase {
  if (!running) return "idle";
  const started = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  const elapsed = Number.isNaN(started) ? Number.POSITIVE_INFINITY : now - started;
  if (elapsed < staleAfterSeconds * 1000) return "polling";
  return finalRefreshDone ? "stalled" : "finalRefresh";
}

/** Seconds since start, never negative; 0 without a start time. */
export function elapsedSeconds(startedAt: string | null, now: number): number {
  const started = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((now - started) / 1000));
}

/** "45 s", "1 min 05 s", "12 min 00 s". */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

export const POLL_COPY = {
  longWait: "This can take up to a few minutes. You can leave this page; it keeps going.",
  stalledHeading: "This stopped before it finished",
  stalledBody: "It ran out of time. This didn't count toward today's limit.",
  tryAgain: "Try again",
  startingAgain: "Starting again…",
} as const;
