"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { SEARCHABLE_TRADES, tradeLabel } from "@/lib/contractors/trades";
import { saveFromSearch, searchContractors, type SearchResponse } from "./vendor-actions";
import { AddVendorButton } from "./vendor-form";

function plural(label: string): string {
  const l = label.toLowerCase();
  return l.endsWith("s") ? l : `${l} contractors`;
}

function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span aria-hidden="true" className="text-brass">
      {"★".repeat(full)}
      <span className="text-line-strong">{"★".repeat(5 - full)}</span>
    </span>
  );
}

/**
 * Find a contractor: one trade picker, one search. Every call goes through a
 * server action — the Google key never touches the browser.
 */
export function FindPanel({ initialTrade }: { initialTrade: string | null }) {
  const [trade, setTrade] = useState(initialTrade ?? "");
  const [searchedTrade, setSearchedTrade] = useState<string | null>(null);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();

  const search = () =>
    startSearch(async () => {
      setSaveError(null);
      setSearchedTrade(trade);
      setResponse(await searchContractors(trade));
    });

  const searchingLabel = trade ? `Looking for ${plural(tradeLabel(trade))} near your building…` : "Searching…";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="find-trade" className="block text-[12px] font-medium text-ink">What kind of work?</label>
          <select
            id="find-trade"
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            className="mt-1 min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 text-[13px] text-ink"
          >
            <option value="">Choose…</option>
            {SEARCHABLE_TRADES.map((t) => (
              <option key={t.slug} value={t.slug}>{t.label}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={!trade || searching}
          onClick={search}
          className="min-h-[44px] rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
        >
          Search
        </button>
      </div>

      {searching ? <p className="text-[13px] text-mute">{searchingLabel}</p> : null}

      {!searching && response && !response.ok ? (
        <div className="rounded-lg border border-line bg-fill px-4 py-3 text-[13px] text-ink">
          <p>{response.message}</p>
          {response.reason === "no_address" ? (
            <Link href="/building" className="mt-1 inline-block font-medium underline underline-offset-2">
              Add the address in Building Info →
            </Link>
          ) : response.reason === "google_down" ? (
            <div className="mt-3">
              <AddVendorButton initialTrade={searchedTrade} />
            </div>
          ) : null}
        </div>
      ) : null}

      {!searching && response?.ok && response.results.length === 0 && searchedTrade ? (
        <div className="space-y-3 rounded-lg border border-line bg-fill px-4 py-3 text-[13px] text-ink">
          <p>
            No {plural(tradeLabel(searchedTrade))} found within 10 miles. Try a different trade, or add one manually.
          </p>
          <AddVendorButton initialTrade={searchedTrade} />
        </div>
      ) : null}

      {!searching && response?.ok && response.results.length > 0 && searchedTrade ? (
        <>
          {saveError ? <p className="text-[12px] text-bad-text">{saveError}</p> : null}
          <ul className="grid gap-3 md:grid-cols-2">
            {response.results.map((r) => {
              const savedId = saved[r.placeId] ?? r.savedVendorId;
              return (
                <li key={r.placeId} className="flex flex-col justify-between gap-3 rounded-xl border border-line bg-paper p-4">
                  <div>
                    <div className="font-medium text-ink">{r.name}</div>
                    <div className="mt-1 text-[12px] text-mute">
                      {r.rating !== null ? (
                        <>
                          Google rating <span className="figures text-ink">{r.rating.toFixed(1)}</span> <Stars rating={r.rating} />
                          {r.reviewCount !== null ? ` (${r.reviewCount.toLocaleString("en-US")} reviews)` : ""}
                        </>
                      ) : (
                        "No Google rating yet"
                      )}
                      {r.distanceMiles !== null ? ` · ${r.distanceMiles} mi away` : ""}
                    </div>
                    {r.address ? <div className="mt-0.5 text-[12px] text-mute-soft">{r.address}</div> : null}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                      {r.phone ? (
                        <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} className="font-medium text-ink underline underline-offset-2">
                          {r.phone}
                        </a>
                      ) : null}
                      {r.website ? (
                        <a href={r.website} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
                          Website
                        </a>
                      ) : null}
                      <a
                        href={`https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(r.placeId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ink underline underline-offset-2"
                      >
                        See on Google
                      </a>
                    </div>
                  </div>
                  {savedId ? (
                    <Link
                      href={`/contractors/${savedId}`}
                      className="inline-flex min-h-[44px] w-fit items-center rounded-md border border-good-line bg-good-tint px-4 text-[13px] font-medium text-good-text"
                    >
                      {saved[r.placeId] ? "Saved" : "Already in your list"}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        startSave(async () => {
                          setSaveError(null);
                          const res = await saveFromSearch(searchedTrade, r.placeId);
                          if (res.ok) setSaved((s) => ({ ...s, [r.placeId]: res.vendorId }));
                          else setSaveError(res.message);
                        })
                      }
                      className="min-h-[44px] w-fit rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
                    >
                      Save to contractors
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-mute">
            Ratings and details come from Google. Walkup doesn&rsquo;t verify licenses or insurance.
          </p>
        </>
      ) : null}
    </div>
  );
}
