"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptBid, declineBid, draftNotChosen, markNoQuote } from "@/app/maintenance/bid-actions";
import { createDraft } from "@/app/contractors/actions";
import { DownloadButton } from "@/app/documents/document-row";
import { Card } from "@/components/ui";
import { ContractorDraft } from "@/components/repairs/contractor-draft";
import { Pill } from "@/components/repairs/pills";
import { Sheet } from "@/components/repairs/sheet";
import { btnPrimary, btnSecondary, errorClass, labelClass, textareaClass } from "@/components/repairs/styles";
import { humanDate, monthYear, moneyText } from "@/lib/repairs/format";
import { toCents, fromCents } from "@/lib/tax/form1120h";
import { useTicketDialogs } from "./ticket-dialogs";
import type { AmountKind, BidView, VendorView } from "./types";

/**
 * Quotes for a problem (repairs-spec §8.3, §8.5): what each contractor
 * offered, side by side, like for like where it can be and saying so where
 * it can't. Walkup records quotes; it doesn't place the work. Nothing is
 * labelled "best": the lowest price gets a neutral pill, and that's all.
 */

const KIND_WORDS: Record<AmountKind, string> = { fixed: "fixed price", estimate: "estimate", not_to_exceed: "not to exceed" };
const KIND_ARTICLE: Record<AmountKind, string> = { fixed: "a fixed price", estimate: "an estimate", not_to_exceed: "a not-to-exceed figure" };
const STATUS_LABEL: Record<BidView["status"], string> = {
  requested: "Asked",
  received: "Quote in",
  accepted: "Accepted",
  declined: "Not chosen",
  withdrawn: "No quote",
};

const COMPARED = new Set<BidView["status"]>(["received", "accepted", "declined"]);

export function quoteSummary(bids: BidView[]): string {
  const live = bids.filter((b) => b.status !== "withdrawn");
  const compared = bids.filter((b) => COMPARED.has(b.status) && b.amount !== null);
  const head = `${compared.length} of ${live.length} ${live.length === 1 ? "quote" : "quotes"} in`;
  if (compared.length < 2) return head;
  const sorted = [...compared].sort((a, b) => toCents(a.amount!) - toCents(b.amount!));
  const low = sorted[0];
  const differ = sorted.filter((b) => b.amountKind !== low.amountKind);
  if (differ.length === 0) return `${head}. Lowest ${moneyText(low.amount)} from ${low.vendorName}.`;
  const clauses = differ.map((b) => `${b.vendorName}'s is ${KIND_ARTICLE[b.amountKind]}`).join("; ");
  return `${head}. Lowest price quoted: ${moneyText(low.amount)} from ${low.vendorName}. Not like for like: ${clauses}.`;
}

