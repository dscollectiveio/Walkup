"use client";

import Link from "next/link";
import { useEffect, useId, useState, useTransition } from "react";
import type { ChangeKind, HolderKind } from "@/lib/insurance/emails";
import { composeInsuranceEmail } from "../../message-actions";
import { MessageBody, type SheetMessage } from "../../components/message-sheet";
import { btnGhost, btnPrimary, errorBlock, helpClass, infoBlock, inputClass, labelClass, linkClass } from "../../components/styles";
import { MESSAGE_KIND_LABEL } from "../../quote-helpers";

/**
 * Compose (insurance-spec §9.7.1): step 1 asks who and what for the kind of
 * email, step 2 shows the saved draft in DraftEmail. Nothing is sent: the
 * board opens it in its own mail app and marks it sent. An owner's note is
 * shown to the board only and never goes to the model.
 */

export type ComposeKind =
  | "certificate_request" | "claim_report" | "change_request" | "coverage_question" | "documents_request"
  | "quote_follow_up" | "quote_decline" | "other";

const KIND_OPTIONS: { value: ComposeKind; label: string }[] = [
  { value: "certificate_request", label: "Ask for a certificate of insurance" },
  { value: "claim_report", label: "Report a claim" },
  { value: "change_request", label: "Ask for a change to a policy" },
  { value: "coverage_question", label: "Ask a coverage question" },
  { value: "documents_request", label: "Ask for our current documents" },
  { value: "quote_follow_up", label: "Follow up on a quote" },
  { value: "quote_decline", label: "Thank them for a quote" },
  { value: "other", label: "Write my own email" },
];

const HOLDERS: { value: HolderKind; label: string }[] = [
  { value: "mortgage_lender", label: "Mortgage lender" },
  { value: "contractor", label: "Contractor" },
  { value: "property_manager", label: "Property manager" },
  { value: "other", label: "Other" },
];

const CHANGES: { value: ChangeKind; label: string }[] = [
  { value: "add_coverage", label: "Add coverage" },
  { value: "raise_limit", label: "Raise a limit" },
  { value: "change_deductible", label: "Change a deductible" },
  { value: "add_additional_insured", label: "Add an additional insured" },
  { value: "update_address", label: "Update our address" },
  { value: "other", label: "Other" },
];

const TYPE_EMAIL = "__type__";

type Option = { id: string; label: string };

