"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { COVERAGE_TYPES } from "@/lib/insurance/coverage";
import {
  DECLARATION_COVERAGE_FORMS, FACT_LABEL, FLOOD_ZONES, REPLACEMENT_COST_SOURCES, REQUIRED_LINE_VALUES,
  type BuildingFacts, type FactKey,
} from "@/lib/insurance/facts";
import { formatMoney, formatPercent } from "@/lib/insurance/format";
import { saveBuildingFacts } from "../facts-actions";
import { QUESTION_KEYS } from "./questions";
import { btnGhost, btnPrimary, errorBlock, helpClass, inputClass, labelClass } from "../components/styles";
import { Toast } from "../components/toast";
import { NavySection } from "@/components/navy-section";

/**
 * The building facts form (insurance-spec §9.8). Yes / no / not sure are
 * radio groups with 44 px targets. The form lists the questions it shows in
 * `_keys`, so a question left unanswered clears only itself. With `only`, it
 * shows just those questions, one per screen on a phone.
 */

type YesNo = "yes" | "no" | "unsure";

const SHARED = "Shared with agencies only when you ask for quotes.";

const SECTIONS: { title: string; questions: string[] }[] = [
  { title: "What kind of association", questions: ["is_condominium"] },
  { title: "Rebuilding cost", questions: ["replacement_cost_estimate", "replacement_cost_as_of", "replacement_cost_source"] },
  {
    title: "The building",
    questions: [
      "building_count", "total_square_feet", "flood_zone", "has_below_grade_units", "has_basement", "has_boiler", "has_elevator",
      "has_sprinklers", "has_amenities", "has_commercial_space",
    ],
  },
  { title: "People and money", questions: ["has_employees", "uses_volunteers", "manager_handles_funds", "rental_share"] },
  {
    title: "Your declaration",
    questions: ["declaration_coverage_form", "declaration_required_lines", "declaration_insurance_section", "declaration_notes", "owners_must_carry_ho6"],
  },
];

function yn(v: boolean | null | undefined): YesNo | "" {
  return v === true ? "yes" : v === false ? "no" : "";
}

