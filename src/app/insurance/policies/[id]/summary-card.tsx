"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AiWritten } from "@/components/ai/ai-written";
import { saveSummaryText, writeSummaryNow } from "../../policy-actions";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { btnGhost, btnPrimary, errorBlock, inputClass } from "../../components/styles";

const SUMMARY_FAILED = "Walkup couldn't write a summary it could check. Write one, or try again.";
const SUMMARY_QUOTA = "Walkup has written as many summaries as it can today. Try again tomorrow, or write one yourself.";

/**
 * The plain-English summary (§9.4 item 2, §7.2): read, edit inline (2,000
 * characters), or have Walkup rewrite it. Right after a save the background
 * summary is still being written: the page refreshes once at 10 seconds and
 * once at 30, then stops.
 */
export function SummaryCard({
  policyId,
  text,
  source,
  error,
  aiOn,
  canEdit,
  writing,
}: {
  policyId: string;
  text: string | null;
  source: "model" | "board" | null;
  error: string | null;
  aiOn: boolean;
  canEdit: boolean;
  writing: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text ?? "");
  const [pending, start] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRewrite, setConfirmRewrite] = useState(false);

  useEffect(() => {
    if (!writing) return;
    const a = window.setTimeout(() => router.refresh(), 10_000);
    const b = window.setTimeout(() => router.refresh(), 30_000);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [writing, router]);

  const rewrite = async (): Promise<{ ok: true } | { error: string }> => {
    const r = await writeSummaryNow(policyId);
    if ("error" in r) return { error: r.quota ? SUMMARY_QUOTA : r.error };
    router.refresh();
    return { ok: true };
  };

  if (editing) {
    return (
      <div className="space-y-3">
        <label htmlFor="summary-text" className="sr-only">
          Summary
        </label>
        <textarea
          id="summary-text"
          rows={6}
          maxLength={2000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={inputClass}
        />
        <p className="text-[11px] text-mute">{draft.length.toLocaleString("en-US")} of 2,000 characters</p>
        {actionError ? <p className={errorBlock}>{actionError}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btnPrimary}
            disabled={pending}
            onClick={() =>
              start(async () => {
                setActionError(null);
                const r = await saveSummaryText(policyId, draft);
                if ("error" in r) setActionError(r.error);
                else {
                  setEditing(false);
                  router.refresh();
                }
              })
            }
          >
            {pending ? "Saving…" : "Save summary"}
          </button>
          <button type="button" className={btnGhost} onClick={() => setEditing(false)} disabled={pending}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  let body: React.ReactNode;
  if (text) {
    body = (
      <div className="space-y-2">
        <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink">{text}</p>
        {source === "model" ? <AiWritten variant="summary" from="your policy's details" checkAgainst="the policy" /> : null}
      </div>
    );
  } else if (writing && aiOn) {
    body = (
      <p role="status" className="text-[13px] text-mute">
        Walkup is writing a plain-English summary…
      </p>
    );
  } else if (error && aiOn) {
    body = <p className="text-[13px] text-mute">{error === "quota" ? SUMMARY_QUOTA : SUMMARY_FAILED}</p>;
  } else if (!aiOn) {
    body = <p className="text-[13px] text-mute">No summary yet. Write one in your own words.</p>;
  } else {
    body = <p className="text-[13px] text-mute">No summary yet.</p>;
  }

  return (
    <div className="space-y-3">
      {body}
      {actionError ? <p className={errorBlock}>{actionError}</p> : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              setDraft(text ?? "");
              setEditing(true);
            }}
          >
            {text ? "Edit" : "Write one"}
          </button>
          {aiOn ? (
            <button
              type="button"
              className={btnGhost}
              disabled={pending}
              onClick={() => {
                if (text && source === "board") setConfirmRewrite(true);
                else
                  start(async () => {
                    setActionError(null);
                    const r = await rewrite();
                    if ("error" in r) setActionError(r.error);
                  });
              }}
            >
              {pending ? "Writing…" : text ? "Rewrite with Walkup" : error ? "Try again" : "Write a summary"}
            </button>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmRewrite}
        title="Replace your summary with a new one from Walkup?"
        confirmLabel="Replace it"
        pendingLabel="Writing…"
        onClose={() => setConfirmRewrite(false)}
        onConfirm={rewrite}
      />
    </div>
  );
}
