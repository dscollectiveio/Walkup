"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PollWhileRunning } from "@/components/ai/poll-while-running";
import { IndeterminateBar } from "@/components/ai/indeterminate-bar";
import { FoundOnWeb } from "@/components/ai/found-on-web";
import { Pill, type PillTone } from "@/components/repairs/pills";
import { telHref } from "@/components/repairs/emergency-banner";
import { btnLink, btnPrimary, btnSecondary, errorClass, linkClass } from "@/components/repairs/styles";
import { AddVendorButton } from "@/app/contractors/vendor-form";
import { restoreContractor } from "@/app/contractors/vendor-actions";
import { mergeFound, rankFound, type FoundCandidate, type JobWant, type Why } from "@/lib/contractors/ranking";
import type { SourceState } from "@/lib/contractors/found";
import { humanDate } from "@/lib/repairs/format";
import { linkCandidate, saveCandidate, searchPlaces, startWebSearch } from "./actions";
import { useFind } from "./find-context";
import { mailtoLink } from "@/lib/email/mailto";
import { safeHttpUrl } from "@/lib/security/safe-url";

/**
 * "Found nearby" (repairs-spec §9.1 item 5, §9.5): Google on mount, the web
 * search on request and in the background, each source's state on its own,
 * then one merged list ranked with its reasons. Every detail shown comes
 * from a cache row the server wrote; saving re-reads that row, never what
 * this page holds.
 */

type SourceResult = { source: SourceState; candidates: FoundCandidate[] };

