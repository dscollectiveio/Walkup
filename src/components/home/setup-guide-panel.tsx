"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, ChevronRight } from "lucide-react";
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
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <section className="flex max-h-[34rem] flex-col rounded-xl border border-brass bg-paper">
      <header className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-black tracking-tight text-ink">Set up your building</h2>
            <p className="mt-0.5 text-[12px] text-mute">In order — each section builds on the last.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="tabular text-[12px] text-mute">
              {done} of {total} done
            </span>
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

      <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
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
                  <span className="block text-[15px] font-black tracking-tight text-ink">{section.title}</span>
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
    </section>
  );
}
