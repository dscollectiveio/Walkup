"use client";

import { createContext, useCallback, useContext, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RequestQuotesDialog } from "@/app/maintenance/[ticketId]/request-quotes-dialog";
import type { QuoteCandidate } from "@/app/maintenance/[ticketId]/types";

/**
 * The find page's shared state (repairs-spec §9.1): which cards are ticked,
 * across the saved list (server-rendered) and the found list (client), and
 * the "Get quotes" dialog (§8.2) the ask bar and "Save and ask for a quote"
 * open with exactly those contractors ticked. A contractor saved a moment
 * ago only appears in the dialog's list after the page's data refreshes, so
 * the dialog waits for that refresh.
 */

export interface FindTicket {
  id: string;
  reference: number;
  trade: string | null;
  candidates: QuoteCandidate[];
  alreadyAsked: string[];
  photos: { documentId: string }[];
  senderEmail: string | null;
}

interface FindApi {
  trade: string;
  ticket: FindTicket | null;
  saved: ReadonlySet<string>;
  found: ReadonlyMap<string, string>;
  toggleSaved: (vendorId: string, on: boolean) => void;
  toggleFound: (candidateId: string, name: string, on: boolean) => void;
  clear: () => void;
  /** Open "Get quotes" with these contractors ticked (ticket pages only). */
  askFor: (vendorIds: string[]) => void;
}

const Ctx = createContext<FindApi | null>(null);

export function useFind(): FindApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useFind outside FindProvider");
  return api;
}

export function FindProvider(props: { trade: string; ticket: FindTicket | null; children: React.ReactNode }) {
  const router = useRouter();
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const [found, setFound] = useState<Map<string, string>>(() => new Map());
  const [askIds, setAskIds] = useState<string[] | null>(null);
  const [refreshing, startRefresh] = useTransition();

  const toggleSaved = useCallback((vendorId: string, on: boolean) => {
    setSaved((s) => {
      const next = new Set(s);
      if (on) next.add(vendorId);
      else next.delete(vendorId);
      return next;
    });
  }, []);
  const toggleFound = useCallback((candidateId: string, name: string, on: boolean) => {
    setFound((m) => {
      const next = new Map(m);
      if (on) next.set(candidateId, name);
      else next.delete(candidateId);
      return next;
    });
  }, []);
  const clear = useCallback(() => {
    setSaved(new Set());
    setFound(new Map());
  }, []);
  const askFor = useCallback(
    (vendorIds: string[]) => {
      setAskIds([...new Set(vendorIds)]);
      startRefresh(() => router.refresh());
    },
    [router],
  );

  const api = useMemo(
    () => ({ trade: props.trade, ticket: props.ticket, saved, found, toggleSaved, toggleFound, clear, askFor }),
    [props.trade, props.ticket, saved, found, toggleSaved, toggleFound, clear, askFor],
  );

  const t = props.ticket;
  const ready = Boolean(askIds && t && (!refreshing || askIds.every((id) => t.candidates.some((c) => c.vendorId === id))));

  return (
    <Ctx.Provider value={api}>
      {props.children}
      {t && askIds && ready ? (
        <RequestQuotesDialog
          key={askIds.join(",")}
          ticketId={t.id}
          trade={t.trade}
          candidates={t.candidates}
          alreadyAsked={t.alreadyAsked}
          photos={t.photos}
          senderEmail={t.senderEmail}
          preselected={askIds}
          open
          onClose={() => {
            setAskIds(null);
            clear();
          }}
        />
      ) : null}
      {t && askIds && !ready ? (
        <p role="status" className="sr-only">
          Getting the quote request ready…
        </p>
      ) : null}
    </Ctx.Provider>
  );
}

/** The tick box on a saved contractor's card. */
export function SavedSelect({ vendorId, name, disabled }: { vendorId: string; name: string; disabled?: boolean }) {
  const { saved, toggleSaved } = useFind();
  return (
    <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
      <input
        type="checkbox"
        className="h-5 w-5"
        aria-label={`Select ${name}`}
        checked={saved.has(vendorId)}
        disabled={disabled}
        onChange={(e) => toggleSaved(vendorId, e.target.checked)}
      />
    </label>
  );
}