export function FactsForm({
  facts,
  only,
  guesses,
  canEdit,
  illinois,
}: {
  facts: BuildingFacts;
  /** Question keys to show (`?only=`), or null for the whole form. */
  only: string[] | null;
  guesses: Partial<Record<"has_boiler" | "has_elevator" | "has_sprinklers", string>>;
  canEdit: boolean;
  illinois: boolean;
}) {
  const [state, action, pending] = useActionState(saveBuildingFacts, null);
  const [stamp, setStamp] = useState(0);
  const [prev, setPrev] = useState(state);
  if (state !== prev) {
    setPrev(state);
    if (state && "ok" in state) setStamp((n) => n + 1);
  }

  const [yes, setYes] = useState<Record<string, YesNo | "">>(() => ({
    is_condominium: facts.is_condominium ? "yes" : "no",
    has_below_grade_units: yn(facts.has_below_grade_units),
    has_basement: yn(facts.has_basement),
    has_boiler: yn(facts.has_boiler) || (guesses.has_boiler ? "yes" : ""),
    has_elevator: yn(facts.has_elevator) || (guesses.has_elevator ? "yes" : ""),
    has_sprinklers: yn(facts.has_sprinklers) || (guesses.has_sprinklers ? "yes" : ""),
    has_amenities: yn(facts.has_amenities),
    has_commercial_space: yn(facts.has_commercial_space),
    has_employees: yn(facts.has_employees),
    uses_volunteers: yn(facts.uses_volunteers),
    manager_handles_funds: yn(facts.manager_handles_funds),
    owners_must_carry_ho6: yn(facts.owners_must_carry_ho6),
  }));
  const [guessed, setGuessed] = useState(new Set(Object.keys(guesses).filter((k) => !yn(facts[k as FactKey] as boolean | null))));

  const questions = only ?? SECTIONS.flatMap((s) => s.questions);
  const [step, setStep] = useState(0);
  const oneByOne = only !== null && questions.length > 1;
  const keys = [...new Set(questions.flatMap((q) => QUESTION_KEYS[q] ?? []))];

  const radio = (q: string, opts: { v: YesNo; l: string }[] = [
    { v: "yes", l: "Yes" },
    { v: "no", l: "No" },
    { v: "unsure", l: "Not sure" },
  ]) => (
    <fieldset>
      <legend className={labelClass}>{FACT_LABEL[q as FactKey]}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {opts.map((o) => (
          <label
            key={o.v}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-paper px-3 text-[13px] text-ink has-[:checked]:border-ink"
          >
            <input
              type="radio"
              name={q}
              value={o.v}
              checked={yes[q] === o.v}
              onChange={() => {
                setYes((s) => ({ ...s, [q]: o.v }));
                setGuessed((g) => {
                  const n = new Set(g);
                  n.delete(q);
                  return n;
                });
              }}
            />
            {o.l}
          </label>
        ))}
      </div>
      {guessed.has(q) && guesses[q as keyof typeof guesses] ? (
        <p className="mt-1 text-[12px] text-warning-text">
          Walkup guessed this from your upkeep list (&ldquo;{guesses[q as keyof typeof guesses]}&rdquo;). Confirm.
        </p>
      ) : null}
    </fieldset>
  );

  const text = (key: FactKey, opts: { defaultValue: string; inputMode?: "decimal" | "numeric"; prefix?: string; suffix?: string; type?: string; help?: string }) => (
    <div>
      <label htmlFor={`fact-${key}`} className={labelClass}>
        {FACT_LABEL[key]}
      </label>
      <div className="relative mt-1">
        {opts.prefix ? (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[13px] text-mute">
            {opts.prefix}
          </span>
        ) : null}
        <input
          id={`fact-${key}`}
          name={key}
          type={opts.type ?? "text"}
          inputMode={opts.inputMode}
          defaultValue={opts.defaultValue}
          aria-describedby={opts.help ? `fact-${key}-help` : undefined}
          className={`${inputClass.replace("mt-1 ", "")} ${opts.prefix ? "pl-7" : ""} ${opts.suffix ? "pr-8" : ""} ${opts.inputMode ? "figures" : ""}`}
        />
        {opts.suffix ? (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-mute">
            {opts.suffix}
          </span>
        ) : null}
      </div>
      {opts.help ? (
        <p id={`fact-${key}-help`} className={helpClass}>
          {opts.help}
        </p>
      ) : null}
    </div>
  );

  const select = (key: FactKey, options: readonly { value: string; label: string }[], defaultValue: string, help?: React.ReactNode) => (
    <div>
      <label htmlFor={`fact-${key}`} className={labelClass}>
        {FACT_LABEL[key]}
      </label>
      <select id={`fact-${key}`} name={key} defaultValue={defaultValue} className={inputClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {help ? <div className={helpClass}>{help}</div> : null}
    </div>
  );

  const money = (v: string | null) => (v ? (formatMoney(v) ?? v).replace(/^\$/, "") : "");

  const question = (q: string): React.ReactNode => {
    switch (q) {
      case "is_condominium":
        return (
          <div>
            {radio(q, [
              { v: "yes", l: "Yes" },
              { v: "no", l: "No, it's a townhome or other community" },
              { v: "unsure", l: "Not sure" },
            ])}
            {illinois ? <p className={helpClass}>Illinois condo law applies to condominiums. Other communities follow a different act.</p> : null}
          </div>
        );
      case "replacement_cost_estimate":
        return text("replacement_cost_estimate", {
          defaultValue: money(facts.replacement_cost_estimate),
          inputMode: "decimal",
          prefix: "$",
          help: "This isn't the market value. It's what it would cost to rebuild. Your insurer's last valuation is a good source.",
        });
      case "replacement_cost_as_of":
        return text("replacement_cost_as_of", { defaultValue: facts.replacement_cost_as_of ?? "", type: "date" });
      case "replacement_cost_source":
        return select("replacement_cost_source", REPLACEMENT_COST_SOURCES, facts.replacement_cost_source ?? "unknown");
      case "building_count":
        return text("building_count", { defaultValue: facts.building_count?.toString() ?? "", inputMode: "numeric" });
      case "total_square_feet":
        return text("total_square_feet", { defaultValue: facts.total_square_feet?.toString() ?? "", inputMode: "numeric", help: SHARED });
      case "flood_zone":
        return select(
          "flood_zone",
          [{ value: "", label: "Not sure" }, ...FLOOD_ZONES.filter((z) => z !== "unknown").map((z) => ({ value: z, label: `Zone ${z}` }))],
          facts.flood_zone && facts.flood_zone !== "unknown" ? facts.flood_zone : "",
          <a href="https://msc.fema.gov/portal/search" target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
            Look up your flood zone on the FEMA Flood Map Service Center
          </a>,
        );
      case "has_sprinklers":
      case "has_amenities":
        return (
          <div>
            {radio(q)}
            <p className={helpClass}>{SHARED}</p>
          </div>
        );
      case "has_employees":
        return (
          <div className="space-y-3">
            {radio(q)}
            {yes.has_employees === "yes"
              ? text("employee_count", { defaultValue: facts.employee_count?.toString() ?? "", inputMode: "numeric" })
              : null}
          </div>
        );
      case "manager_handles_funds":
        return (
          <div className="space-y-3">
            {radio(q)}
            {yes.manager_handles_funds === "yes" ? text("management_company", { defaultValue: facts.management_company ?? "" }) : null}
          </div>
        );
      case "rental_share":
        return text("rental_share", {
          defaultValue: facts.rental_share ? (formatPercent(facts.rental_share) ?? "").replace(/%$/, "") : "",
          inputMode: "decimal",
          suffix: "%",
          help: SHARED,
        });
      case "declaration_coverage_form":
        return select("declaration_coverage_form", DECLARATION_COVERAGE_FORMS, facts.declaration_coverage_form ?? "unknown");
      case "declaration_required_lines":
        return (
          <fieldset>
            <legend className={labelClass}>{FACT_LABEL.declaration_required_lines}</legend>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {REQUIRED_LINE_VALUES.map((v) => (
                <label key={v} className="inline-flex min-h-[44px] items-center gap-2 text-[13px] text-ink">
                  <input type="checkbox" name="declaration_required_lines" value={v} defaultChecked={facts.declaration_required_lines.includes(v)} />
                  {COVERAGE_TYPES.find((c) => c.value === v)?.label ?? v}
                </label>
              ))}
            </div>
          </fieldset>
        );
      case "declaration_insurance_section":
        return text("declaration_insurance_section", { defaultValue: facts.declaration_insurance_section ?? "", help: "For example Article VIII." });
      case "declaration_notes":
        return (
          <div>
            <label htmlFor="fact-declaration_notes" className={labelClass}>
              {FACT_LABEL.declaration_notes}
            </label>
            <textarea id="fact-declaration_notes" name="declaration_notes" rows={3} defaultValue={facts.declaration_notes ?? ""} className={inputClass} />
          </div>
        );
      case "owners_must_carry_ho6":
        return (
          <div className="space-y-3">
            {radio(q)}
            {yes.owners_must_carry_ho6 === "yes"
              ? text("owners_ho6_min_liability", { defaultValue: money(facts.owners_ho6_min_liability), inputMode: "decimal", prefix: "$" })
              : null}
          </div>
        );
      default:
        return radio(q);
    }
  };

  const error = state && "error" in state ? state.error : null;
  const last = step >= questions.length - 1;

  return (
    <form
      className="space-y-6 pb-4"
      onSubmit={(e) => {
        // Dispatched by hand so a refused answer doesn't reset what was typed.
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
    >
      <input type="hidden" name="_keys" value={keys.join(",")} />
      <fieldset disabled={!canEdit || pending} className="space-y-6">
        {only ? (
          <section className="space-y-5 rounded-xl border border-line bg-paper px-5 py-4">
            {oneByOne ? (
              <p className="text-[12px] text-mute sm:hidden">
                Question {step + 1} of {questions.length}
              </p>
            ) : null}
            {questions.map((q, i) => (
              <div key={q} className={oneByOne && i !== step ? "max-sm:hidden" : undefined}>
                {question(q)}
              </div>
            ))}
          </section>
        ) : (
          SECTIONS.map((s) => (
            <NavySection key={s.title} title={s.title} bodyClassName="space-y-5">
              {s.questions.map((q) => (
                <div key={q}>{question(q)}</div>
              ))}
            </NavySection>
          ))
        )}
      </fieldset>

      {error ? <p className={errorBlock}>{error}</p> : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {oneByOne ? (
            <div className="flex w-full gap-2 sm:hidden">
              {step > 0 ? (
                <button type="button" className={btnGhost} onClick={() => setStep((s) => s - 1)}>
                  Back
                </button>
              ) : null}
              {!last ? (
                <button type="button" className={`${btnPrimary} flex-1`} onClick={() => setStep((s) => s + 1)}>
                  Next
                </button>
              ) : (
                <button type="submit" className={`${btnPrimary} flex-1`} disabled={pending}>
                  {pending ? "Saving…" : "Save answers"}
                </button>
              )}
            </div>
          ) : null}
          <button type="submit" className={`${btnPrimary} ${oneByOne ? "max-sm:hidden" : ""}`} disabled={pending}>
            {pending ? "Saving…" : only ? "Save answers" : "Save facts"}
          </button>
          {only ? (
            <Link href="/insurance?open=check#coverage-check" className={`${btnGhost} ${oneByOne ? "max-sm:hidden" : ""}`}>
              Back to the coverage check
            </Link>
          ) : null}
        </div>
      ) : null}
      <Toast message={stamp ? "Saved. The coverage check is updated." : null} stamp={stamp} />
    </form>
  );
}
