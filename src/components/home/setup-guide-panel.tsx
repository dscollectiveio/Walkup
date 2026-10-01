"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Check, ChevronRight, Maximize2, X } from "lucide-react";
import type { SetupSection, SetupStep } from "@/lib/home/setup-guide";
import { dismissSetupGuide } from "@/app/home-actions";

function formatDone(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function sectionCounts(section: SetupSection): { done: number; total: number } {
  const steps = section.steps.filter((s) => !s.informational);
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}

function StepRow({ step, active }: { step: SetupStep; active: boolean }) {
  return (
    <li className={`py-3 ${active ? "-mx-5 bg-fill px-5" : ""}`}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
            step.done ? "border-moss bg-moss text-paper" : "border-line-strong bg-paper"
          }`}
        >
          {step.done ? <Check size={11} strokeWidth={2.5} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[13px] ${step.done ? "text-mute" : "font-medium text-ink"}`}>
            {step.name}
          </span>
          <span className="mt-0.5 block text-[11px] text-mute-soft">{step.detail}</span>
        </span>
        {step.done ? (
          <span className="shrink-0 rounded-full border border-good-line bg-good-tint px-2 py-0.5 text-[11px] text-good-text">
            Done{step.doneOn ? ` ${formatDone(step.doneOn)}` : ""}
          </span>
        ) : step.informational ? (
          <span className="shrink-0 text-[11px] text-mute-soft">automatic</span>
        ) : (
          <Link
            href={step.href}
            aria-label={`Open ${step.name}`}
            className="shrink-0 text-mute-soft hover:text-ink"
          >
            <ChevronRight size={15} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        )}
      </div>
      {active && step.instructions.length > 0 ? (
        <div className="mt-2 pl-7">
          <ol className="list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-ink">
            {step.instructions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <Link
            href={step.href}
            className="mt-2 inline-block rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid"
          >
            Go there →
          </Link>
        </div>
      ) : null}
    </li>
  );
}

function DetailedStep({ step, isNext }: { step: SetupStep; isNext: boolean }) {
  return (
    <li className={`rounded-lg border p-4 ${isNext ? "border-brass bg-fill" : "border-line bg-paper"}`}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
            step.done ? "border-moss bg-moss text-paper" : "border-line-strong bg-paper"
          }`}
        >
          {step.done ? <Check size={11} strokeWidth={2.5} /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[14px] ${step.done ? "text-mute" : "font-medium text-ink"}`}>{step.name}</span>
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
          <p className="mt-1 text-[12px] text-mute">{step.detail}</p>
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

/**
 * The first thing a new board admin sees. Every step ticks itself from real
 * rows (see setup-guide.ts) — nothing here is checked off by hand. The one
 * thing that's remembered is "Skip for now", which hides the guide for the
 * whole association until a step is fixed by hand in the database.
 */
export function SetupGuidePanel({
  sections,
  activeStepKey,
  done,
  total,
}: {
  sections: SetupSection[];
  activeStepKey: string | null;
  done: number;
  total: number;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <>
    <section className="flex max-h-[34rem] flex-col rounded-xl border border-brass bg-paper lg:max-h-none lg:min-h-[34rem]">
      <header className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-bold tracking-tight text-ink">Set up your building</h2>
            <p className="mt-0.5 text-[12px] text-mute">In order — each section builds on the last.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="tabular text-[12px] text-mute">
              {done} of {total} done
            </span>
            <button
              type="button"
              onClick={() => dialogRef.current?.showModal()}
              aria-label="Expand the setup guide"
              title="See every step in detail"
              className="flex h-7 w-7 items-center justify-center rounded-md text-mute hover:bg-fill hover:text-ink"
            >
              <Maximize2 size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
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
              className="text-[12px] text-mute underline-offset-2 hover:underline disabled:opacity-50"
            >
              {pending ? "Hiding…" : "Skip for now"}
            </button>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-fill">
          <div className="h-full rounded-full bg-moss transition-all" style={{ width: `${pct}%` }} />
        </div>
        {error ? <p className="mt-2 text-[12px] text-bad-text">{error}</p> : null}
      </header>

      {/* On desktop the list is absolutely positioned so it never sets the row's
          height — the row is as tall as the taller card (min 34rem) and this scrolls. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto lg:overflow-visible">
      <div className="divide-y divide-line lg:absolute lg:inset-0 lg:overflow-y-auto">
        {sections.map((section, i) => {
          const counts = sectionCounts(section);
          const complete = counts.done === counts.total;
          const isCollapsed = collapsed[section.key] ?? complete;
          return (
            <div key={section.key} className="px-5 py-4">
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [section.key]: !isCollapsed }))}
                aria-expanded={!isCollapsed}
                className="flex w-full items-baseline justify-between gap-3 text-left"
              >
                <span>
                  <span className="text-[10px] font-medium uppercase tracking-[0.07em] text-section-label">
                    Step {i + 1}
                  </span>
                  <span className="block text-[15px] font-bold tracking-tight text-ink">{section.title}</span>
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
                  <p className="mt-1 text-[12px] text-mute">{section.blurb}</p>
                  <ul className="mt-2 divide-y divide-line">
                    {section.steps.map((step) => (
                      <StepRow key={step.key} step={step} active={step.key === activeStepKey} />
                    ))}
                  </ul>
                </>
              )}
            </div>
          );
        })}
      </div>
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
                Every step, what it takes, and where to do it. Steps tick themselves as the records appear — there&rsquo;s
                nothing to check off by hand.
              </p>
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-mute hover:bg-fill hover:text-ink"
            >
              <X size={16} strokeWidth={1.75} aria-hidden="true" />
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
            return (
              <section key={section.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-medium uppercase tracking-[0.07em] text-section-label">
                      Step {i + 1}
                    </span>
                    <h3 className="text-[17px] font-bold tracking-tight text-ink">{section.title}</h3>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                      counts.done === counts.total
                        ? "border border-good-line bg-good-tint text-good-text"
                        : "bg-fill text-mute"
                    }`}
                  >
                    {counts.done} of {counts.total}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-mute">{section.blurb}</p>
                <ul className="mt-3 grid gap-3 md:grid-cols-2">
                  {section.steps.map((step) => (
                    <DetailedStep key={step.key} step={step} isNext={step.key === activeStepKey} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </dialog>
    </>
  );
}
