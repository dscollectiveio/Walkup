"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryInsuranceRead } from "../../import-actions";
import { OpenFileButton } from "../../components/provenance";
import { btnGhost, btnPrimary, errorBlock } from "../../components/styles";

/**
 * Read progress (insurance-spec §9.3.2), replacing the old waiting screen.
 * Polls with router.refresh() every 3 seconds and stops at 6 minutes, past
 * the 330-second stale threshold, so a killed run has already turned into
 * "timed out" by then. The status region holds only the state text; the
 * ticking seconds sit outside it, hidden from screen readers.
 */

const POLL_MS = 3000;
const POLL_CAP_MS = 6 * 60 * 1000;
const SLOW_MS = 90 * 1000;

export type ProgressState =
  | "queued" | "running" | "failed" | "timed_out" | "unreadable" | "not_configured" | "quota" | "empty" | "not_insurance";

export function ReadProgress({
  readId,
  state,
  filename,
  since,
  attempts,
  error,
  documentId,
  mode,
  canRetry,
}: {
  readId: string;
  state: ProgressState;
  filename: string;
  /** When the current run started (or the read was created), for the elapsed counter. */
  since: string;
  attempts: number;
  error: string | null;
  documentId: string;
  mode: "policy" | "quote";
  canRetry: boolean;
}) {
  const router = useRouter();
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [pending, start] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const active = state === "queued" || state === "running";
  const pollingOver = now - mountedAt >= POLL_CAP_MS;

  useEffect(() => {
    if (!active) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [active]);

  useEffect(() => {
    if (!active || pollingOver) return;
    const poll = window.setInterval(() => router.refresh(), POLL_MS);
    return () => window.clearInterval(poll);
  }, [active, pollingOver, router]);

  const manualHref = `${mode === "quote" ? "/insurance/quotes/new" : "/insurance/policies/new"}?document=${documentId}`;
  const manual = (
    <Link href={manualHref} className={btnPrimary}>
      Enter the details by hand
    </Link>
  );
  const retry = canRetry ? (
    <button
      type="button"
      className={btnGhost}
      disabled={pending}
      onClick={() =>
        start(async () => {
          setActionError(null);
          const r = await retryInsuranceRead(readId);
          if ("error" in r) setActionError(r.error);
          else router.refresh();
        })
      }
    >
      {pending ? "Starting…" : "Try again"}
    </button>
  ) : null;

  if (active) {
    const elapsed = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
    return (
      <div className="space-y-3">
        <div role="status" aria-live="polite" className="space-y-2">
          <h1 className="text-[20px] font-bold tracking-tight text-ink">Reading {filename}…</h1>
          {pollingOver ? (
            <p className="text-[13px] text-ink">Still reading. Check back in a minute.</p>
          ) : (
            <p className="text-[13px] text-mute">
              This usually takes under a minute. You can leave this page. Walkup will show it on the Insurance page when it&rsquo;s ready.
            </p>
          )}
          {!pollingOver && now - mountedAt >= SLOW_MS ? (
            <p className="text-[13px] text-ink">Taking longer than usual. Long or scanned documents can take two or three minutes.</p>
          ) : null}
        </div>
        <p aria-hidden="true" className="figures text-[12px] text-mute">
          {elapsed} s
        </p>
        <div className="h-1 max-w-sm overflow-hidden rounded bg-fill">
          <div className="h-1 w-1/3 rounded bg-ink-mid motion-safe:animate-pulse" />
        </div>
        {pollingOver ? (
          <button type="button" className={btnGhost} onClick={() => router.refresh()}>
            Check again
          </button>
        ) : null}
      </div>
    );
  }

  const tooMany = attempts >= 3 && (state === "failed" || state === "timed_out");
  let title: string;
  let body: React.ReactNode = null;
  let buttons: React.ReactNode;
  switch (state) {
    case "timed_out":
      title = tooMany ? "Walkup has tried three times. Enter the details by hand instead." : "Reading took too long and stopped.";
      buttons = tooMany ? manual : <>{retry}{manual}</>;
      break;
    case "failed":
      title = tooMany ? "Walkup has tried three times. Enter the details by hand instead." : "Walkup couldn't read this file this time.";
      body = error ? (
        <details className="text-[13px] text-mute">
          <summary className="min-h-[44px] cursor-pointer py-2">What went wrong</summary>
          <p>{error}</p>
        </details>
      ) : null;
      buttons = tooMany ? manual : <>{retry}{manual}</>;
      break;
    case "unreadable":
      title = error ?? "Walkup couldn't read this file.";
      buttons = (
        <>
          {manual}
          <Link href="/insurance/import" className={btnGhost}>
            Upload a different file
          </Link>
        </>
      );
      break;
    case "not_configured":
      title = "Reading isn't set up on this Walkup. Enter the details by hand; the file is saved in the Document Hub.";
      buttons = manual;
      break;
    case "quota":
      title = error ?? "Walkup has read as many documents as it can for your building today. Try again tomorrow, or enter the details by hand.";
      buttons = <>{retry}{manual}</>;
      break;
    case "not_insurance":
      title = "This doesn't look like an insurance document.";
      buttons = (
        <>
          <Link href={manualHref} className={btnPrimary}>
            Enter by hand
          </Link>
          <OpenFileButton documentId={documentId} label="Open the file" className={btnGhost} />
        </>
      );
      break;
    default:
      title = "Walkup didn't find any policy details in this file.";
      buttons = (
        <>
          <Link href={manualHref} className={btnPrimary}>
            Enter by hand
          </Link>
          <OpenFileButton documentId={documentId} label="Open the file" className={btnGhost} />
        </>
      );
  }

  return (
    <div className="space-y-4">
      <div role="status" aria-live="polite">
        <p className="text-[13px] text-mute">{filename}</p>
        <h1 className="mt-1 text-[18px] font-bold tracking-tight text-ink">{title}</h1>
      </div>
      {body}
      {actionError ? <p className={errorBlock}>{actionError}</p> : null}
      <div className="flex flex-wrap gap-2">{buttons}</div>
    </div>
  );
}
