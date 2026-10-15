"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PollWhileRunning } from "@/components/ai/poll-while-running";
import { saveFoundContact, savePartnerAsContact } from "../contact-actions";
import { startMarketSearch } from "../market-actions";
import { ContactDialog } from "../components/contact-dialog";
import { btnGhost, btnPrimary, errorBlock, infoBlock } from "../components/styles";

/**
 * The Marketplace's client pieces (insurance-spec §9.6): the search button
 * and its background run, saving a found agency or insurer (from the cached
 * research row, never from what the browser holds), and "Add a contact".
 */

const small = "inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill disabled:opacity-50";

/** The search button with the "left today" line, or the run in progress. */
export function MarketSearch({
  kind,
  label,
  againLabel,
  hasResults,
  running,
  startedAt,
  searchedToday,
  remaining,
  disabled,
}: {
  kind: "agencies" | "insurers";
  label: string;
  againLabel: string;
  hasResults: boolean;
  running: boolean;
  startedAt: string | null;
  /** Hide "Search again" within 24 hours of the last search; show "Searched today". */
  searchedToday: boolean;
  /** "3 web searches left today", or null. */
  remaining: string | null;
  /** No searches left today. */
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const search = (force: boolean) =>
    start(async () => {
      setError(null);
      setNotice(null);
      const r = await startMarketSearch(kind, force);
      if ("error" in r) setError(r.error);
      else {
        if (r.notice) setNotice(r.notice);
        router.refresh();
      }
    });

  if (running) {
    return (
      <PollWhileRunning
        running
        startedAt={startedAt}
        intervalMs={5000}
        label="Searching the web"
        onRetry={() => startMarketSearch(kind, true)}
      >
        <p className="text-[12px] text-mute">This usually takes under a minute. You can leave; results will be here.</p>
      </PollWhileRunning>
    );
  }

  return (
    <div className="space-y-2">
      {hasResults && searchedToday ? (
        <p className="text-[12px] text-mute">Searched today</p>
      ) : (
        <div>
          <button type="button" className={hasResults ? btnGhost : btnPrimary} disabled={pending || disabled} onClick={() => search(hasResults)}>
            {pending ? "Searching…" : hasResults ? againLabel : label}
          </button>
          {remaining ? <p className="mt-1 text-[12px] text-mute">{remaining}</p> : null}
        </div>
      )}
      {notice ? <p className={infoBlock}>{notice}</p> : null}
      {error ? <p className={errorBlock}>{error}</p> : null}
    </div>
  );
}

/** "Save to contacts" and "Ask for a quote" on a found agency or insurer. */
export function FoundButtons({
  kind,
  fetchedAt,
  itemKey,
  name,
  savedContactId,
  askForQuote,
  extra,
}: {
  kind: "agencies" | "insurers";
  fetchedAt: string;
  itemKey: string;
  name: string;
  savedContactId: string | null;
  askForQuote: boolean;
  extra?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(savedContactId);

  const save = (then?: (id: string) => void) =>
    start(async () => {
      setError(null);
      if (saved) {
        then?.(saved);
        return;
      }
      const r = await saveFoundContact({ kind, fetchedAt, key: itemKey });
      if ("error" in r) setError(r.error);
      else {
        setSaved(r.contactId);
        if (then) then(r.contactId);
        else router.refresh();
      }
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {saved ? (
          <span className="inline-flex min-h-[44px] items-center px-1 text-[12px] font-medium text-good-text">Saved</span>
        ) : (
          <button type="button" className={small} disabled={pending} onClick={() => save()} aria-label={`Save ${name} to contacts`}>
            {pending ? "Saving…" : "Save to contacts"}
          </button>
        )}
        {askForQuote ? (
          <button
            type="button"
            className={small}
            disabled={pending}
            onClick={() => save((id) => router.push(`/insurance?view=quotes&new=1&contact=${id}`))}
            aria-label={`Ask ${name} for a quote`}
          >
            Ask for a quote
          </button>
        ) : null}
        {extra}
      </div>
      {error ? <p className={errorBlock}>{error}</p> : null}
    </div>
  );
}

/** A broker listed with Walkup: save it as a contact, or ask it for a quote. */
export function PartnerButtons({ partnerId, name, savedContactId }: { partnerId: string; name: string; savedContactId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(savedContactId);
  const save = (then?: (id: string) => void) =>
    start(async () => {
      setError(null);
      if (saved) {
        then?.(saved);
        return;
      }
      const r = await savePartnerAsContact(partnerId);
      if ("error" in r) setError(r.error);
      else {
        setSaved(r.contactId);
        if (then) then(r.contactId);
        else router.refresh();
      }
    });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {saved ? (
          <span className="inline-flex min-h-[44px] items-center px-1 text-[12px] font-medium text-good-text">Saved</span>
        ) : (
          <button type="button" className={small} disabled={pending} onClick={() => save()} aria-label={`Save ${name} to contacts`}>
            {pending ? "Saving…" : "Save to contacts"}
          </button>
        )}
        <button
          type="button"
          className={small}
          disabled={pending}
          onClick={() => save((id) => router.push(`/insurance?view=quotes&new=1&contact=${id}`))}
          aria-label={`Ask ${name} for a quote`}
        >
          Ask for a quote
        </button>
      </div>
      {error ? <p className={errorBlock}>{error}</p> : null}
    </div>
  );
}

/** "Add a contact" (the dialog), then the contact's page. */
export function AddContactButton({ label = "Add a contact" }: { label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={btnGhost} onClick={() => setOpen(true)}>
        {label}
      </button>
      <ContactDialog
        open={open}
        contact={null}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
