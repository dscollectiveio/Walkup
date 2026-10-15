"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { requestInsuranceProof } from "../owner-request-actions";
import { btnPrimary, errorBlock, inputClass, labelClass } from "../components/styles";

/**
 * "Ask the board for proof of insurance" (insurance-spec §9.9, §10.9): an
 * owner's only way to ask about the building's insurance. It records a
 * request the board sees on its Overview; the note goes to the board only.
 */
export function ProofRequestCard({
  requests,
  todayIso,
}: {
  requests: { id: string; kind: string; status: string; created_at: string; handled_at: string | null }[];
  todayIso: string;
}) {
  const router = useRouter();
  const p = useId();
  const [kind, setKind] = useState<"certificate" | "question">("certificate");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  return (
    <Card title="Ask the board for proof of insurance">
      <div className="space-y-4">
        <p className="text-[13px] text-ink">
          Refinancing or selling? Your lender may need proof of the building&rsquo;s insurance. Ask the board and they&rsquo;ll request a certificate from the agent.
        </p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              setSent(false);
              const r = await requestInsuranceProof({ kind, note: note.trim() || null });
              if ("error" in r) setError(r.error);
              else {
                setSent(true);
                setNote("");
                router.refresh();
              }
            });
          }}
        >
          <div>
            <label htmlFor={`${p}-kind`} className={labelClass}>
              What do you need?
            </label>
            <select id={`${p}-kind`} value={kind} onChange={(e) => setKind(e.target.value as "certificate" | "question")} className={inputClass}>
              <option value="certificate">A certificate for my lender</option>
              <option value="question">A question about the building&rsquo;s insurance</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${p}-note`} className={labelClass}>
              Anything the board should know <span className="font-normal text-mute-soft">optional</span>
            </label>
            <textarea
              id={`${p}-note`}
              rows={3}
              maxLength={1000}
              placeholder="My lender's name and the loan number"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputClass}
            />
          </div>
          {error ? <p className={errorBlock}>{error}</p> : null}
          <div role="status" aria-live="polite">
            {sent ? <p className="text-[13px] text-good-text">Sent to the board. You&rsquo;ll see it here when they&rsquo;ve handled it.</p> : null}
          </div>
          <button type="submit" className={`${btnPrimary} w-full sm:w-auto`} disabled={pending}>
            {pending ? "Sending…" : "Ask the board"}
          </button>
        </form>
        {requests.length > 0 ? (
          <ul className="space-y-1 border-t border-line pt-3 text-[13px]">
            {requests.map((r) => (
              <li key={r.id} className="text-ink">
                {r.kind === "question" ? "Question" : "Certificate"}, asked {shortDate(r.created_at, todayIso)}:{" "}
                {r.status === "open" ? (
                  <span className="text-mute">Open</span>
                ) : (
                  <span className="text-good-text">Handled{r.handled_at ? ` ${shortDate(r.handled_at, todayIso)}` : ""}</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}
