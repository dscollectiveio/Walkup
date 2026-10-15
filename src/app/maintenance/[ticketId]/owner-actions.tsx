"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addComment, addMeToo, addVisitFeedback, confirmFixed, reopenTicket } from "@/app/maintenance/actions";
import { btnPrimary, btnSecondary, errorClass, hintClass, labelClass, textareaClass } from "@/components/repairs/styles";
import { humanDate } from "@/lib/repairs/format";

/**
 * What the person who reported a problem can do (repairs-spec §14.2):
 * confirm the fix or reopen it within 30 days, and say how the visit went.
 * Plus "I'm seeing this too" for anyone else on a shared-area problem.
 */

function daysBetween(fromIso: string, toIso: string): number {
  const [a, b] = [fromIso, toIso].map((s) => {
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86_400_000);
}

export function ConfirmBlock({ ticketId, resolvedAt, todayIso }: { ticketId: string; resolvedAt: string; todayIso: string }) {
  const router = useRouter();
  const id = useId();
  const [mode, setMode] = useState<"ask" | "reopen" | "confirmed" | "reopened">("ask");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fixedOn = resolvedAt.slice(0, 10);

  if (daysBetween(fixedOn, todayIso) > 30) {
    return (
      <p className="text-[14px] text-ink">
        If it&rsquo;s broken again, report it as a new problem.{" "}
        <Link href="/repairs/report" className="underline underline-offset-2">
          Report a problem
        </Link>
      </p>
    );
  }

  const act = (fn: () => Promise<{ ok: true } | { error: string }>, next: "confirmed" | "reopened") =>
    start(async () => {
      setError(null);
      const r = await fn();
      if ("error" in r) setError(r.error);
      else {
        setMode(next);
        router.refresh();
      }
    });

  return (
    <section aria-labelledby={`${id}-h`} className="rounded-xl border border-good-line bg-good-tint px-5 py-4">
      <h2 id={`${id}-h`} className="text-[16px] font-bold text-good-text">
        Is it fixed?
      </h2>
      {mode === "confirmed" ? (
        <p role="status" className="mt-1 text-[14px] text-good-text">
          Thanks. It&rsquo;s closed now.
        </p>
      ) : mode === "reopened" ? (
        <p role="status" className="mt-1 text-[14px] text-good-text">
          Reopened. The board will see your note.
        </p>
      ) : (
        <>
          <p className="mt-1 text-[14px] text-good-text">The board marked this fixed on {humanDate(fixedOn, todayIso)}.</p>
          {mode === "ask" ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button type="button" className={btnPrimary} disabled={pending} onClick={() => act(() => confirmFixed(ticketId), "confirmed")}>
                {pending ? "Saving…" : "Yes, it's fixed"}
              </button>
              <button type="button" className={btnSecondary} onClick={() => setMode("reopen")}>
                It&rsquo;s not fixed
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <label htmlFor={id} className={labelClass}>
                What&rsquo;s still wrong?
              </label>
              <textarea id={id} rows={3} required maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} className={textareaClass} />
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" className={btnPrimary} disabled={pending || !reason.trim()} onClick={() => act(() => reopenTicket(ticketId, reason), "reopened")}>
                  {pending ? "Saving…" : "Reopen it"}
                </button>
                <button type="button" className={btnSecondary} onClick={() => setMode("ask")}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {error ? <p className={`mt-2 ${errorClass}`}>{error}</p> : null}
    </section>
  );
}

export function VisitFeedback({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const id = useId();
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (sent) {
    return (
      <p role="status" className="text-[14px] text-good-text">
        Posted. The board and anyone who can see this problem can read it.
      </p>
    );
  }
  return (
    <form
      className="space-y-2 rounded-xl border border-line bg-paper px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await addVisitFeedback(ticketId, body);
          if ("error" in r) setError(r.error);
          else {
            setSent(true);
            router.refresh();
          }
        });
      }}
    >
      <label htmlFor={id} className={labelClass}>
        How did the visit go? <span className="font-normal text-mute">(optional)</span>
      </label>
      <textarea id={id} rows={2} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} className={textareaClass} aria-describedby={`${id}-hint`} />
      <p id={`${id}-hint`} className={hintClass}>
        Anyone who can see this problem can read this.
      </p>
      <button type="submit" disabled={pending || !body.trim()} className={btnPrimary}>
        {pending ? "Posting…" : "Post this note"}
      </button>
      {error ? <p className={errorClass}>{error}</p> : null}
    </form>
  );
}

export function MeTooButton({ ticketId, already }: { ticketId: string; already: boolean }) {
  const router = useRouter();
  const id = useId();
  const [state, setState] = useState<"idle" | "added" | "noted" | "done">(already ? "done" : "idle");
  const [extra, setExtra] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (state === "idle") {
    return (
      <div className="space-y-1">
        <button
          type="button"
          className={btnSecondary}
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await addMeToo(ticketId, null);
              if ("error" in r) setError(r.error);
              else {
                setState("added");
                router.refresh();
              }
            })
          }
        >
          {pending ? "Saving…" : "I'm seeing this too"}
        </button>
        {error ? <p className={errorClass}>{error}</p> : null}
      </div>
    );
  }
  if (state === "done" || state === "noted") {
    return <p className="text-[13px] text-mute">You&rsquo;ve said you&rsquo;re seeing this too.</p>;
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await addComment(ticketId, extra, false);
          if ("error" in r) setError(r.error);
          else {
            setState("noted");
            router.refresh();
          }
        });
      }}
    >
      <p role="status" className="text-[13px] text-good-text">
        Added. The board can see that you&rsquo;re seeing it too.
      </p>
      <label htmlFor={id} className={labelClass}>
        Anything different where you are? <span className="font-normal text-mute">(optional)</span>
      </label>
      <textarea id={id} rows={2} maxLength={4000} value={extra} onChange={(e) => setExtra(e.target.value)} className={textareaClass} />
      <button type="submit" disabled={pending || !extra.trim()} className={btnSecondary}>
        {pending ? "Sending…" : "Add it"}
      </button>
      {error ? <p className={errorClass}>{error}</p> : null}
    </form>
  );
}
