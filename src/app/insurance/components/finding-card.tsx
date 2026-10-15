"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LINE_COVERAGE } from "@/lib/insurance/coverage";
import type { Finding } from "@/lib/insurance/coverage-check";
import { FIELD_BY_KEY } from "@/lib/insurance/fields";
import { longDate } from "@/lib/insurance/format";
import { actLinkText } from "@/lib/insurance/statute";
import { todayIso } from "@/lib/dates";
import { dismissFinding, restoreFinding } from "../check-actions";
import { recordAgentAnswer } from "../policy-actions";
import { BasisChip } from "./basis-chip";
import { InsuranceUploader } from "./insurance-uploader";
import { btnGhost, btnPrimary, dialogClass, errorBlock, inputClass, labelClass } from "./styles";
import { Toast } from "./toast";

/**
 * One coverage-check finding (§9.5 item 5): a dot with its words beside it,
 * the title and detail, what it rests on, the statute behind it, and the
 * board's next steps in a fixed order.
 */

export function severityWords(f: Pick<Finding, "severity" | "notOnFile">): { text: string; dot: string } {
  if (f.notOnFile) return { text: "Not on file yet", dot: "bg-warning" };
  switch (f.severity) {
    case "gap":
      return { text: "Gap", dot: "bg-bad" };
    case "ask":
      return { text: "Ask your agent", dot: "bg-warning" };
    case "needs_info":
      return { text: "Needs an answer", dot: "bg-info" };
    default:
      return { text: "Good to know", dot: "bg-neutral" };
  }
}

const quotesHref = (f: Finding) =>
  `/insurance?view=quotes&new=1${f.line ? `&coverage=${LINE_COVERAGE[f.line]}` : ""}`;