export function ComposeForm(props: {
  initialKind: ComposeKind;
  contacts: { id: string; name: string; email: string | null; isCurrentAgent: boolean }[];
  defaultContactId: string | null;
  policies: Option[];
  defaultPolicyId: string | null;
  masterPolicyId: string | null;
  claims: Option[];
  defaultClaimId: string | null;
  findings: (Option & { policyId: string | null })[];
  defaultFindingId: string | null;
  ownQuestion: boolean;
  requests: (Option & { contactId: string | null })[];
  defaultRequestId: string | null;
  quotes: (Option & { contactId: string | null })[];
  defaultQuoteId: string | null;
  defaultChange: string | null;
  ownerRequest: { id: string; text: string } | null;
}) {
  const p = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [written, setWritten] = useState<{ message: SheetMessage; notice: string | null } | null>(null);

  const [kind, setKind] = useState<ComposeKind>(props.initialKind);
  const emailable = props.contacts.filter((c) => c.email);
  const agent = emailable.find((c) => c.isCurrentAgent) ?? null;
  const hasEmail = (id: string | null | undefined): id is string => !!id && emailable.some((c) => c.id === id);
  const linkedContact =
    props.initialKind === "quote_follow_up"
      ? props.requests.find((r) => r.id === (props.defaultRequestId ?? props.requests[0]?.id))?.contactId
      : props.initialKind === "quote_decline"
        ? props.quotes.find((q) => q.id === (props.defaultQuoteId ?? props.quotes[0]?.id))?.contactId
        : null;
  const [to, setTo] = useState<string>(
    hasEmail(props.defaultContactId) ? props.defaultContactId : hasEmail(linkedContact) ? linkedContact : (agent?.id ?? emailable[0]?.id ?? TYPE_EMAIL),
  );
  const [typed, setTyped] = useState("");
  const [policyId, setPolicyId] = useState(props.defaultPolicyId ?? (props.initialKind === "certificate_request" ? props.masterPolicyId : null) ?? "");
  const [holderKind, setHolderKind] = useState<HolderKind>("mortgage_lender");
  const [holder, setHolder] = useState("");
  const [claimId, setClaimId] = useState(props.defaultClaimId ?? "");
  const [changeKind, setChangeKind] = useState<ChangeKind>((props.defaultChange as ChangeKind | null) ?? "add_coverage");
  const [details, setDetails] = useState("");
  const findingKnown = props.defaultFindingId && props.findings.some((f) => f.id === props.defaultFindingId) ? props.defaultFindingId : null;
  const [findingId, setFindingId] = useState(props.ownQuestion || !props.findings.length ? "" : (findingKnown ?? props.findings[0].id));
  const [ownMode, setOwnMode] = useState(props.ownQuestion || props.findings.length === 0);
  const [question, setQuestion] = useState("");
  const [requestId, setRequestId] = useState(props.defaultRequestId ?? props.requests[0]?.id ?? "");
  const [quoteId, setQuoteId] = useState(props.defaultQuoteId ?? props.quotes[0]?.id ?? "");

  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const t = window.setTimeout(() => setSlow(true), 20_000);
    return () => {
      window.clearTimeout(t);
      setSlow(false);
    };
  }, [pending]);

  const contactName = to === TYPE_EMAIL ? null : (props.contacts.find((c) => c.id === to)?.name ?? null);

  function submit() {
    setError(null);
    const contactId = to === TYPE_EMAIL ? null : to;
    const toEmail = to === TYPE_EMAIL ? typed.trim() : null;
    if (to === TYPE_EMAIL && !toEmail) return setError("Type the email address to send it to.");
    let holderInput: { name: string; address: string; kind: HolderKind } | undefined;
    if (kind === "certificate_request") {
      const lines = holder.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) return setError("Put the name on the first line and the address below it.");
      holderInput = { name: lines[0], address: lines.slice(1).join("\n"), kind: holderKind };
    }
    if (kind === "claim_report" && !claimId) return setError("Choose the claim. No claim yet? Add the claim first.");
    if (kind === "change_request" && !details.trim()) return setError("Describe the change you'd like to ask about.");
    if (kind === "coverage_question" && ownMode && !question.trim()) return setError("Write your question.");
    if (kind === "quote_follow_up" && !requestId) return setError("Choose the request to follow up on.");
    if (kind === "quote_decline" && !quoteId) return setError("Choose the quote you're thanking them for.");

    const finding = props.findings.find((f) => f.id === findingId);
    start(async () => {
      const r = await composeInsuranceEmail({
        kind,
        contactId,
        toEmail,
        ...(policyId && ["certificate_request", "change_request", "coverage_question", "other"].includes(kind) ? { policyId } : {}),
        ...(kind === "coverage_question" && !ownMode && finding ? { findingId: finding.id, ...(finding.policyId ? { policyId: finding.policyId } : {}) } : {}),
        ...(kind === "coverage_question" && ownMode ? { question: question.trim() } : {}),
        ...(kind === "claim_report" ? { claimId } : {}),
        ...(kind === "quote_follow_up" ? { quoteRequestId: requestId } : {}),
        ...(kind === "quote_decline" ? { quoteId } : {}),
        ...(kind === "certificate_request" && props.ownerRequest ? { ownerRequestId: props.ownerRequest.id } : {}),
        ...(holderInput ? { holder: holderInput } : {}),
        ...(kind === "change_request" ? { change: { kind: changeKind, details: details.trim() } } : {}),
      });
      if ("error" in r) return setError(r.error);
      setWritten({
        message: {
          id: r.messageId,
          kind,
          contactName,
          to_email: toEmail ?? props.contacts.find((c) => c.id === contactId)?.email ?? null,
          subject: r.subject,
          body: r.body,
          status: "draft",
          drafted_by: r.draftedBy,
          sent_at: null,
        },
        notice: r.notice ?? null,
      });
    });
  }

  if (written) {
    return (
      <div className="space-y-4">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">{MESSAGE_KIND_LABEL[kind] ?? "Email"}</h1>
        <MessageBody message={written.message} canEdit notice={written.notice} />
        <div className="flex flex-wrap gap-2">
          <Link href="/insurance?view=quotes#emails" className={btnGhost}>
            Back to Quotes &amp; emails
          </Link>
        </div>
      </div>
    );
  }

  const policySelect = (label: string) => (
    <div>
      <label htmlFor={`${p}-policy`} className={labelClass}>
        {label}
      </label>
      <select id={`${p}-policy`} value={policyId} onChange={(e) => setPolicyId(e.target.value)} className={inputClass}>
        <option value="">No particular policy</option>
        {props.policies.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Write an email</h1>
        <p className="mt-1 text-mute">Walkup drafts it. You read it, edit it and send it from your own email.</p>
      </div>

      {props.ownerRequest && kind === "certificate_request" ? <p className={infoBlock}>{props.ownerRequest.text}</p> : null}

      <div className="space-y-4 rounded-xl border border-line bg-paper px-5 py-5">
        <div>
          <label htmlFor={`${p}-kind`} className={labelClass}>
            What is it for?
          </label>
          <select id={`${p}-kind`} value={kind} onChange={(e) => setKind(e.target.value as ComposeKind)} className={inputClass}>
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${p}-to`} className={labelClass}>
            To
          </label>
          <select id={`${p}-to`} value={to} onChange={(e) => setTo(e.target.value)} className={inputClass}>
            {emailable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isCurrentAgent ? " (your agent)" : ""}
              </option>
            ))}
            <option value={TYPE_EMAIL}>Type an email</option>
          </select>
          {to === TYPE_EMAIL ? (
            <div className="mt-2">
              <label htmlFor={`${p}-typed`} className={labelClass}>
                Email address
              </label>
              <input id={`${p}-typed`} type="email" inputMode="email" value={typed} onChange={(e) => setTyped(e.target.value)} className={inputClass} />
            </div>
          ) : null}
        </div>

        {kind === "certificate_request" ? (
          <>
            <div>
              <label htmlFor={`${p}-hk`} className={labelClass}>
                Who needs the certificate?
              </label>
              <select id={`${p}-hk`} value={holderKind} onChange={(e) => setHolderKind(e.target.value as HolderKind)} className={inputClass}>
                {HOLDERS.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${p}-holder`} className={labelClass}>
                Name and address to show on the certificate
              </label>
              <textarea id={`${p}-holder`} rows={4} required value={holder} onChange={(e) => setHolder(e.target.value)} className={inputClass} />
              <p className={helpClass}>The name on the first line, the address below it.</p>
              {holderKind === "mortgage_lender" ? (
                <p className={helpClass}>Lenders usually give owners their exact wording and loan number. Paste it here.</p>
              ) : null}
            </div>
            {policySelect("Policy")}
          </>
        ) : null}

        {kind === "claim_report" ? (
          <div>
            <label htmlFor={`${p}-claim`} className={labelClass}>
              Claim
            </label>
            <select id={`${p}-claim`} value={claimId} onChange={(e) => setClaimId(e.target.value)} className={inputClass} required>
              <option value="">Choose a claim</option>
              {props.claims.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className={helpClass}>
              No claim yet?{" "}
              <Link href="/insurance/claims/new" className={linkClass}>
                Add the claim first
              </Link>
            </p>
          </div>
        ) : null}

        {kind === "change_request" ? (
          <>
            <div>
              <label htmlFor={`${p}-change`} className={labelClass}>
                What change?
              </label>
              <select id={`${p}-change`} value={changeKind} onChange={(e) => setChangeKind(e.target.value as ChangeKind)} className={inputClass}>
                {CHANGES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${p}-details`} className={labelClass}>
                Details
              </label>
              <textarea id={`${p}-details`} rows={4} required maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} className={inputClass} />
            </div>
            {policySelect("Policy")}
          </>
        ) : null}

        {kind === "coverage_question" ? (
          <fieldset className="space-y-2">
            <legend className={labelClass}>Question</legend>
            {props.findings.length > 0 ? (
              <>
                <label className="flex min-h-[44px] items-center gap-2 text-[13px] text-ink">
                  <input type="radio" name={`${p}-q`} checked={!ownMode} onChange={() => setOwnMode(false)} />
                  About a finding from the coverage check
                </label>
                {!ownMode ? (
                  <select aria-label="Finding" value={findingId} onChange={(e) => setFindingId(e.target.value)} className={inputClass}>
                    {props.findings.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </>
            ) : null}
            <label className="flex min-h-[44px] items-center gap-2 text-[13px] text-ink">
              <input type="radio" name={`${p}-q`} checked={ownMode} onChange={() => setOwnMode(true)} />
              My own question
            </label>
            {ownMode ? (
              <>
                <label htmlFor={`${p}-own`} className="sr-only">
                  Your question
                </label>
                <textarea id={`${p}-own`} rows={4} maxLength={2000} value={question} onChange={(e) => setQuestion(e.target.value)} className={inputClass} />
                <p className={helpClass}>Your own question goes into Walkup&rsquo;s template as you write it. Nothing is sent to the AI.</p>
                {policySelect("About which policy")}
              </>
            ) : null}
          </fieldset>
        ) : null}

        {kind === "quote_follow_up" ? (
          <div>
            <label htmlFor={`${p}-req`} className={labelClass}>
              Request
            </label>
            {props.requests.length ? (
              <select
                id={`${p}-req`}
                value={requestId}
                onChange={(e) => {
                  setRequestId(e.target.value);
                  const c = props.requests.find((r) => r.id === e.target.value)?.contactId;
                  if (hasEmail(c)) setTo(c);
                }}
                className={inputClass}
              >
                {props.requests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[13px] text-mute">No sent requests are waiting for a reply.</p>
            )}
          </div>
        ) : null}

        {kind === "documents_request" ? (
          <p className={helpClass}>Asks for the declarations pages of every policy and the list of forms and endorsements.</p>
        ) : null}

        {kind === "quote_decline" ? (
          <div>
            <label htmlFor={`${p}-quote`} className={labelClass}>
              Quote
            </label>
            {props.quotes.length ? (
              <select
                id={`${p}-quote`}
                value={quoteId}
                onChange={(e) => {
                  setQuoteId(e.target.value);
                  const c = props.quotes.find((q) => q.id === e.target.value)?.contactId;
                  if (hasEmail(c)) setTo(c);
                }}
                className={inputClass}
              >
                {props.quotes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[13px] text-mute">No quotes recorded.</p>
            )}
            <p className={helpClass}>A short thank-you saying the board won&rsquo;t go ahead. It gives no reasons or figures.</p>
          </div>
        ) : null}

        {kind === "other" ? (
          <>
            <p className={helpClass}>A blank email you write yourself. Nothing is sent to the AI.</p>
            {policySelect("About which policy")}
          </>
        ) : null}
      </div>

      <div className="space-y-2">
        {error ? <p className={errorBlock}>{error}</p> : null}
        <button type="submit" className={`${btnPrimary} w-full sm:w-auto`} disabled={pending}>
          {pending ? "Writing…" : "Write the email"}
        </button>
        {pending && slow ? <p className="text-[12px] text-mute">Still working. This can take up to a minute.</p> : null}
      </div>
    </form>
  );
}
