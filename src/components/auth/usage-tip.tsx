"use client";

import { useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, Lightbulb } from "lucide-react";
import { tipSet, TIP_SET_COUNT, type UsageTip } from "@/lib/auth/usage-tips";

/**
 * "Did you know?" on the sign-in panel: five tips per page load, one at a time, each with a loading bar that fills
 * as its turn runs out, and arrows to move by hand. The set changes on every load (the next of six, remembered in
 * this browser), so a person who signs in now and then sees all thirty over a few visits.
 *
 * The bar is a CSS animation, and its end moves to the next tip, so holding the pointer or focus on the panel
 * pauses both together. With reduced motion there is no bar and no automatic change: the arrows still work.
 */

const ROTATE_MS = 10_000;
const STORAGE_KEY = "walkup.tipset";

let chosen: UsageTip[] | null = null;

/** This load's set: the one after the one shown last time, or a random one when the browser won't remember. */
function pickSet(): UsageTip[] {
  let next = Math.floor(Math.random() * TIP_SET_COUNT);
  try {
    const last = Number(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isInteger(last) && window.localStorage.getItem(STORAGE_KEY) !== null) next = (last + 1) % TIP_SET_COUNT;
    window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // storage blocked: the random set stands
  }
  return tipSet(next);
}

const subscribe = () => () => {};
const clientSet = () => (chosen ??= pickSet());
const serverSet = (): UsageTip[] | null => null;

export function UsageTip() {
  // Null on the server and during hydration, so the page never disagrees with itself; the set arrives right after.
  const tips = useSyncExternalStore(subscribe, clientSet, serverSet);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );

  const count = tips?.length ?? 0;
  const go = (n: number) => setI(((n % count) + count) % count);
  const tip = tips?.[i] ?? null;

  const arrow =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/20 text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";

  return (
    <section
      aria-label="Did you know"
      className="mt-8 rounded-xl border border-white/15 bg-white/5 p-4"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-brass">
        <Lightbulb size={14} strokeWidth={1.8} aria-hidden="true" />
        Did you know?
        {tip ? <span className="ml-auto font-normal normal-case tracking-normal text-white/50">{i + 1} of {count}</span> : null}
      </p>
      <div key={i} className="mt-2 min-h-[5.5rem] animate-[tip-in_400ms_ease-out_both] motion-reduce:animate-none" aria-live="off">
        {tip ? (
          <>
            <h3 className="text-[14px] font-semibold text-white">{tip.title}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-white/75">{tip.body}</p>
          </>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" onClick={() => go(i - 1)} disabled={!tip} aria-label="Previous tip" className={arrow}>
          <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <div
          role="progressbar"
          aria-label="Time until the next tip"
          aria-hidden={reduced ? "true" : undefined}
          className="h-1 flex-1 overflow-hidden rounded-full bg-white/15"
        >
          {tip && !reduced ? (
            <div
              key={`${i}`}
              className="h-full origin-left rounded-full bg-brass/70"
              style={{
                animation: `tip-progress ${ROTATE_MS}ms linear forwards`,
                animationPlayState: paused ? "paused" : "running",
              }}
              onAnimationEnd={() => go(i + 1)}
            />
          ) : null}
        </div>
        <button type="button" onClick={() => go(i + 1)} disabled={!tip} aria-label="Next tip" className={arrow}>
          <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
