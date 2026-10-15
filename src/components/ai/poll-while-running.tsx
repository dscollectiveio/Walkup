"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  elapsedSeconds,
  FINAL_REFRESH_GRACE_MS,
  formatElapsed,
  LONG_WAIT_SECONDS,
  POLL_COPY,
  pollPhase,
  STALE_AFTER_SECONDS,
} from "./poll-state";

/**
 * Keeps a page fresh while a background AI run works (foundation-spec 5.4),
 * and can't spin forever: past the platform's limit it refreshes once more,
 * then shows "This stopped before it finished" with "Try again". When the
 * server render stops saying running, it renders nothing and the page shows
 * the result.
 *
 * The live region's text is set once per state, so screen readers don't
 * re-announce on every refresh; the elapsed timer is visual only.
 */
export function PollWhileRunning(props: {
  running: boolean;            // server-rendered aiRunStatus(...) === "running"
  startedAt: string | null;
  intervalMs?: number;         // default 3000
  staleAfterSeconds?: number;  // default 330
  label: string;               // what is running, e.g. "Searching the web for contractors"
  onRetry?: () => Promise<unknown>;   // the area's start action, bound to its row
  children?: React.ReactNode;  // extra content shown while running
}) {
  const { running, startedAt, label, onRetry, children } = props;
  const intervalMs = props.intervalMs ?? 3000;
  const stale = props.staleAfterSeconds ?? STALE_AFTER_SECONDS;
  const router = useRouter();

  const [now, setNow] = useState(() => Date.now());
  const [finalDone, setFinalDone] = useState(false);
  const [runKey, setRunKey] = useState(startedAt);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // A new run (retry, or another tab started one) starts the clock again.
  if (runKey !== startedAt) {
    setRunKey(startedAt);
    setFinalDone(false);
    setRetryError(null);
  }

  const phase = pollPhase(running, startedAt, now, finalDone, stale);

  // One-second clock for the elapsed line and the deadline.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  // Refresh on the interval, only while the tab is visible.
  useEffect(() => {
    if (phase !== "polling") return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => window.clearInterval(t);
  }, [phase, intervalMs, router]);

  // Coming back to the tab (e.g. from Mail on a phone): refresh at once.
  useEffect(() => {
    if (!running) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [running, router]);

  // Deadline passed: one final refresh, then give the server a moment to answer.
  useEffect(() => {
    if (phase !== "finalRefresh") return;
    router.refresh();
    const t = window.setTimeout(() => setFinalDone(true), FINAL_REFRESH_GRACE_MS);
    return () => window.clearTimeout(t);
  }, [phase, router]);

  if (phase === "idle") return null;

  if (phase === "stalled") {
    return (
      <div className="border-l-[3px] border-warning bg-warning-tint px-4 py-3 text-[13px] text-warning-text">
        <div role="status" aria-live="polite">
          <p className="font-bold">{POLL_COPY.stalledHeading}</p>
          <p className="mt-1">{POLL_COPY.stalledBody}</p>
        </div>
        {onRetry ? (
          <div className="mt-2">
            <button
              type="button"
              disabled={retrying}
              onClick={async () => {
                setRetrying(true);
                setRetryError(null);
                try {
                  const r = await onRetry();
                  if (r && typeof r === "object" && "error" in r && typeof r.error === "string") {
                    setRetryError(r.error);
                  } else {
                    router.refresh();
                  }
                } catch {
                  setRetryError("Couldn't start it again. Try again in a minute.");
                } finally {
                  setRetrying(false);
                }
              }}
              className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-60"
            >
              {retrying ? POLL_COPY.startingAgain : POLL_COPY.tryAgain}
            </button>
            {retryError ? <p className="mt-2 text-bad-text">{retryError}</p> : null}
          </div>
        ) : null}
      </div>
    );
  }

  const elapsed = elapsedSeconds(startedAt, now);
  return (
    <div className="space-y-2">
      <style href="walkup-poll-indeterminate" precedence="default">{`
@keyframes walkup-indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
.walkup-indeterminate { animation: walkup-indeterminate 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .walkup-indeterminate { animation: none; } }
`}</style>
      <div role="status" aria-live="polite" className="text-[13px] font-medium text-ink">
        {label}…
      </div>
      <div className="h-1 overflow-hidden rounded bg-fill" aria-hidden="true">
        <div className="walkup-indeterminate h-full w-1/3 rounded bg-ink-mid" />
      </div>
      <p className="text-[12px] text-mute" aria-hidden="true">
        {formatElapsed(elapsed)}
      </p>
      {elapsed >= LONG_WAIT_SECONDS ? <p className="text-[12px] text-mute">{POLL_COPY.longWait}</p> : null}
      {children}
    </div>
  );
}
