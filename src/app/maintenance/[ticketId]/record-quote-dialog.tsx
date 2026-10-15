"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { readBidDocument, readBidText, recordBid } from "@/app/maintenance/bid-actions";
import { DownloadButton } from "@/app/documents/document-row";
import { DirectUpload } from "@/components/upload/direct-upload";
import { Sheet, StillWorking } from "@/components/repairs/sheet";
import {
  btnPrimary,
  btnSecondary,
  choiceRow,
  errorClass,
  inputClass,
  labelClass,
  textareaClass,
} from "@/components/repairs/styles";
import type { BidPrefill } from "@/lib/repairs/bid-read";
import type { AmountKind, BidView } from "./types";

/**
 * "Record a quote" (repairs-spec §8.4): type it in, upload the PDF, or paste
 * a quote that came by text. "Read it for me" fills only the empty fields
 * and marks what it filled; the board checks every figure before saving.
 * Scans and photos are entered by hand (brief decision 7 covers insurance
 * documents only).
 */

type Fields = {
  amount: string;
  amountKind: AmountKind;
  paymentTerms: string;
  receivedOn: string;
  validUntil: string;
  canStartOn: string;
  duration: string;
  scope: string;
  exclusions: string;
  warranty: string;
  notes: string;
};

const PREFILL_KEYS: Record<keyof Fields, keyof BidPrefill | null> = {
  amount: "amount",
  amountKind: "amountKind",
  paymentTerms: "paymentTermsText",
  receivedOn: "receivedOn",
  validUntil: "validUntil",
  canStartOn: "canStartOn",
  duration: "durationText",
  scope: "scopeText",
  exclusions: "exclusionsText",
  warranty: "warrantyText",
  notes: null,
};

function fieldsFrom(bid: BidView | null): Fields {
  return {
    amount: bid?.amount ?? "",
    amountKind: bid?.amountKind ?? "fixed",
    paymentTerms: bid?.paymentTermsText ?? "",
    receivedOn: bid?.receivedOn ?? "",
    validUntil: bid?.validUntil ?? "",
    canStartOn: bid?.canStartOn ?? "",
    duration: bid?.durationText ?? "",
    scope: bid?.scopeText ?? "",
    exclusions: bid?.exclusionsText ?? "",
    warranty: bid?.warrantyText ?? "",
    notes: bid?.notes ?? "",
  };
}

const orNull = (v: string) => (v.trim() ? v.trim() : null);