const WHY_TONE: Record<Why["tone"], PillTone> = { good: "good", neutral: "neutral", warning: "warning", bad: "bad" };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function googleMapsUrl(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

function cachedLine(fetchedAt: string, todayIso: string): string {
  const day = humanDate(fetchedAt.slice(0, 10), todayIso);
  return day === "today" ? "earlier today" : day;
}

export function FindResults(props: {
  trade: string;
  tradeLabel: string;
  phrase: string;
  wants: JobWant[];
  relatedTrades: string[];
  urgent: boolean;
  todayIso: string;
  city: string | null;
  googleOn: boolean;
  webOn: boolean;
  web: SourceResult;
  /** The web source can be started again (false when the building has no city or ZIP). */
  webRetry: boolean;
  webUsage: { used: number; limit: number } | null;
}) {
  const router = useRouter();
  const { ticket } = useFind();
  const searchKey = `${props.trade}|${props.phrase}`;

  // Google's saved results (never a new search) on mount and whenever the trade or phrase changes; a new
  // search is a button, so opening this page or a link to it spends nothing.
  const [google, setGoogle] = useState<{ key: string; result: SourceResult } | null>(null);
  const [googleAgain, startGoogleAgain] = useTransition();
  useEffect(() => {
    if (!props.googleOn) return;
    let live = true;
    // Saved results first; when there are none, search Google now, so the list fills in on its own.
    searchPlaces({ trade: props.trade, phrase: props.phrase, cacheOnly: true })
      .then((cached) => (cached.source.state === "idle" ? searchPlaces({ trade: props.trade, phrase: props.phrase }) : cached))
      .then((result) => {
        if (live) setGoogle({ key: searchKey, result });
      })
      .catch(() => {
        if (live) setGoogle({ key: searchKey, result: { source: { state: "error", message: "Google didn't answer. Try again in a minute." }, candidates: [] } });
      });
    return () => {
      live = false;
    };
  }, [props.googleOn, props.trade, props.phrase, searchKey]);
  const googleResult = google && google.key === searchKey ? google.result : null;
  const googleSearching = props.googleOn && (googleResult === null || googleAgain);

  function searchGoogleNow() {
    startGoogleAgain(async () => {
      const result = await searchPlaces({ trade: props.trade, phrase: props.phrase }).catch(
        (): SourceResult => ({ source: { state: "error", message: "Google didn't answer. Try again in a minute." }, candidates: [] }),
      );
      setGoogle({ key: searchKey, result });
    });
  }

  function searchGoogleAgain() {
    startGoogleAgain(async () => {
      const result = await searchPlaces({ trade: props.trade, phrase: props.phrase, refresh: true }).catch(
        (): SourceResult => ({ source: { state: "error", message: "Google didn't answer. Try again in a minute." }, candidates: [] }),
      );
      setGoogle({ key: searchKey, result });
    });
  }

  // The web search: started by a button, runs in the background, the server render reports it.
  const [webPending, startWeb] = useTransition();
  const [webError, setWebError] = useState<{ message: string; quota?: boolean } | null>(null);
  function runWeb(refresh: boolean) {
    setWebError(null);
    startWeb(async () => {
      const r = await startWebSearch({ trade: props.trade, phrase: props.phrase, wants: props.wants, refresh });
      if ("error" in r) setWebError({ message: r.error, quota: r.quota === true });
      else router.refresh();
    });
  }

  const ctx = useMemo(
    () => ({ trade: props.trade, relatedTrades: props.relatedTrades, urgent: props.urgent, wants: props.wants, todayIso: props.todayIso }),
    [props.trade, props.relatedTrades, props.urgent, props.wants, props.todayIso],
  );
  const googleCandidates = useMemo(() => googleResult?.candidates ?? [], [googleResult]);
  // Anyone already saved as a contractor is left out: this list is for finding new people.
  const ranked = useMemo(
    () => rankFound(mergeFound(googleCandidates, props.web.candidates), ctx).filter((c) => !c.alreadySaved),
    [googleCandidates, props.web.candidates, ctx],
  );

  const web = props.web.source;
  const webRunning = web.state === "running";
  const bothOff = !props.googleOn && !props.webOn;
  const webSources = useMemo(() => {
    const urls = new Set<string>();
    for (const c of props.web.candidates) for (const u of c.sourceUrls) urls.add(u);
    return [...urls].map((url) => ({ url, title: null }));
  }, [props.web.candidates]);
  const anythingRunning = googleSearching || webRunning || webPending;
  const left = props.webUsage ? Math.max(0, props.webUsage.limit - props.webUsage.used) : null;
  const tradeWords = props.tradeLabel.toLowerCase();

  if (bothOff) {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-mute">
          Walkup can&rsquo;t search online right now. Add a contractor you already know, or ask your neighbours and other boards who they use.
        </p>
        <AddVendorButton initialTrade={props.trade} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Google's state */}
      {props.googleOn ? (
        <div className="space-y-2 text-[13px]">
          {googleSearching ? (
            <IndeterminateBar label={`Searching Google for ${props.phrase || tradeWords} near ${props.city ?? "your building"}`} />
          ) : googleResult?.source.state === "idle" ? (
            <p className="text-mute">
              <button type="button" onClick={searchGoogleNow} className="font-medium text-ink underline underline-offset-2">
                Search Google near your building
              </button>
            </p>
          ) : googleResult?.source.state === "no_address" ? (
            <p className="text-mute">
              Add your building&rsquo;s street address in Building Info to search nearby.{" "}
              <Link href="/building" className={linkClass}>
                Open Building Info
              </Link>
            </p>
          ) : googleResult?.source.state === "quota" ? (
            <p className="text-mute">
              You&rsquo;ve used today&rsquo;s Google searches. Results from earlier today still show; new searches work again tomorrow.
            </p>
          ) : googleResult?.source.state === "error" ? (
            <p className="text-bad-text">
              {googleResult.source.message}{" "}
              <button type="button" onClick={searchGoogleAgain} className="font-medium text-ink underline underline-offset-2">
                Try again
              </button>
            </p>
          ) : googleResult?.source.state === "ok" && googleResult.source.cached ? (
            <p className="text-[12px] text-mute">
              Google results from {cachedLine(googleResult.source.fetchedAt, props.todayIso)}.{" "}
              <button type="button" onClick={searchGoogleAgain} className="font-medium text-ink underline underline-offset-2">
                Search again
              </button>
            </p>
          ) : null}
        </div>
      ) : null}

      {/* The web search's state */}
      {props.webOn ? (
        <div className="space-y-2 text-[13px]">
          {webRunning ? (
            <PollWhileRunning
              running
              startedAt={web.startedAt}
              label={`Searching the web for ${tradeWords} contractors near ${props.city ?? "your building"}`}
              onRetry={() => startWebSearch({ trade: props.trade, phrase: props.phrase, wants: props.wants, refresh: true })}
            />
          ) : webError ? (
            <div className="space-y-2">
              <p className={webError.quota ? "text-mute" : errorClass}>{webError.message}</p>
              {!webError.quota ? (
                <button type="button" onClick={() => runWeb(false)} disabled={webPending} className={btnSecondary}>
                  {webPending ? "Starting…" : "Try again"}
                </button>
              ) : null}
            </div>
          ) : web.state === "idle" ? (
            <div className="space-y-1">
              <button type="button" onClick={() => runWeb(false)} disabled={webPending || left === 0} className={btnSecondary}>
                {webPending ? "Starting…" : "Search the web too (about a minute)"}
              </button>
              {props.webUsage ? (
                <p className="text-[12px] text-mute">
                  {left === 0
                    ? "No web searches left today. They reset at midnight."
                    : `${props.webUsage.used} of ${props.webUsage.limit} web searches used today`}
                </p>
              ) : null}
            </div>
          ) : web.state === "quota" ? (
            <p className="text-mute">Your building has reached today&rsquo;s limit for contractor searches. It resets at midnight.</p>
          ) : web.state === "error" ? (
            <div className="space-y-2">
              <p className={errorClass}>{web.message}</p>
              {props.webRetry ? (
                <button type="button" onClick={() => runWeb(true)} disabled={webPending} className={btnSecondary}>
                  {webPending ? "Starting…" : "Try again"}
                </button>
              ) : null}
            </div>
          ) : web.state === "ok" ? (
            <p className="text-[12px] text-mute">
              Web results from {cachedLine(web.fetchedAt, props.todayIso)}.{" "}
              <button type="button" onClick={() => runWeb(true)} disabled={webPending} className="font-medium text-ink underline underline-offset-2">
                {webPending ? "Starting…" : "Search again"}
              </button>
            </p>
          ) : null}
          {web.state === "ok" && (web.dropped ?? 0) > 0 ? (
            <p className="text-[12px] text-mute">
              {web.dropped === 1
                ? "1 more result was left out because its details couldn't be confirmed from the sources."
                : `${web.dropped} more results were left out because their details couldn't be confirmed from the sources.`}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* The merged list */}
      {ranked.length > 0 ? (
        <ul className="divide-y divide-line">
          {ranked.map((c) => (
            <FoundCard key={c.candidateId} c={c} trade={props.trade} forTicket={ticket !== null} />
          ))}
        </ul>
      ) : !anythingRunning ? (
        web.state === "ok" && (googleResult === null || googleResult.candidates.length === 0) ? (
          <div className="space-y-3">
            <p className="text-[13px] text-mute">Nothing turned up that Walkup could check against a source.</p>
            <AddVendorButton initialTrade={props.trade} />
          </div>
        ) : googleResult?.source.state === "ok" ? (
          <div className="space-y-3">
            <p className="text-[13px] text-mute">Nothing found within about 15 miles. Try a broader kind of work, or add someone you know.</p>
            <AddVendorButton initialTrade={props.trade} />
          </div>
        ) : null
      ) : null}

      {props.web.candidates.length > 0 && web.state !== "running" ? (
        <FoundOnWeb
          sources={webSources}
          fetchedAt={props.web.candidates[0].ratingAsOf}
          scope="list"
          ratingsFromWebOnly={!props.googleOn}
          onSearchAgain={() => runWeb(true)}
        />
      ) : null}

      <div className="space-y-2 border-t border-line pt-3">
        <p className="text-[11px] text-mute">
          Found by searching Google and the web, not checked by Walkup. Ratings are as the named site listed them on that date. Ask for a
          certificate of insurance and check their license before any work starts.
        </p>
        <AddVendorButton initialTrade={props.trade} label="Save someone you already know" variant="link" />
      </div>
    </div>
  );
}

function FoundCard({ c, trade, forTicket }: { c: FoundCandidate & { why: Why[] }; trade: string; forTicket: boolean }) {
  const router = useRouter();
  const { found, toggleFound, askFor } = useFind();
  const [pending, start] = useTransition();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ message: string; existingVendorId?: string; nameTaken: boolean } | null>(null);
  const [linked, setLinked] = useState(false);

  const already = c.alreadySaved;
  const doNotUse = already?.status === "do_not_use";
  const inList = savedId ?? (already && !doNotUse && !already.archived ? already.vendorId : null);
  const sources = c.kind === "web" ? c.sourceUrls : [];

  function save(thenAsk: boolean) {
    setProblem(null);
    start(async () => {
      const r = await saveCandidate(c.candidateId, trade);
      if (r.ok) {
        setSavedId(r.vendorId);
        if (thenAsk) askFor([r.vendorId]);
        else router.refresh();
      } else {
        setProblem({ message: r.message, existingVendorId: r.existingVendorId, nameTaken: r.reason === "name_taken" });
      }
    });
  }

  return (
    <li className="flex gap-2 py-4">
      {!doNotUse && !inList ? (
        <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            className="h-5 w-5"
            aria-label={`Select ${c.name}`}
            checked={found.has(c.candidateId)}
            onChange={(e) => toggleFound(c.candidateId, c.name, e.target.checked)}
          />
        </label>
      ) : (
        <span className="w-11 shrink-0" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-[15px] font-medium text-ink">{c.name}</p>
        <div className="flex flex-wrap gap-1">
          {c.why.map((w) => (
            <Pill key={w.key} tone={WHY_TONE[w.tone]}>
              {w.text}
            </Pill>
          ))}
        </div>
        {c.address ? <p className="text-[13px] text-mute">{c.address}</p> : c.cityText ? <p className="text-[13px] text-mute">Based in {c.cityText}</p> : null}
        {c.snippet && c.kind === "web" ? (
          <p className="text-[13px] text-mute">
            From {hostOf(c.website ?? sources[0] ?? "")}: &ldquo;{c.snippet}&rdquo;
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          {c.phone ? (
            <a href={telHref(c.phone)} className={btnLink}>
              Call {c.phone}
            </a>
          ) : null}
          {c.email ? (
            <a href={mailtoLink(c.email)} className={btnLink}>
              {c.email}
            </a>
          ) : null}
          {!c.phone && !c.email && c.kind === "web" ? <span className="text-mute">See their website for contact details</span> : null}
          {c.website ? (
            <a href={safeHttpUrl(c.website) ?? undefined} target="_blank" rel="noopener noreferrer nofollow" className={btnLink}>
              Website
            </a>
          ) : null}
          {c.placeId ? (
            <a href={googleMapsUrl(c.placeId)} target="_blank" rel="noopener noreferrer" className={btnLink}>
              See on Google
            </a>
          ) : null}
          {sources.map((u) => (
            <a key={u} href={u} target="_blank" rel="noopener noreferrer nofollow" className={btnLink}>
              Source: {hostOf(u)}
            </a>
          ))}
        </div>

        {doNotUse ? null : already?.archived && !savedId ? (
          <ArchivedMatch vendorId={already.vendorId} onRestored={() => setSavedId(already.vendorId)} />
        ) : inList ? (
          <p className="text-[13px]">
            <Link href={`/contractors/${inList}`} className={linkClass}>
              In your list
            </Link>
          </p>
        ) : problem?.nameTaken ? (
          <div className="space-y-2 text-[13px]">
            <p className="text-ink">{problem.message}</p>
            {problem.existingVendorId ? (
              <div className="flex flex-wrap gap-2">
                {linked ? (
                  <span className="inline-flex min-h-[44px] items-center text-good-text">Linked.</span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    className={btnSecondary}
                    onClick={() =>
                      start(async () => {
                        const r = await linkCandidate(c.candidateId, problem.existingVendorId!);
                        if (r.ok) {
                          setLinked(true);
                          router.refresh();
                        } else setProblem({ ...problem, message: r.message });
                      })
                    }
                  >
                    {pending ? "Linking…" : "Link to them"}
                  </button>
                )}
                <Link href={`/contractors/${problem.existingVendorId}`} className={btnSecondary}>
                  View them
                </Link>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => save(false)} className={btnSecondary}>
              {pending ? "Saving…" : "Save to contractors"}
            </button>
            {forTicket ? (
              <button type="button" disabled={pending} onClick={() => save(true)} className={btnPrimary}>
                Save and ask for a quote
              </button>
            ) : null}
          </div>
        )}
        {problem && !problem.nameTaken ? <p className={errorClass}>{problem.message}</p> : null}
      </div>
    </li>
  );
}

function ArchivedMatch({ vendorId, onRestored }: { vendorId: string; onRestored: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3 text-[13px]">
      <Link href={`/contractors/${vendorId}`} className={linkClass}>
        In your list (archived)
      </Link>
      <button
        type="button"
        disabled={pending}
        className={btnSecondary}
        onClick={() =>
          start(async () => {
            const r = await restoreContractor(vendorId);
            if ("error" in r) setError(r.error);
            else {
              onRestored();
              router.refresh();
            }
          })
        }
      >
        {pending ? "Restoring…" : "Restore"}
      </button>
      {error ? <span className={errorClass}>{error}</span> : null}
    </div>
  );
}
