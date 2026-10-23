"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Maximize2, X } from "lucide-react";
import type { SetupSection, SetupStep } from "@/lib/home/setup-guide";
import { dismissSetupGuide, setSetupStepOverride } from "@/app/home-actions";
import { ShowHide } from "./fold-section";

/** A board member sees the guide but only an admin ticks, overrides or skips it. */
const ReadOnlyContext = createContext(false);

function formatDone(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function sectionCounts(section: SetupSection): { done: number; total: number } {
  const steps = section.steps.filter((s) => !s.informational);
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}

/** A thin bar for a group of steps: navy while anything is left, green once all are done. Never red. */
function GroupBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const complete = total > 0 && done === total;
  return (
    <span
      role="progressbar"
      aria-label="Progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="hidden h-2 w-28 shrink-0 overflow-hidden rounded-full border border-line bg-paper sm:block"
    >
      <span
        className={`block h-full rounded-full motion-safe:transition-[width] ${complete ? "bg-good" : "bg-ink"}`}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

/** The right-hand button on a step: the words and the arrow together. The step to do next is filled navy. */
function GoButton({ href, label, primary }: { href: string; label: string; primary: boolean }) {
  return (
    <Link
      href={href}
      aria-label={`Open ${label}`}
      className={`inline-flex min-h-[32px] shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-3 text-[12px] font-medium transition-colors ${
        primary ? "bg-ink text-paper hover:bg-ink-mid" : "border border-line-strong bg-paper text-ink hover:bg-fill"
      }`}
    >
      Go there
      <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
    </Link>
  );
}

/**
 * The step's check box, clickable by a board admin. It ticks a step by hand,
 * unticks one that ticked itself, or (on a step already changed by hand)
 * returns it to following the data. The data never changes; only the guide's
 * view of it does.
 */
function StepCheck({ step, className = "" }: { step: SetupStep; className?: string }) {
  const readOnly = useContext(ReadOnlyContext);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const auto = step.autoDone ?? step.done;
  const label = step.overridden
    ? `${step.done ? "Marked done" : "Marked not done"} by hand. Click to go back to automatic.`
    : step.done
      ? "Done. Click to mark not done."
      : "Click to mark done.";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={step.done}
      aria-label={`${step.name}: ${label}`}
      title={failed ? "Couldn't save that. Try again." : label}
      disabled={pending || readOnly}
      onClick={(e) => {
        e.stopPropagation();
        const want = !step.done;
        const mode = want === auto ? "auto" : want ? "done" : "not_done";
        setFailed(false);
        start(async () => {
          const r = await setSetupStepOverride(step.key, mode);
          if (r.error) setFailed(true);
        });
      }}
      className={`relative flex h-4 w-4 shrink-0 items-center justify-center rounded border before:absolute before:-inset-2 before:content-[''] hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:opacity-50 ${
        step.done ? "border-moss bg-moss text-paper" : failed ? "border-bad bg-paper" : "border-line-strong bg-paper"
      } ${step.overridden ? "ring-2 ring-brass/60 ring-offset-1 ring-offset-paper" : ""} ${className}`}
    >
      {step.done ? <Check size={11} strokeWidth={2.5} aria-hidden="true" /> : null}
    </button>
  );
}

function StepRow({ step, active }: { step: SetupStep; active: boolean }) {
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <StepCheck step={step} />
        <span className="min-w-0 flex-1">
          <span className={`block text-[13px] ${step.done ? "text-mute-soft line-through" : "font-medium text-ink"}`}>
            {step.name}
          </span>
          <span className="mt-0.5 block text-[11px] text-mute-soft">
            {step.detail}
            {step.overridden ? <span className="ml-1.5 font-medium text-warning-text">· Marked by hand</span> : null}
          </span>
        </span>
        {step.done ? (
          <span className="shrink-0 rounded-full border border-good-line bg-good-tint px-2 py-0.5 text-[11px] text-good-text">
            Done{step.doneOn ? ` ${formatDone(step.doneOn)}` : ""}
          </span>
        ) : step.informational ? (
          <span className="shrink-0 text-[11px] text-mute-soft">automatic</span>
        ) : (
          <GoButton href={step.href} label={step.name} primary={active} />
        )}
      </div>
      {active && step.instructions.length > 0 ? (
        <div className="mt-2 pl-7">
          <ol className="list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-ink">
            {step.instructions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </li>
  );
}

function DetailedStep({ step, isNext }: { step: SetupStep; isNext: boolean }) {
  return (
    <li className={`rounded-lg border p-4 ${isNext ? "border-brass bg-paper" : "border-line bg-paper"}`}>
      <div className="flex items-start gap-3">
        <StepCheck step={step} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[14px] ${step.done ? "text-mute-soft line-through" : "font-medium text-ink"}`}>{step.name}</span>
            {isNext ? (
              <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-medium text-paper">Do this next</span>
            ) : null}
            {step.done ? (
              <span className="rounded-full border border-good-line bg-good-tint px-2 py-0.5 text-[11px] text-good-text">
                Done{step.doneOn ? ` ${formatDone(step.doneOn)}` : ""}
              </span>
            ) : step.informational ? (
              <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] text-mute">Happens automatically</span>
            ) : null}
          </div>
          <p className="mt-1 text-[12px] text-mute">
            {step.detail}
            {step.overridden ? <span className="ml-1.5 font-medium text-warning-text">· Marked by hand</span> : null}
          </p>
          {!step.done && step.instructions.length > 0 ? (
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-ink">
              {step.instructions.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          ) : null}
          {!step.done && !step.informational ? (
            <Link
              href={step.href}
              className="mt-3 inline-block rounded-md border border-line-strong bg-paper px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-fill"
            >
              Go there →
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Optional extras: informational steps a person chooses to do. "Financial statements" ticks on its own, so it stays in its section. */
function isOptional(step: SetupStep): boolean {
  return step.informational === true && step.key !== "statements";
}

/** "Import your units and owners (optional)" reads as "Import your units and owners" under the Optional heading. */
function optionalName(name: string): string {
  return name.replace(/\s*\(optional\)\s*$/i, "");
}

/** A boxed chevron, so a section header reads as something you can open or close. */
function FoldChevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-line-strong bg-paper text-ink"
    >
      <ChevronDown size={15} strokeWidth={2.2} className={`motion-safe:transition-transform ${open ? "" : "-rotate-90"}`} />
    </span>
  );
}

function OptionalRow({ step }: { step: SetupStep }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <StepCheck step={step} />
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] ${step.done ? "text-mute-soft line-through" : "text-ink"}`}>{optionalName(step.name)}</span>
        <span className="mt-0.5 block text-[11px] text-mute-soft">
          {step.detail}
          {step.overridden ? <span className="ml-1.5 font-medium text-warning-text">· Marked by hand</span> : null}
        </span>
      </span>
      {step.done ? (
        <span className="shrink-0 rounded-full border border-good-line bg-good-tint px-2 py-0.5 text-[11px] text-good-text">Done</span>
      ) : (
        <GoButton href={step.href} label={optionalName(step.name)} primary={false} />
      )}
    </li>
  );
}

/**
 * "Set up your building", the lower part of the Dashboard's to-do card. Every
 * step ticks itself from real rows (see setup-guide.ts); nothing here is
 * checked off by hand. The progress counts only the required steps; the optional
 * extras sit in their own group at the bottom and never hold it back.
 * "Skip for now" hides the guide for the whole association.
 */
export function SetupGuidePanel({
  sections,
  activeStepKey,
  done,
  total,
  readOnly = false,
  notices = null,
}: {
  sections: SetupSection[];
  activeStepKey: string | null;
  done: number;
  total: number;
  readOnly?: boolean;
  /** The urgent notices, shown right under the header. */
  notices?: ReactNode;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // null = not touched yet: open until every optional extra is done.
  const [optionalFolded, setOptionalFolded] = useState<boolean | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  // Whether the steps run past the bottom of the box: a fade and a "More steps below" button say so.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [sections, collapsed, optionalFolded]);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const optional = sections.flatMap((sec) => sec.steps.filter(isOptional));
  const optionalDone = optional.filter((st) => st.done).length;
  const optionalIsFolded = optionalFolded ?? (optional.length > 0 && optionalDone === optional.length);

  return (
    <ReadOnlyContext.Provider value={readOnly}>
    <section id="setup-guide" aria-labelledby="setup-guide-title" className="flex min-h-0 flex-1 scroll-mt-20 flex-col">
      <header className="flex shrink-0 flex-col gap-2.5 rounded-t-[7px] band bg-ink px-5 py-3">
        <div className="flex min-h-[2.5rem] items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="setup-guide-title" className="eyebrow text-paper">
            Set up your building
          </h2>
          <p className="mt-0.5 text-[12px] text-ondark-mute">
            <span className="figures font-semibold text-paper">{pct}%</span> done · {done} of {total} steps
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => dialogRef.current?.showModal()}
            aria-label="Expand the setup guide"
            title="See every step in detail"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ondark-mute hover:bg-paper/10 hover:text-paper"
          >
            <Maximize2 size={14} strokeWidth={1.6} aria-hidden="true" />
          </button>
          {readOnly ? null : (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const result = await dismissSetupGuide();
                  if (result.error) setError(result.error);
                })
              }
              className="text-[12px] font-normal text-ondark-mute underline-offset-2 hover:text-paper hover:underline disabled:opacity-50"
            >
              {pending ? "Hiding…" : "Skip for now"}
            </button>
          )}
        </div>
        </div>
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-2 overflow-hidden rounded-full bg-paper/15"
        >
          <div className="h-full rounded-full bg-brass motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${pct}%` }} />
        </div>
      </header>

      {notices}

      {error ? <p className="shrink-0 border-b border-line px-5 py-2 text-[12px] text-bad-text">{error}</p> : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        id="setup-guide-body"
        ref={bodyRef}
        className="max-h-[22rem] min-h-0 flex-1 divide-y divide-line overflow-y-auto lg:max-h-none"
      >
        {sections.map((section, i) => {
          const counts = sectionCounts(section);
          const complete = counts.done === counts.total;
          // A manual open/close only holds while the step stays in the same state: the moment it
          // becomes complete (or is reopened by new work) the default applies again, so a finished
          // step closes itself. The person can still open it.
          const foldKey = `${section.key}:${complete ? "done" : "open"}`;
          const isCollapsed = collapsed[foldKey] ?? complete;
          const steps = section.steps.filter((st) => !isOptional(st));
          return (
            <div key={section.key}>
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [foldKey]: !isCollapsed }))}
                aria-expanded={!isCollapsed}
                className="sticky top-0 z-10 flex w-full items-center gap-3 border-b border-line bg-fill px-5 py-1.5 text-left hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brass"
              >
                <FoldChevron open={!isCollapsed} />
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.07em] text-section-label">
                    Step {i + 1}
                  </span>
                  <span className="truncate text-[14px] font-bold tracking-tight text-ink">{section.title}</span>
                </span>
                <GroupBar done={counts.done} total={counts.total} />
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                    complete ? "border border-good-line bg-good-tint text-good-text" : "border border-line bg-paper text-mute"
                  }`}
                >
                  {counts.done} of {counts.total}
                </span>
                <ShowHide shown={!isCollapsed} />
              </button>
              {isCollapsed ? null : (
                <div className="px-5 pb-3 pt-2">
                  <p className="text-[12px] text-mute">{section.blurb}</p>
                  <ul className="mt-1 divide-y divide-line">
                    {steps.map((step) => (
                      <StepRow key={step.key} step={step} active={step.key === activeStepKey} />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}

        {optional.length > 0 ? (
          <div>
            <button
              type="button"
              onClick={() => setOptionalFolded((f) => !(f ?? optionalDone === optional.length))}
              aria-expanded={!optionalIsFolded}
              aria-controls="setup-optional-body"
              className="sticky top-0 z-10 flex w-full items-center gap-3 border-b border-line bg-fill px-5 py-1.5 text-left hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brass"
            >
              <FoldChevron open={!optionalIsFolded} />
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.07em] text-section-label">When you want</span>
                <span className="truncate text-[14px] font-bold tracking-tight text-ink">Optional</span>
              </span>
              <GroupBar done={optionalDone} total={optional.length} />
              <span className="shrink-0 rounded-full border border-line bg-paper px-2 py-0.5 text-[11px] text-mute">
                {optionalDone} of {optional.length}
              </span>
              <ShowHide shown={!optionalIsFolded} />
            </button>
            <ul id="setup-optional-body" hidden={optionalIsFolded} className="divide-y divide-line px-5 pb-1">
              {optional.map((step) => (
                <OptionalRow key={step.key} step={step} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {moreBelow ? (
        <>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-paper via-paper/80 to-transparent" />
          <button
            type="button"
            onClick={() => bodyRef.current?.scrollBy({ top: bodyRef.current.clientHeight * 0.8, behavior: "smooth" })}
            className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink px-3 py-1 text-[11px] font-medium text-paper shadow-md hover:bg-ink-mid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass"
          >
            More steps below
            <ChevronDown size={13} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </>
      ) : null}
      </div>
    </section>

    {/* Native <dialog>: showModal() gives Esc-to-close, a focus trap and a backdrop. */}
    <dialog
      ref={dialogRef}
      aria-labelledby="setup-guide-detail-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) dialogRef.current?.close();
      }}
      className="m-auto max-h-[calc(100vh-3rem)] w-[min(60rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/50"
    >
      <div className="flex max-h-[calc(100vh-3rem)] flex-col">
        <header className="border-b border-line px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="setup-guide-detail-title" className="text-[20px] font-bold tracking-tight text-ink">
                Set up your building
              </h2>
              <p className="mt-1 text-[13px] text-mute">
                Every step, what it takes, and where to do it. Steps tick themselves as the records appear, so there&rsquo;s
                nothing to check off by hand.
              </p>
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-mute hover:bg-fill hover:text-ink"
            >
              <X size={16} strokeWidth={1.6} aria-hidden="true" />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
              <div className="h-full rounded-full bg-moss" style={{ width: `${pct}%` }} />
            </div>
            <span className="tabular shrink-0 text-[12px] text-mute">
              {done} of {total} done
            </span>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
          {sections.map((section, i) => {
            const counts = sectionCounts(section);
            const complete = counts.done === counts.total;
            // Same rule as the card: a finished step closes itself, and can be opened again.
            const foldKey = `detail:${section.key}:${complete ? "done" : "open"}`;
            const isCollapsed = collapsed[foldKey] ?? complete;
            return (
              <section key={section.key}>
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [foldKey]: !isCollapsed }))}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-baseline justify-between gap-3 text-left"
                >
                  <span className="flex items-baseline gap-2">
                    <FoldChevron open={!isCollapsed} />
                    <span>
                      <span className="block text-[10px] font-medium uppercase tracking-[0.07em] text-section-label">
                        Step {i + 1}
                      </span>
                      <span className="block text-[17px] font-bold tracking-tight text-ink">{section.title}</span>
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                      complete ? "border border-good-line bg-good-tint text-good-text" : "bg-fill text-mute"
                    }`}
                  >
                    {counts.done} of {counts.total}
                  </span>
                </button>
                {isCollapsed ? null : (
                  <>
                    <p className="mt-1 text-[13px] text-mute">{section.blurb}</p>
                    <ul className="mt-3 grid gap-3 md:grid-cols-2">
                      {section.steps.map((step) => (
                        <DetailedStep key={step.key} step={step} isNext={step.key === activeStepKey} />
                      ))}
                    </ul>
                  </>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </dialog>
    </ReadOnlyContext.Provider>
  );
}