export function RecordQuoteDialog(props: {
  ticketId: string;
  open: boolean;
  onClose: () => void;
  /** Editing this quote, or recording one for this contractor (fixed). */
  bid: BidView | null;
  vendorId: string | null;
  /** Contractors already asked, then everyone else saved. */
  asked: { id: string; name: string }[];
  everyone: { id: string; name: string }[];
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const ids = { vendor: useId(), amount: useId(), terms: useId(), received: useId(), valid: useId(), start: useId(), duration: useId(), scope: useId(), excl: useId(), warranty: useId(), notes: useId(), paste: useId() };
  const fixedVendor = props.bid?.vendorId ?? props.vendorId;
  const [vendorId, setVendorId] = useState<string>(fixedVendor ?? props.asked[0]?.id ?? "");
  const [f, setF] = useState<Fields>(() => fieldsFrom(props.bid));
  const [filled, setFilled] = useState<Set<keyof Fields>>(new Set());
  const [documentId, setDocumentId] = useState<string | null>(props.bid?.documentId ?? null);
  const [uploadedPdf, setUploadedPdf] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [readNote, setReadNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setFilled((s) => {
      if (!s.has(k)) return s;
      const n = new Set(s);
      n.delete(k);
      return n;
    });
  };

  function applyPrefill(p: BidPrefill) {
    const next = { ...f };
    const marked = new Set(filled);
    for (const key of Object.keys(PREFILL_KEYS) as (keyof Fields)[]) {
      const src = PREFILL_KEYS[key];
      if (!src) continue;
      const value = p[src];
      if (value === null || value === undefined || value === "") continue;
      if (key === "amountKind") {
        if (!props.bid && f.amountKind === "fixed") {
          next.amountKind = value as AmountKind;
          marked.add(key);
        }
        continue;
      }
      if (String(next[key]).trim() === "") {
        (next as Record<string, string>)[key] = String(value);
        marked.add(key);
      }
    }
    setF(next);
    setFilled(marked);
  }

  async function read(kind: "document" | "text") {
    setReading(true);
    setReadNote(null);
    const r = kind === "document" && documentId ? await readBidDocument(documentId) : await readBidText(paste);
    setReading(false);
    if ("error" in r) {
      const text = r.quota
        ? "Reading quotes is paused for today. Enter the figures by hand."
        : "manual" in r && r.manual
          ? r.error
          : kind === "text" && /Paste|longer than a quote/.test(r.error)
            ? r.error
            : "Walkup couldn't read this one. Enter the figures by hand.";
      setReadNote({ text, bad: true });
      return;
    }
    applyPrefill(r.prefill);
    setReadNote({ text: "Filled in from the quote. Check every figure before saving.", bad: false });
  }

  function save() {
    setError(null);
    if (!vendorId) {
      setError("Pick the contractor who quoted.");
      return;
    }
    start(async () => {
      const r = await recordBid({
        ticket_id: props.ticketId,
        vendor_id: vendorId,
        bid_id: props.bid?.id ?? null,
        amount: f.amount,
        amount_kind: f.amountKind,
        received_on: orNull(f.receivedOn),
        valid_until: orNull(f.validUntil),
        can_start_on: orNull(f.canStartOn),
        duration_text: orNull(f.duration),
        scope_text: orNull(f.scope),
        warranty_text: orNull(f.warranty),
        exclusions_text: orNull(f.exclusions),
        payment_terms_text: orNull(f.paymentTerms),
        notes: orNull(f.notes),
        document_id: documentId,
      });
      if ("error" in r) setError(r.error);
      else {
        router.refresh();
        props.onClose();
      }
    });
  }

  const tint = (k: keyof Fields) => (filled.has(k) ? " border-info bg-info-tint" : "");
  const vendorName =
    [...props.asked, ...props.everyone].find((v) => v.id === fixedVendor)?.name ?? props.bid?.vendorName ?? null;

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      wide
      title={props.bid ? `Edit ${props.bid.vendorName}'s quote` : "Record a quote"}
      footer={
        <>
          <button type="button" onClick={save} disabled={pending || reading} className={btnPrimary}>
            {pending ? "Saving…" : "Save quote"}
          </button>
          <button type="button" onClick={props.onClose} className={btnSecondary}>
            Cancel
          </button>
          {error ? <p className={errorClass}>{error}</p> : null}
        </>
      }
    >
      <div className="space-y-5">
        {fixedVendor ? (
          <p className="text-[14px] text-ink">
            <span className="font-medium">Contractor:</span> {vendorName}
          </p>
        ) : (
          <div>
            <label htmlFor={ids.vendor} className={labelClass}>
              Contractor
            </label>
            <select id={ids.vendor} value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={inputClass}>
              <option value="">Pick a contractor</option>
              {props.asked.length > 0 ? (
                <optgroup label="Asked for this problem">
                  {props.asked.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="Someone else">
                {props.everyone
                  .filter((v) => !props.asked.some((a) => a.id === v.id))
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
              </optgroup>
            </select>
          </div>
        )}

        <div className="space-y-3 rounded-lg border border-line px-4 py-3">
          <p className={labelClass}>Quote document</p>
          {documentId && !uploadedPdf ? (
            <p className="text-[13px] text-mute">
              A quote document is on file. <DownloadButton id={documentId}>Open</DownloadButton>
            </p>
          ) : null}
          <DirectUpload
            purpose="document"
            categorySlug="maintenance"
            accept="application/pdf,image/*"
            multiple={false}
            maxFiles={1}
            dropZone={false}
            label={documentId ? "Upload a different quote" : "Upload the quote"}
            link={{ targetTable: "tickets", targetId: props.ticketId, relation: "source" }}
            onUploaded={(docs) => {
              const d = docs[0];
              if (d?.documentId) {
                setDocumentId(d.documentId);
                setUploadedPdf(/\.pdf$/i.test(d.filename));
              }
            }}
          />
          {props.aiConfigured && documentId && uploadedPdf ? (
            <div className="space-y-1">
              <button type="button" onClick={() => read("document")} disabled={reading} className={btnSecondary}>
                {reading ? "Reading…" : "Read it for me"}
              </button>
              {reading ? <StillWorking /> : null}
            </div>
          ) : null}

          <div>
            <button
              type="button"
              aria-expanded={pasteOpen}
              onClick={() => setPasteOpen((o) => !o)}
              className="flex min-h-[44px] items-center text-[13px] font-medium text-ink underline underline-offset-2"
            >
              Paste the quote text
            </button>
            {pasteOpen ? (
              <div className="space-y-2">
                <label htmlFor={ids.paste} className="sr-only">
                  Quote text
                </label>
                <textarea
                  id={ids.paste}
                  rows={5}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder="Paste a quote that came by text message or in an email."
                  className={textareaClass}
                />
                {props.aiConfigured ? (
                  <button type="button" onClick={() => read("text")} disabled={reading || paste.trim().length === 0} className={btnSecondary}>
                    {reading ? "Reading…" : "Read it for me"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {readNote ? (
            <p role="status" className={readNote.bad ? errorClass : "text-[13px] text-info-text"}>
              {readNote.text}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.amount} className={labelClass}>
              Price
            </label>
            <input
              id={ids.amount}
              inputMode="decimal"
              required
              value={f.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="1,250"
              className={`${inputClass}${tint("amount")}`}
            />
          </div>
          <fieldset className="sm:col-span-2">
            <legend className={labelClass}>Type of price</legend>
            <div className={`mt-1 grid gap-2 sm:grid-cols-3${filled.has("amountKind") ? " rounded-lg bg-info-tint p-1" : ""}`}>
              {(
                [
                  ["fixed", "Fixed price"],
                  ["estimate", "Estimate"],
                  ["not_to_exceed", "Not to exceed"],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className={choiceRow}>
                  <input type="radio" name={`${ids.amount}-kind`} checked={f.amountKind === v} onChange={() => set("amountKind", v)} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <TextField id={ids.terms} label="Payment terms" value={f.paymentTerms} onChange={(v) => set("paymentTerms", v)} placeholder="50% deposit, rest when done" max={200} className={tint("paymentTerms")} wide />
          <DateField id={ids.received} label="Date of quote" value={f.receivedOn} onChange={(v) => set("receivedOn", v)} className={tint("receivedOn")} />
          <DateField id={ids.valid} label="Valid until" value={f.validUntil} onChange={(v) => set("validUntil", v)} className={tint("validUntil")} />
          <DateField id={ids.start} label="Can start" value={f.canStartOn} onChange={(v) => set("canStartOn", v)} className={tint("canStartOn")} />
          <TextField id={ids.duration} label="How long it takes" value={f.duration} onChange={(v) => set("duration", v)} max={120} className={tint("duration")} />
          <AreaField id={ids.scope} label="What's included" value={f.scope} onChange={(v) => set("scope", v)} max={2000} className={tint("scope")} />
          <AreaField id={ids.excl} label="Not included" value={f.exclusions} onChange={(v) => set("exclusions", v)} max={600} className={tint("exclusions")} />
          <TextField id={ids.warranty} label="Warranty" value={f.warranty} onChange={(v) => set("warranty", v)} max={300} className={tint("warranty")} wide />
          <AreaField id={ids.notes} label="Notes" value={f.notes} onChange={(v) => set("notes", v)} max={2000} />
        </div>
      </div>
    </Sheet>
  );
}

function TextField(p: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; max: number; className?: string; wide?: boolean }) {
  return (
    <div className={p.wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={p.id} className={labelClass}>
        {p.label}
      </label>
      <input id={p.id} value={p.value} maxLength={p.max} onChange={(e) => p.onChange(e.target.value)} placeholder={p.placeholder} className={`${inputClass}${p.className ?? ""}`} />
    </div>
  );
}

function DateField(p: { id: string; label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div>
      <label htmlFor={p.id} className={labelClass}>
        {p.label}
      </label>
      <input id={p.id} type="date" value={p.value} onChange={(e) => p.onChange(e.target.value)} className={`${inputClass}${p.className ?? ""}`} />
    </div>
  );
}

function AreaField(p: { id: string; label: string; value: string; onChange: (v: string) => void; max: number; className?: string }) {
  return (
    <div className="sm:col-span-2">
      <label htmlFor={p.id} className={labelClass}>
        {p.label}
      </label>
      <textarea id={p.id} rows={3} value={p.value} maxLength={p.max} onChange={(e) => p.onChange(e.target.value)} className={`${textareaClass}${p.className ?? ""}`} />
    </div>
  );
}