export function FindingCard({
  finding,
  stateName,
  policyLabel,
  canEdit,
  compact = false,
  answerPolicy,
}: {
  finding: Finding;
  stateName: string;
  policyLabel: string | null;
  canEdit: boolean;
  compact?: boolean;
  /** The policy "Our agent answered" updates, with its updated_at for the concurrency check. */
  answerPolicy: { id: string; updatedAt: string } | null;
}) {
  const sev = severityWords(finding);
  const [dialog, setDialog] = useState<"answer" | "dismiss" | null>(null);
  const [toast, setToast] = useState<{ message: string; stamp: number } | null>(null);
  const canAnswer = canEdit && finding.answerableFields.length > 0 && !!answerPolicy;
  const askHref = `/insurance/emails/new?kind=coverage_question&finding=${encodeURIComponent(finding.id)}${
    finding.policyId ? `&policy=${finding.policyId}` : ""
  }`;
  const btn = "inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill";

  return (
    <article className={`rounded-xl border border-line bg-paper ${compact ? "px-4 py-3" : "px-5 py-4"}`}>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${sev.dot}`} />
          {sev.text}
        </span>
        <BasisChip basis={finding.basis} stateName={stateName} />
        {policyLabel ? (
          <span className="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 text-[11px] text-mute">{policyLabel}</span>
        ) : null}
      </div>
      <h3 className="mt-2 text-[14px] font-bold leading-snug text-ink">{finding.title}</h3>
      {!compact ? <p className="mt-1 text-[13px] leading-relaxed text-ink">{finding.detail}</p> : null}

      {!compact && finding.citation ? (
        <details className="mt-2 text-[12px] text-mute">
          <summary className="min-h-[44px] cursor-pointer py-2 text-ink underline underline-offset-2">Why Walkup says this</summary>
          <div className="space-y-1 pb-1">
            {finding.citationNote ? <p className="text-ink">{finding.citationNote}</p> : null}
            <p>
              {finding.citation.actName}, {finding.citation.section}
            </p>
            <p className="text-ink">&ldquo;{finding.citation.quote}&rdquo;</p>
            <p>
              <a href={finding.citation.url} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
                {actLinkText(finding.citation)}
              </a>
            </p>
            <p>Checked against the Act on {longDate(finding.citation.verifiedOn)}</p>
          </div>
        </details>
      ) : null}

      {canEdit && !compact && !finding.dismissed ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {finding.notOnFile ? (
            <>
              <Link href={`/insurance/import${finding.line ? `?coverage=${LINE_COVERAGE[finding.line]}` : ""}`} className={btn}>
                We have this: add the policy
              </Link>
              <Link href={quotesHref(finding)} className={btn}>
                Ask for quotes
              </Link>
            </>
          ) : null}
          {finding.question ? (
            <Link href={askHref} className={btn}>
              Ask your agent
            </Link>
          ) : null}
          {canAnswer ? (
            <button type="button" className={btn} onClick={() => setDialog("answer")}>
              Our agent answered
            </button>
          ) : null}
          <button type="button" className={btn} onClick={() => setDialog("dismiss")}>
            Not relevant to us
          </button>
        </div>
      ) : null}

      {canAnswer && answerPolicy ? (
        <AgentAnswerDialog
          open={dialog === "answer"}
          finding={finding}
          policy={answerPolicy}
          onClose={(saved) => {
            setDialog(null);
            if (saved) setToast({ message: "Saved. The check is updated.", stamp: Date.now() });
          }}
        />
      ) : null}
      {canEdit ? (
        <DismissDialog
          open={dialog === "dismiss"}
          finding={finding}
          onClose={(saved) => {
            setDialog(null);
            if (saved) setToast({ message: "Saved. The check is updated.", stamp: Date.now() });
          }}
        />
      ) : null}
      <Toast message={toast?.message ?? null} stamp={toast?.stamp} />
    </article>
  );
}

function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return ref;
}

function DismissDialog({ open, finding, onClose }: { open: boolean; finding: Finding; onClose: (saved: boolean) => void }) {
  const router = useRouter();
  const ref = useDialog(open);
  const saved = useRef(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const id = `dismiss-${finding.id}`;
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={() => {
        onClose(saved.current);
        saved.current = false;
      }}
      className={dialogClass}
    >
      <form
        className="flex h-full flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const r = await dismissFinding({ ruleId: finding.ruleId, policyId: finding.policyId, findingKey: finding.id, reason });
            if ("error" in r) setError(r.error);
            else {
              saved.current = true;
              setReason("");
              ref.current?.close();
              router.refresh();
            }
          });
        }}
      >
        <div className="flex-1 space-y-3 px-5 py-5">
          <h2 id={`${id}-title`} className="text-[16px] font-bold tracking-tight text-ink">
            Why not?
          </h2>
          <p className="text-[13px] text-mute">{finding.title}</p>
          <label htmlFor={`${id}-reason`} className={labelClass}>
            Reason
          </label>
          <textarea
            id={`${id}-reason`}
            required
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Our declaration doesn't require it"
            className={inputClass}
          />
        </div>
        <div className="space-y-2 border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {error ? <p className={errorBlock}>{error}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={btnGhost} onClick={() => ref.current?.close()} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className={btnPrimary} disabled={pending || !reason.trim()}>
              {pending ? "Saving…" : "Not relevant to us"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

function AgentAnswerDialog({
  open,
  finding,
  policy,
  onClose,
}: {
  open: boolean;
  finding: Finding;
  policy: { id: string; updatedAt: string };
  onClose: (saved: boolean) => void;
}) {
  const router = useRouter();
  const ref = useDialog(open);
  const saved = useRef(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answeredOn, setAnsweredOn] = useState(() => todayIso());
  const [attachment, setAttachment] = useState<{ id: string; name: string } | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const id = `answer-${finding.id.replace(/[^a-zA-Z0-9-]/g, "-")}`;

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={() => {
        onClose(saved.current);
        saved.current = false;
      }}
      className={dialogClass}
    >
      <form
        className="flex h-full flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          const sent: Record<string, string | null> = {};
          for (const key of finding.answerableFields) {
            const v = (answers[key] ?? "").trim();
            const def = FIELD_BY_KEY.get(key);
            sent[key] = v === "" || v === "unsure" ? null : def?.kind === "percent" && /^\d+(\.\d+)?$/.test(v) ? `${v}%` : v;
          }
          start(async () => {
            setError(null);
            setFieldErrors({});
            const r = await recordAgentAnswer({
              policyId: policy.id,
              findingRuleId: finding.ruleId,
              answers: sent,
              answeredOn,
              attachmentDocumentId: attachment?.id ?? null,
              expectedUpdatedAt: policy.updatedAt,
            });
            if ("error" in r) {
              setError(r.error);
              setFieldErrors(r.fieldErrors ?? {});
            } else {
              saved.current = true;
              ref.current?.close();
              router.refresh();
            }
          });
        }}
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <h2 id={`${id}-title`} className="text-[16px] font-bold tracking-tight text-ink">
            What did your agent say?
          </h2>
          <p className="text-[13px] text-mute">{finding.title}</p>
          {finding.answerableFields.map((key) => {
            const def = FIELD_BY_KEY.get(key);
            if (!def) return null;
            const fid = `${id}-${key}`;
            const value = answers[key] ?? "";
            const set = (v: string) => setAnswers((a) => ({ ...a, [key]: v }));
            let control: React.ReactNode;
            if (def.kind === "boolean") {
              control = (
                <fieldset>
                  <legend className={labelClass}>{def.label}</legend>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {[
                      { v: "true", l: "Yes" },
                      { v: "false", l: "No" },
                      { v: "unsure", l: "Not sure" },
                    ].map((o) => (
                      <label key={o.v} className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-line-strong px-3 text-[13px] text-ink">
                        <input type="radio" name={fid} value={o.v} checked={value === o.v} onChange={() => set(o.v)} />
                        {o.l}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            } else if (def.kind === "enum") {
              control = (
                <>
                  <label htmlFor={fid} className={labelClass}>
                    {def.label}
                  </label>
                  <select id={fid} value={value} onChange={(e) => set(e.target.value)} className={inputClass}>
                    <option value="">Not sure</option>
                    {(def.options ?? []).filter((o) => o.value !== "unknown").map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </>
              );
            } else {
              control = (
                <>
                  <label htmlFor={fid} className={labelClass}>
                    {def.label}
                    {def.kind === "percent" ? " (%)" : ""}
                  </label>
                  <input
                    id={fid}
                    type={def.kind === "date" ? "date" : "text"}
                    inputMode={def.kind === "money" || def.kind === "percent" ? "decimal" : undefined}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    className={`${inputClass} ${def.kind === "money" || def.kind === "percent" ? "figures" : ""}`}
                  />
                </>
              );
            }
            return (
              <div key={key}>
                {control}
                {fieldErrors[key] ? <p className="mt-1 text-[12px] text-bad-text">{fieldErrors[key]}</p> : null}
              </div>
            );
          })}
          <div>
            <label htmlFor={`${id}-on`} className={labelClass}>
              When did they answer?
            </label>
            <input
              id={`${id}-on`}
              type="date"
              required
              max={todayIso()}
              value={answeredOn}
              onChange={(e) => setAnsweredOn(e.target.value)}
              className={inputClass}
            />
            {fieldErrors.answered_on ? <p className="mt-1 text-[12px] text-bad-text">{fieldErrors.answered_on}</p> : null}
          </div>
          <div className="space-y-2">
            <p className={labelClass}>Attach their answer (optional)</p>
            {attachment ? (
              <p className="text-[13px] text-ink">
                Attached: {attachment.name}{" "}
                <button type="button" className="min-h-[44px] px-2 text-mute underline underline-offset-2" onClick={() => setAttachment(null)}>
                  Remove
                </button>
              </p>
            ) : (
              <InsuranceUploader
                multiple={false}
                label="Choose a PDF or photo of the email"
                onDocuments={(docs) => setAttachment(docs[0] ? { id: docs[0].documentId, name: docs[0].filename } : null)}
              />
            )}
          </div>
        </div>
        <div className="space-y-2 border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {error ? <p className={errorBlock}>{error}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={btnGhost} onClick={() => ref.current?.close()} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className={btnPrimary} disabled={pending}>
              {pending ? "Saving…" : "Save their answer"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

/** "Restore" on a dismissed finding (§9.5 item 6). */
export function RestoreButton({ dismissalId }: { dismissalId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        className="min-h-[44px] px-2 text-[12px] text-ink underline underline-offset-2 disabled:opacity-50"
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await restoreFinding(dismissalId);
            if ("error" in r) setError(r.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Restoring…" : "Restore"}
      </button>
      {error ? <span className="text-[12px] text-bad-text">{error}</span> : null}
    </>
  );
}
