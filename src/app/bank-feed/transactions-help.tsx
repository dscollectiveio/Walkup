"use client";

import { useRef } from "react";
import { CircleHelp, X } from "lucide-react";

const STEPS: { title: string; body: string }[] = [
  {
    title: "Start with what's waiting",
    body: "The list opens on “Needs category”. “N to go” at the top counts down and the bar beside it fills as you work.",
  },
  {
    title: "Click the recommended category",
    body: "One click files the row and posts it to the books. “Save for later” files it without posting; the Post button at the top posts everything saved. A filled chip is how you filed that payee before; an outlined one is a guess. “+3 more” means the other transactions from the same payee go with it.",
  },
  {
    title: "Pick one yourself when needed",
    body: "No recommendation, or it’s wrong? Click the row and start typing — Utilities, Dues, Transfer, Not for the books — then pick from the list and Save & post.",
  },
  {
    title: "Do many at once",
    body: "“Post all N recommended” posts every recommendation your own history backs. Or tick the boxes on the left: a bar appears at the bottom of the screen to file them all together.",
  },
  {
    title: "Undo any time",
    body: "Posting is what updates the budget, dues balances and financial statements. Every post shows Undo for 10 seconds, and a posted row always has “Undo posting”.",
  },
];

const KEYBOARD = "Keyboard: j/k move · Enter posts · c categorizes · x marks not for the books · Esc closes.";

/** "How this works" for the Transactions card — a short, plain walkthrough in a dialog. */
export function TransactionsHelp() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        aria-label="How to categorize transactions"
        title="How this works"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-ondark-mute transition-colors hover:bg-ink-mid hover:text-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
      >
        <CircleHelp size={16} strokeWidth={1.6} aria-hidden="true" />
        <span className="hidden sm:inline">How this works</span>
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="transactions-help-title"
        onClick={(e) => {
          // Clicking the dimmed backdrop closes it.
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-paper p-0 text-ink shadow-xl backdrop:bg-ink/40"
      >
        <header className="flex items-start justify-between gap-4 rounded-t-xl bg-ink px-5 py-4">
          <div>
            <h2 id="transactions-help-title" className="font-bold tracking-tight text-paper">
              How to categorize transactions
            </h2>
            <p className="mt-0.5 text-[12px] text-ondark-mute">About 10 minutes for a typical month.</p>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close"
            className="rounded-md p-1 text-ondark-mute hover:bg-ink-mid hover:text-paper"
          >
            <X size={16} strokeWidth={1.6} aria-hidden="true" />
          </button>
        </header>

        <ol className="space-y-4 px-5 py-5">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="figures flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brass text-[12px] text-paper"
              >
                {i + 1}
              </span>
              <div>
                <div className="text-[13px] font-bold text-ink">{step.title}</div>
                <p className="mt-0.5 text-[13px] leading-relaxed text-mute">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
          <p className="text-[12px] text-mute">{KEYBOARD}</p>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid"
          >
            Got it
          </button>
        </footer>
      </dialog>
    </>
  );
}