export function QuotesCard(props: {
  ticketId: string;
  bids: BidView[];
  vendors: VendorView[];
  canWrite: boolean;
  todayIso: string;
}) {
  const { recordQuote } = useTicketDialogs();
  const today = props.todayIso;
  const vendorById = new Map(props.vendors.map((v) => [v.id, v]));
  const compared = props.bids
    .filter((b) => COMPARED.has(b.status) && b.amount !== null)
    .sort((a, b) => toCents(a.amount!) - toCents(b.amount!));
  const lowest = compared[0] ?? null;
  const sameKind = compared.every((b) => b.amountKind === lowest?.amountKind);
  const requested = props.bids.filter((b) => b.status === "requested");
  const withdrawn = props.bids.filter((b) => b.status === "withdrawn");
  const accepted = props.bids.find((b) => b.status === "accepted") ?? null;
  const others = accepted ? props.bids.filter((b) => b.id !== accepted.id && (b.status === "declined" || b.status === "received")) : [];

  const [accepting, setAccepting] = useState<BidView | null>(null);
  const [declining, setDeclining] = useState<BidView | null>(null);

  const diff = (b: BidView) => {
    if (!lowest || b.id === lowest.id || !b.amount || !lowest.amount) return null;
    const d = toCents(b.amount) - toCents(lowest.amount);
    if (d <= 0) return null;
    const low = toCents(lowest.amount);
    const pct = low > 0 ? Math.round((d / low) * 100) : null;
    return `+${moneyText(fromCents(d))}${pct !== null ? ` (${pct}%)` : ""} vs lowest`;
  };

  const fields = (b: BidView): { label: string; node: React.ReactNode }[] => {
    const v = vendorById.get(b.vendorId);
    const expired = b.validUntil && b.validUntil < today;
    return [
      {
        label: "Price",
        node: (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="figures text-[15px] text-ink">{moneyText(b.amount)}</span>
              <span className="text-[12px] text-mute">{KIND_WORDS[b.amountKind]}</span>
              {lowest?.id === b.id && compared.length >= 2 ? <Pill tone="neutral">{sameKind ? "Lowest" : "Lowest price quoted"}</Pill> : null}
            </div>
            {diff(b) ? <div className="text-[12px] text-mute">{diff(b)}</div> : null}
          </div>
        ),
      },
      { label: "Payment terms", node: b.paymentTermsText ?? <Muted>Not stated</Muted> },
      { label: "Can start", node: b.canStartOn ? humanDate(b.canStartOn, today) : <Muted>Not stated</Muted> },
      { label: "Takes", node: b.durationText ?? <Muted>Not stated</Muted> },
      {
        label: "Valid until",
        node: b.validUntil ? (
          <span className="flex flex-wrap items-center gap-2">
            {humanDate(b.validUntil, today)}
            {expired ? <Pill tone="warning">Expired</Pill> : null}
          </span>
        ) : (
          <Muted>Not stated</Muted>
        ),
      },
      { label: "What's included", node: b.scopeText ? <Clamp text={b.scopeText} /> : <Muted>Not stated</Muted> },
      { label: "Not included", node: b.exclusionsText ?? <Muted>Not stated</Muted> },
      { label: "Warranty", node: b.warrantyText ?? <Muted>Not stated</Muted> },
      {
        label: "Their paperwork",
        node:
          v && v.compliance.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {v.compliance.map((c) => (
                <Pill key={c.key} tone={c.tone === "bad" ? "bad" : "warning"}>
                  {c.text}
                </Pill>
              ))}
            </span>
          ) : (
            <Muted>Nothing missing</Muted>
          ),
      },
      {
        label: "Your history with them",
        node: v && v.jobs > 0 ? `${v.jobs} ${v.jobs === 1 ? "job" : "jobs"}${v.lastUsedOn ? `, last ${monthYear(v.lastUsedOn)}` : ""}` : "First time",
      },
      {
        label: "Ratings",
        node: (
          <span className="space-y-0.5">
            <span className="block">{v?.boardReviewCount ? `Your board ${v.boardAverage} (${v.boardReviewCount})` : "Your board: no reviews yet"}</span>
            {v?.googleRating !== null && v?.googleRating !== undefined ? (
              <span className="block">
                Google {v.googleRating.toFixed(1)} ({v.googleReviewCount ?? 0})
              </span>
            ) : null}
          </span>
        ),
      },
      { label: "Quote document", node: b.documentId ? <DownloadButton id={b.documentId}>Open</DownloadButton> : <Muted>None</Muted> },
    ];
  };

  const actions = (b: BidView) =>
    props.canWrite ? (
      b.status === "accepted" ? (
        <div className="space-y-2">
          <p className="text-[13px] text-good-text">Accepted {b.decidedAt ? humanDate(b.decidedAt, today) : ""}</p>
          <button type="button" className={btnSecondary} onClick={() => recordQuote({ bid: b })}>
            Edit
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} onClick={() => setAccepting(b)}>
            Accept this quote
          </button>
          <button type="button" className={btnSecondary} onClick={() => recordQuote({ bid: b })}>
            Edit
          </button>
          {b.status === "received" ? (
            <button type="button" className={btnSecondary} onClick={() => setDeclining(b)}>
              Not chosen
            </button>
          ) : null}
        </div>
      )
    ) : b.status === "accepted" ? (
      <p className="text-[13px] text-good-text">Accepted {b.decidedAt ? humanDate(b.decidedAt, today) : ""}</p>
    ) : null;

  return (
    <div id="quotes" className="scroll-mt-4">
      <Card title="Quotes" hint="What each contractor offered. Walkup records quotes; it doesn't place the work.">
        <div className="space-y-4">
          <p className="text-[14px] text-ink">{quoteSummary(props.bids)}</p>

          {compared.length > 0 ? (
            <>
              {/* Desktop: one column per quote. */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line">
                      <th scope="row" className="w-40 py-2 pr-3 align-bottom text-[12px] font-medium text-mute">
                        Contractor
                      </th>
                      {compared.map((b) => (
                        <th key={b.id} scope="col" className="py-2 pr-3 align-bottom font-medium text-ink">
                          <Link href={`/contractors/${b.vendorId}`} className="underline-offset-2 hover:underline">
                            {b.vendorName}
                          </Link>
                          <div className="mt-1">
                            <Pill tone={b.status === "accepted" ? "good" : b.status === "declined" ? "outline" : "neutral"}>{STATUS_LABEL[b.status]}</Pill>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fields(compared[0]).map((row, i) => (
                      <tr key={row.label} className="border-b border-line align-top">
                        <th scope="row" className="py-2 pr-3 text-[12px] font-medium text-mute">
                          {row.label}
                        </th>
                        {compared.map((b) => (
                          <td key={b.id} className="py-2 pr-3 text-ink">
                            {fields(b)[i].node}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {props.canWrite || accepted ? (
                      <tr className="align-top">
                        <th scope="row" className="py-2 pr-3 text-[12px] font-medium text-mute">
                          Actions
                        </th>
                        {compared.map((b) => (
                          <td key={b.id} className="py-2 pr-3">
                            {actions(b)}
                          </td>
                        ))}
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {/* Phones: stacked cards, cheapest first. */}
              <ul className="space-y-3 md:hidden">
                {compared.map((b) => (
                  <li key={b.id} className="rounded-lg border border-line px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/contractors/${b.vendorId}`} className="text-[15px] font-medium text-ink underline-offset-2 hover:underline">
                        {b.vendorName}
                      </Link>
                      <Pill tone={b.status === "accepted" ? "good" : b.status === "declined" ? "outline" : "neutral"}>{STATUS_LABEL[b.status]}</Pill>
                    </div>
                    <dl className="mt-2 space-y-2 text-[13px]">
                      {fields(b).map((row) => (
                        <div key={row.label}>
                          <dt className="text-[12px] font-medium text-mute">{row.label}</dt>
                          <dd className="text-ink">{row.node}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-3">{actions(b)}</div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {requested.length > 0 ? (
            <div>
              <h3 className="eyebrow text-mute">Waiting on</h3>
              <ul className="mt-2 divide-y divide-line">
                {requested.map((b) => (
                  <RequestedRow key={b.id} bid={b} canWrite={props.canWrite} todayIso={today} onRecord={() => recordQuote({ bid: b })} />
                ))}
              </ul>
            </div>
          ) : null}

          {withdrawn.length > 0 ? (
            <p className="text-[13px] text-mute">No quote from: {withdrawn.map((b) => b.vendorName).join(", ")}.</p>
          ) : null}

          {props.canWrite ? (
            <button type="button" className={btnSecondary} onClick={() => recordQuote({})}>
              Record a quote
            </button>
          ) : null}

          {props.canWrite && accepted && others.length > 0 ? (
            <div className="rounded-lg border border-line px-4 py-3">
              <h3 className="eyebrow text-mute">Next</h3>
              <ul className="mt-2 space-y-3">
                {others.map((b) => (
                  <LetThemKnow key={b.id} bid={b} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Card>

      {accepting ? (
        <AcceptDialog
          bid={accepting}
          vendor={vendorById.get(accepting.vendorId) ?? null}
          ticketId={props.ticketId}
          onClose={() => setAccepting(null)}
        />
      ) : null}
      {declining ? <DeclineDialog bid={declining} onClose={() => setDeclining(null)} /> : null}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-mute">{children}</span>;
}

function Clamp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 280 || text.split("\n").length > 6;
  return (
    <span className="block">
      <span className={`block whitespace-pre-wrap ${open || !long ? "" : "line-clamp-6"}`}>{text}</span>
      {long ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="min-h-[44px] text-[12px] underline underline-offset-2">
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </span>
  );
}

function RequestedRow({ bid, canWrite, todayIso, onRecord }: { bid: BidView; canWrite: boolean; todayIso: string; onRecord: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const how = bid.requestedByPhone
    ? `asked by phone${bid.requestedOn ? ` ${humanDate(bid.requestedOn, todayIso)}` : ""}`
    : bid.requestedOn
      ? `asked ${humanDate(bid.requestedOn, todayIso)}`
      : "email not marked sent yet";
  return (
    <li className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-[13px] text-ink">
        {bid.vendorName} · {how}
      </span>
      {canWrite ? (
        <span className="flex flex-wrap gap-2">
          <button type="button" className={btnSecondary} onClick={onRecord}>
            Record their quote
          </button>
          <button
            type="button"
            className={btnSecondary}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await markNoQuote(bid.id);
                if ("error" in r) setError(r.error);
                else router.refresh();
              })
            }
          >
            {pending ? "Saving…" : "No quote from them"}
          </button>
          {error ? <span className={errorClass}>{error}</span> : null}
        </span>
      ) : null}
    </li>
  );
}

function LetThemKnow({ bid }: { bid: BidView }) {
  const [draft, setDraft] = useState<{ messageId: string; to: string[]; subject: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <li className="space-y-2">
      {draft ? (
        <ContractorDraft messageId={draft.messageId} to={draft.to} subject={draft.subject} body={draft.body} title={`To ${bid.vendorName}`} discardable />
      ) : (
        <button
          type="button"
          className={btnSecondary}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await draftNotChosen(bid.id);
              if ("error" in r) setError(r.error);
              else setDraft(r);
            })
          }
        >
          {pending ? "Drafting…" : `Let ${bid.vendorName} know`}
        </button>
      )}
      {error ? <p className={errorClass}>{error}</p> : null}
    </li>
  );
}

function AcceptDialog({ bid, vendor, ticketId, onClose }: { bid: BidView; vendor: VendorView | null; ticketId: string; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<{ messageId: string; to: string[]; subject: string; body: string } | null>(null);
  const name = bid.vendorName;
  const noCoi = vendor ? !vendor.coiOnFile : true;
  const noW9 = vendor ? !vendor.w9OnFile : false;

  function ask(kind: "coi_request" | "paperwork_request") {
    if (!vendor) return;
    start(async () => {
      const r = await createDraft({ vendorId: vendor.id, ticketId, kind });
      if ("error" in r) setError(r.error);
      else setDraft(r);
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Accept ${name}'s quote?`}
      footer={
        <>
          <button
            type="button"
            className={btnPrimary}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await acceptBid(bid.id);
                if ("error" in r) setError(r.error);
                else {
                  router.refresh();
                  onClose();
                }
              })
            }
          >
            {pending ? "Saving…" : "Accept quote"}
          </button>
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          {error ? <p className={errorClass}>{error}</p> : null}
        </>
      }
    >
      <div className="space-y-4 text-[14px] text-ink">
        <p>
          This records {name} as your choice and sets the estimate to {moneyText(bid.amount)}. Walkup doesn&rsquo;t tell them; send the go-ahead next.
        </p>
        {vendor && vendor.compliance.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {vendor.compliance.map((c) => (
              <Pill key={c.key} tone={c.tone === "bad" ? "bad" : "warning"}>
                {c.text}
              </Pill>
            ))}
          </div>
        ) : null}
        {noCoi ? (
          <div className="space-y-2">
            <p>No insurance certificate on file for {name}. Ask for one before work starts.</p>
            {vendor && !draft ? (
              <button type="button" className={btnSecondary} disabled={pending} onClick={() => ask(noW9 ? "paperwork_request" : "coi_request")}>
                {noW9 ? "Ask for both" : "Ask for a certificate"}
              </button>
            ) : null}
          </div>
        ) : null}
        {draft ? <ContractorDraft messageId={draft.messageId} to={draft.to} subject={draft.subject} body={draft.body} title={`To ${name}`} discardable /> : null}
        {bid.paymentTermsText ? <p>Payment terms: {bid.paymentTermsText}</p> : null}
      </div>
    </Sheet>
  );
}

function DeclineDialog({ bid, onClose }: { bid: BidView; onClose: () => void }) {
  const router = useRouter();
  const id = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Not choosing ${bid.vendorName}`}
      footer={
        <>
          <button
            type="button"
            className={btnPrimary}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await declineBid(bid.id, reason.trim() || null);
                if ("error" in r) setError(r.error);
                else {
                  router.refresh();
                  onClose();
                }
              })
            }
          >
            {pending ? "Saving…" : "Mark not chosen"}
          </button>
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          {error ? <p className={errorClass}>{error}</p> : null}
        </>
      }
    >
      <label htmlFor={id} className={labelClass}>
        Why? (optional, board only)
      </label>
      <textarea id={id} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={textareaClass} />
    </Sheet>
  );
}
