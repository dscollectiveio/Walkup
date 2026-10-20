"use client";

import { useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";

/**
 * Things worth knowing about Walkup, one at a time, on the sign-in panel.
 * Each is true of the app as it ships today. No em dashes.
 */
const TIPS: { title: string; body: string }[] = [
  {
    title: "Every suggested category comes with its reason",
    body: "In Bank Feed, open a transaction to see why Walkup suggested its category. Approve it in one click, and undo it any time.",
  },
  {
    title: "Compare months, quarters or years side by side",
    body: "On Financial Statements, pick several periods at once, then download a PDF or email it to owners straight from the page.",
  },
  {
    title: "Nothing is emailed until a board admin approves it",
    body: "Reminders and statements are prepared for you to review, and go out only when a board admin presses Send. Messages to contractors and agents open as drafts in your own mail app.",
  },
  {
    title: "Replay the tour whenever you like",
    body: "Choose Help at the top right, then Take the tour, for a quick walk around the sidebar.",
  },
  {
    title: "Press [ and ] to resize the sidebar",
    body: "[ shrinks the sidebar to icons for more room, and ] brings the labels back. It remembers your choice.",
  },
  {
    title: "The Tax Center lists every deadline",
    body: "It links to the current official forms and puts each due date on your calendar, so April isn't a surprise.",
  },
  {
    title: "Upload a policy and Walkup reads it",
    body: "Drop an insurance declarations page into Insurance and the key limits and dates are filled in for you to check.",
  },
  {
    title: "Files you upload are searchable",
    body: "In Documents, Walkup files each upload and reads its text, so a search for a name or amount finds it.",
  },
  {
    title: "Anyone in the building can report a problem",
    body: "Owners can report repairs from Repairs & Upkeep, so nothing depends on one person's inbox.",
  },
];

const ROTATE_MS = 9000;

export function UsageTip() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % TIPS.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [paused]);

  const tip = TIPS[i];
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
      </p>
      <div key={i} className="mt-2 min-h-[5.5rem] animate-[tip-in_400ms_ease-out_both] motion-reduce:animate-none">
        <h3 className="text-[14px] font-semibold text-white">{tip.title}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-white/75">{tip.body}</p>
      </div>
      <div className="mt-2 flex gap-1.5" role="group" aria-label="Choose a tip">
        {TIPS.map((t, n) => (
          <button
            key={t.title}
            type="button"
            onClick={() => setI(n)}
            aria-label={`Tip ${n + 1} of ${TIPS.length}`}
            aria-current={n === i ? "true" : undefined}
            className="flex h-6 w-4 items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
          >
            <span className={`h-1.5 rounded-full transition-all ${n === i ? "w-4 bg-brass" : "w-1.5 bg-white/30"}`} />
          </button>
        ))}
      </div>
    </section>
  );
}
