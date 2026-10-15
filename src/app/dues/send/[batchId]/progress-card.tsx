"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { resumeBatch } from "@/app/dues/email-actions";

/**
 * Live progress after approval: refreshes every three seconds while messages
 * are waiting, then shows the result. "Resume sending" appears only when the
 * batch has been waiting a while, which means the request that was sending
 * stopped; the daily run also picks plain reminders up.
 */
export function ProgressCard({
  batchId,
  waiting,
  done,
  total,
  result,
  canResume,
  failures,
}: {
  batchId: string;
  waiting: number;
  done: number;
  total: number;
  result: string;
  canResume: boolean;
  failures: { name: string; error: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (waiting === 0) return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [waiting, router]);

  const resume = () => {
    setError(null);
    start(async () => {
      const res = await resumeBatch(batchId);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  };

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <section className="rounded-xl border border-line bg-paper p-5" aria-live="polite">
      {waiting > 0 ? (
        <>
          <h2 className="text-[16px] font-semibold text-ink">
            Sending {done} of {total}
          </h2>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-fill" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div className="h-full bg-ink transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-[12px] text-mute">Walkup sends a couple of emails a second. You can leave this page; it keeps going.</p>
        </>
      ) : (
        <h2 className="text-[16px] font-semibold text-ink">{result}</h2>
      )}
      {failures.length > 0 ? (
        <ul className="mt-3 space-y-1 text-[13px] text-bad-text">
          {failures.map((f, i) => (
            <li key={i}>
              {f.name}: {f.error}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link href="/dues/email#log" className="text-[13px] text-ink underline underline-offset-2">
          See the log
        </Link>
        {waiting > 0 && canResume ? (
          <button
            type="button"
            onClick={resume}
            disabled={pending}
            className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-50"
          >
            Resume sending
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-bad-text">
          {error}
        </p>
      ) : null}
    </section>
  );
}
