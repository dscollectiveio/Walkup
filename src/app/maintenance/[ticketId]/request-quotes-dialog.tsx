"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestQuotes } from "@/app/maintenance/bid-actions";
import { markMessagesSent } from "@/app/contractors/actions";
import { DraftEmail } from "@/components/email/draft-email";
import { ContractorDraft } from "@/components/repairs/contractor-draft";
import { Pill } from "@/components/repairs/pills";
import { Sheet } from "@/components/repairs/sheet";
import { btnPrimary, btnSecondary, errorClass, linkClass } from "@/components/repairs/styles";
import { tradeLabel } from "@/lib/contractors/trades";
import { telHref } from "@/components/repairs/emergency-banner";
import type { QuoteCandidate } from "./types";

/**
 * "Get quotes" (repairs-spec §8.2). Up to five contractors; Walkup drafts an
 * email to each, or gives a short script for a call. One requestQuotes call
 * writes the bids, drafts and links together. Nothing is sent: each draft
 * opens in the board member's own mail app.
 *
 * Also opened by the find page's ask bar with its picks (`preselected`).
 */

const MAX_PICKS = 5;

type Result = Extract<Awaited<ReturnType<typeof requestQuotes>>, { ok: true }>;

export function RequestQuotesDialog(props: {
  ticketId: string;
  trade: string | null;
  candidates: QuoteCandidate[];
  /** Contractors with a live quote on this problem. */
  alreadyAsked: string[];
  photos: { documentId: string }[];
  /** The sender's own address, for "Send as one email to all". */
  senderEmail: string | null;
  preselected?: string[];
  open: boolean;
  onClose: () => void;
  /** "Record their quote" after a call. */
  onRecord?: (vendorId: string) => void;
}) {
  const router = useRouter();
  const asked = useMemo(() => new Set(props.alreadyAsked), [props.alreadyAsked]);
  const initial = () => {
    const m = new Map<string, boolean>();
    for (const id of props.preselected ?? []) {
      const c = props.candidates.find((x) => x.vendorId === id);
      if (c && !asked.has(id)) m.set(id, !c.email);
    }
    return m;
  };
  const [picks, setPicks] = useState<Map<string, boolean>>(initial);
  const [attach, setAttach] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asOne, setAsOne] = useState(false);
  const [pending, start] = useTransition();

  const tradeName = props.trade ? tradeLabel(props.trade) : null;
  const matches = props.trade ? props.candidates.filter((c) => c.tradeMatch) : props.candidates;
  const others = props.trade ? props.candidates.filter((c) => !c.tradeMatch) : [];
  const n = picks.size;

  function toggle(c: QuoteCandidate, on: boolean) {
    setPicks((m) => {
      const next = new Map(m);
      if (on) next.set(c.vendorId, !c.email);
      else next.delete(c.vendorId);
      return next;
    });
  }

  function setByPhone(id: string, byPhone: boolean) {
    setPicks((m) => new Map(m).set(id, byPhone));
  }

  function ask() {
    setError(null);
    start(async () => {
      const r = await requestQuotes(
        props.ticketId,
        [...picks.entries()].map(([vendorId, byPhone]) => ({ vendorId, byPhone })),
        attach,
      );
      if ("error" in r) setError(r.error);
      else setResult(r);
    });
  }

  function close() {
    if (result) router.refresh();
    setResult(null);
    setPicks(initial());
    setAsOne(false);
    props.onClose();
  }

  const findHref = `/repairs/find?ticket=${props.ticketId}`;
  const photoAttachments = props.photos.map((p, i) => ({ documentId: p.documentId, filename: `Photo ${i + 1}` }));

  const row = (c: QuoteCandidate) => {
    const isAsked = asked.has(c.vendorId);
    const on = picks.has(c.vendorId);
    const byPhone = picks.get(c.vendorId) ?? !c.email;
    return (
      <li key={c.vendorId} className="py-3">
        <label className={`flex min-h-[44px] items-start gap-3 ${isAsked ? "opacity-60" : "cursor-pointer"}`}>
          <input
            type="checkbox"
            className="mt-1 h-5 w-5"
            checked={on}
            disabled={isAsked || pending}
            onChange={(e) => toggle(c, e.target.checked)}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium text-ink">{c.name}</span>
            <span className="mt-1 flex flex-wrap gap-1">
              {isAsked ? <Pill tone="outline">Already asked</Pill> : null}
              {!c.email ? <Pill tone="outline">No email on file</Pill> : null}
              {c.why.map((w) => (
                <Pill key={w.key} tone={w.tone === "bad" ? "bad" : w.tone === "warning" ? "warning" : w.tone === "good" ? "good" : "neutral"}>
                  {w.text}
                </Pill>
              ))}
            </span>
          </span>
        </label>
        {on && c.email ? (
          <div className="ml-8 mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={`How to ask ${c.name}`}>
            {[
              { v: false, label: "Email" },
              { v: true, label: "Call them instead" },
            ].map((o) => (
              <label key={o.label} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-[13px] has-[:checked]:border-ink">
                <input type="radio" name={`how-${c.vendorId}`} checked={byPhone === o.v} onChange={() => setByPhone(c.vendorId, o.v)} />
                {o.label}
              </label>
            ))}
          </div>
        ) : null}
      </li>
    );
  };

  const emailDrafts = result?.drafts.filter((d) => d.to.length > 0) ?? [];

  return (
    <Sheet
      open={props.open}
      onClose={close}
      wide
      title={result ? "Your quote requests" : "Get quotes"}
      footer={
        result ? (
          <button type="button" onClick={close} className={btnPrimary}>
            Done
          </button>
        ) : (
          <>
            <button type="button" onClick={ask} disabled={n === 0 || n > MAX_PICKS || pending} className={btnPrimary}>
              {pending ? "Drafting…" : `Ask ${n || ""}`.trim()}
            </button>
            <button type="button" onClick={close} className={btnSecondary}>
              Cancel
            </button>
            {n > MAX_PICKS ? <p className={errorClass}>Pick up to 5.</p> : null}
            {error ? <p className={errorClass}>{error}</p> : null}
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-6">
          {result.skipped.length > 0 ? (
            <ul className="space-y-1 text-[13px] text-mute">
              {result.skipped.map((s) => (
                <li key={s.vendorId}>
                  {s.vendorName}: {s.reason === "already_asked" ? "already asked for this problem." : "not available (archived or marked do not use)."}
                </li>
              ))}
            </ul>
          ) : null}

          {emailDrafts.length >= 2 ? (
            <div className="rounded-lg border border-line px-4 py-3">
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[14px]">
                <input type="checkbox" className="h-5 w-5" checked={asOne} onChange={(e) => setAsOne(e.target.checked)} />
                Send as one email to all {emailDrafts.length}
              </label>
              {asOne ? (
                <div className="mt-3">
                  <DraftEmail
                    title={`Quote request to ${emailDrafts.length} contractors`}
                    to={props.senderEmail ? [props.senderEmail] : []}
                    bcc={emailDrafts.flatMap((d) => d.to)}
                    subject={emailDrafts[0].subject}
                    body={emailDrafts[0].body.replace(/^[^\n]*\n/, "Hello,\n")}
                    note={attach ? "A mail link can't carry attachments. Save the photos below, then attach them in your email." : undefined}
                    attachments={attach ? photoAttachments : undefined}
                    onMarkSent={async (final) => {
                      const r = await markMessagesSent(
                        emailDrafts.map((d) => d.messageId),
                        { subject: final.subject, body: final.body },
                      );
                      return "error" in r ? r : { ok: true as const };
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {!asOne
            ? result.drafts.map((d) => (
                <section key={d.messageId} aria-label={`Quote request to ${d.vendorName}`}>
                  <ContractorDraft
                    messageId={d.messageId}
                    to={d.to}
                    subject={d.subject}
                    body={d.body}
                    title={`Quote request to ${d.vendorName}`}
                    note={attach ? "A mail link can't carry attachments. Save the photos below, then attach them in your email." : undefined}
                    attachments={attach ? photoAttachments : undefined}
                  />
                </section>
              ))
            : null}

          {result.calls.map((c) => (
            <section key={c.bidId} className="space-y-2 rounded-lg border border-line px-4 py-3">
              <p className="text-[14px] font-medium text-ink">Call {c.vendorName}</p>
              {c.phone ? (
                <a href={telHref(c.phone)} className={btnSecondary}>
                  Call {c.phone}
                </a>
              ) : (
                <p className="text-[13px] text-mute">No phone number on file. Add one on their profile.</p>
              )}
              <blockquote className="border-l-2 border-line-strong pl-3 text-[13px] text-ink">{c.script}</blockquote>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={c.script} />
                {props.onRecord ? (
                  <button
                    type="button"
                    className={btnSecondary}
                    onClick={() => {
                      close();
                      props.onRecord?.(c.vendorId);
                    }}
                  >
                    Record their quote
                  </button>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] text-mute">
            Pick up to 5 contractors. Walkup drafts an email to each, or gives you a short script if you&rsquo;d rather call. You send or call yourself.
          </p>

          {props.trade && matches.length === 0 ? (
            <div className="space-y-3">
              <p className="text-[14px] text-ink">None of your saved contractors do {tradeName} yet.</p>
              <Link href={findHref} className={`${btnPrimary} w-full sm:w-auto`}>
                Find {tradeName} contractors near you
              </Link>
              {others.length > 0 ? (
                <Disclosure label="Your other contractors">
                  <ul className="divide-y divide-line">{others.map(row)}</ul>
                </Disclosure>
              ) : null}
            </div>
          ) : (
            <>
              <div>
                <h3 className="eyebrow text-mute">{props.trade ? `Do ${tradeName}` : "Your contractors"}</h3>
                {matches.length === 0 ? (
                  <p className="mt-2 text-[13px] text-mute">No saved contractors yet.</p>
                ) : (
                  <ul className="divide-y divide-line">{matches.map(row)}</ul>
                )}
              </div>
              {others.length > 0 ? (
                <Disclosure label="Everyone else">
                  <ul className="divide-y divide-line">{others.map(row)}</ul>
                </Disclosure>
              ) : null}
            </>
          )}

          <Link href={findHref} className={`${linkClass} inline-flex min-h-[44px] items-center text-[13px]`}>
            Find more contractors
          </Link>

          {props.photos.length > 0 ? (
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[14px] text-ink">
              <input type="checkbox" className="h-5 w-5" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
              I&rsquo;ll attach the photos
            </label>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center justify-between text-left text-[13px] font-medium text-ink"
      >
        {label}
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open ? children : null}
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={btnSecondary}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
