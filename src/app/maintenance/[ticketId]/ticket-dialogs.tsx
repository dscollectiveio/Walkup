"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CloseOutDialog, type CloseOutProps } from "./close-out-dialog";
import { RecordQuoteDialog } from "./record-quote-dialog";
import { RequestQuotesDialog } from "./request-quotes-dialog";
import type { BidView, QuoteCandidate } from "./types";

/**
 * The ticket page's three sheets (get quotes, record a quote, mark fixed),
 * rendered once and opened from whichever card holds the button. Each action
 * button lives in exactly one card (repairs-spec §5.3); Today and the
 * pipeline link here with ?open=quotes|fix|go-ahead to open one directly.
 */

interface Api {
  askQuotes: (preselected?: string[]) => void;
  recordQuote: (opts: { bid?: BidView | null; vendorId?: string | null }) => void;
  markFixed: () => void;
  /** ?open= from the URL, consumed once by the card that owns it. */
  initialOpen: string | null;
}

const Ctx = createContext<Api | null>(null);

export function useTicketDialogs(): Api {
  const api = useContext(Ctx);
  if (!api) throw new Error("useTicketDialogs outside TicketDialogs");
  return api;
}

export function TicketDialogs(props: {
  ticketId: string;
  trade: string | null;
  candidates: QuoteCandidate[];
  bids: BidView[];
  photos: { documentId: string }[];
  senderEmail: string | null;
  everyone: { id: string; name: string }[];
  aiConfigured: boolean;
  closeOut: Omit<CloseOutProps, "open" | "onClose" | "ticketId">;
  initialOpen: string | null;
  children: React.ReactNode;
}) {
  const [quotesOpen, setQuotesOpen] = useState(props.initialOpen === "quotes");
  const [preselected, setPreselected] = useState<string[]>([]);
  const [record, setRecord] = useState<{ bid: BidView | null; vendorId: string | null; key: number } | null>(null);
  const [fixOpen, setFixOpen] = useState(props.initialOpen === "fix");

  // Drop ?open= so a refresh doesn't reopen the sheet.
  useEffect(() => {
    if (!props.initialOpen) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("open");
    window.history.replaceState(null, "", url.toString());
  }, [props.initialOpen]);

  const live = props.bids.filter((b) => b.status === "requested" || b.status === "received" || b.status === "accepted");
  const askedIds = live.map((b) => b.vendorId);
  const asked = props.everyone.filter((v) => askedIds.includes(v.id));

  const askQuotes = useCallback((pre?: string[]) => {
    setPreselected(pre ?? []);
    setQuotesOpen(true);
  }, []);
  const recordQuote = useCallback((opts: { bid?: BidView | null; vendorId?: string | null }) => {
    setRecord({ bid: opts.bid ?? null, vendorId: opts.vendorId ?? null, key: Date.now() });
  }, []);
  const markFixed = useCallback(() => setFixOpen(true), []);
  const api = useMemo(() => ({ askQuotes, recordQuote, markFixed, initialOpen: props.initialOpen }), [askQuotes, recordQuote, markFixed, props.initialOpen]);

  return (
    <Ctx.Provider value={api}>
      {props.children}
      <RequestQuotesDialog
        key={preselected.join(",")}
        ticketId={props.ticketId}
        trade={props.trade}
        candidates={props.candidates}
        alreadyAsked={askedIds}
        photos={props.photos}
        senderEmail={props.senderEmail}
        preselected={preselected}
        open={quotesOpen}
        onClose={() => setQuotesOpen(false)}
        onRecord={(vendorId) => recordQuote({ vendorId })}
      />
      {record ? (
        <RecordQuoteDialog
          key={record.key}
          ticketId={props.ticketId}
          open
          onClose={() => setRecord(null)}
          bid={record.bid}
          vendorId={record.vendorId}
          asked={asked}
          everyone={props.everyone}
          aiConfigured={props.aiConfigured}
        />
      ) : null}
      <CloseOutDialog {...props.closeOut} ticketId={props.ticketId} open={fixOpen} onClose={() => setFixOpen(false)} />
    </Ctx.Provider>
  );
}
