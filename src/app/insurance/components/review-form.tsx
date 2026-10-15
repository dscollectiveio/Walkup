"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AiWritten } from "@/components/ai/ai-written";
import {
  COVERAGE_TYPES, OPTIONAL_SECTIONS, SECTION_LABEL, coverageLabel, coverageShort, isCoverageType, sectionsFor,
  type CoverageType, type SectionKey,
} from "@/lib/insurance/coverage";
import { parseFieldValue, parseMoneyLoose, type ResolvedField } from "@/lib/insurance/declarations";
import { FIELD_BY_KEY, fieldsFor, type FieldDef } from "@/lib/insurance/fields";
import { centsOrNull, formatMoney, longDate } from "@/lib/insurance/format";
import { premiumSchedule } from "@/lib/insurance/premium";
import { daysBetween } from "@/lib/insurance/status";
import type { FieldMeta } from "@/lib/insurance/save-input";
import { fromCents } from "@/lib/money/cents";
import { savePolicy } from "../policy-actions";
import { saveQuote } from "../quote-actions";
import { FieldGrid, FieldInput, fromInput, toInput } from "./field-input";
import { ListEditor } from "./list-editor";
import { OpenFileButton, type ProvenanceInfo } from "./provenance";
import type { EndorsementRow, ExclusionRow, PremiumLineRow, ReviewFormProps } from "./review-types";
import { SectionToggles } from "./section-toggles";
import { btnGhost, btnPrimary, errorBlock, helpClass, infoBlock, inputClass, labelClass, linkClass, warningBlock } from "./styles";
import { Toast } from "./toast";

/**
 * ReviewForm v2 (insurance-spec §9.3.4): one form for import review, manual
 * entry, edit, start-from-a-quote, copy-last-term and quotes. Nothing is
 * saved until Save; a client token makes a double submit harmless.
 */

const FREQUENCY_WORDS: Record<string, string> = {
  annual: "once a year",
  semiannual: "twice a year",
  quarterly: "every quarter",
  monthly: "every month",
};

const isRequired = (d: FieldDef) => d.required === "both" || d.required === "policy";

function sectionTitle(group: string): string {
  return SECTION_LABEL[group as keyof typeof SECTION_LABEL] ?? group;
}

/** A DB string as words for "Walkup read …; saved value …". */
function displayDb(def: FieldDef, value: string): string {
  const shown = toInput(def, value);
  if (def.kind === "money") return `$${shown}`;
  if (def.kind === "percent") return `${shown}%`;
  if (def.kind === "date") return longDate(value);
  if (def.kind === "boolean") return value === "true" ? "Yes" : "No";
  if (def.kind === "enum") return def.options?.find((o) => o.value === value)?.label ?? value;
  return shown;
}

function normName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function ReviewForm(props: ReviewFormProps) {
  const router = useRouter();
  const { mode, intent, todayIso } = props;
  const isQuote = mode === "quote";
  const isEdit = intent === "edit";
  const resolvedByKey = useMemo(() => new Map<string, ResolvedField>(props.resolved.map((r) => [r.key, r])), [props.resolved]);

  // One token per form, created once (§8.2 step 9).
  const clientToken = useRef<string | null>(null);
  if (clientToken.current === null) clientToken.current = crypto.randomUUID();

  const [coverage, setCoverage] = useState<CoverageType>(props.coverage);
  const [included, setIncluded] = useState<SectionKey[]>(
    props.includedSections.filter((s) => (OPTIONAL_SECTIONS[props.coverage] ?? []).includes(s)),
  );
  const initialValues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of props.resolved) {
      const def = FIELD_BY_KEY.get(r.key);
      if (!def) continue;
      out[r.key] = r.value !== null ? toInput(def, r.value) : "";
    }
    return out;
  }, [props.resolved]);
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [meta, setMeta] = useState<Record<string, FieldMeta>>(props.initialMeta);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [changed, setChanged] = useState<Set<string>>(new Set());

  const [endorsements, setEndorsements] = useState<EndorsementRow[]>(props.lists.endorsements);
  const [exclusions, setExclusions] = useState<ExclusionRow[]>(props.lists.exclusions);
  const [premiumLines, setPremiumLines] = useState<PremiumLineRow[]>(props.lists.premiumBreakdown);

  // The reminder lead time starts from the policy this one replaces, when the
  // form picks one by the 45-day rule (§9.3.4 item 7).
  const [reminderDays, setReminderDays] = useState(() => {
    if (props.defaultReplacesId || props.intent === "edit") return String(props.renewalReminderDays);
    const from = props.resolved.find((r) => r.key === "effective_on")?.value;
    const hit = from
      ? props.replaceable.find((r) => r.coverage === props.coverage && Math.abs(daysBetween(r.endsOn, from)) <= 45)
      : null;
    return String(hit?.reminderDays ?? props.renewalReminderDays);
  });
  const [reminderTouched, setReminderTouched] = useState(false);
  const [notes, setNotes] = useState(props.notes ?? "");
  const [clearLegacy, setClearLegacy] = useState(false);
  const [contactId, setContactId] = useState(props.defaultContactId ?? "");
  const [quotedOn, setQuotedOn] = useState(props.quotedOn ?? todayIso);
  const [validUntil, setValidUntil] = useState(props.validUntil ?? "");

  const sections = sectionsFor(coverage, included);
  const defs = useMemo(() => fieldsFor(coverage, sections, mode), [coverage, sections, mode]);
  const formDefs = defs.filter((d) => d.key !== "policy_type");
  const shownKeys = new Set(defs.map((d) => d.key));

  // "This replaces" (policy mode, not edit).
  const sameCoverage = props.replaceable.filter((r) => r.coverage === coverage);
  const autoReplaces = (() => {
    if (props.defaultReplacesId) return props.defaultReplacesId;
    const from = values.effective_on || initialValues.effective_on;
    if (!from) return "";
    const hit = sameCoverage.find((r) => Math.abs(daysBetween(r.endsOn, from)) <= 45);
    return hit?.id ?? "";
  })();
  const [replacesChoice, setReplacesChoice] = useState<string | null>(null);
  const replacesId = replacesChoice ?? autoReplaces;
  const replaced = props.replaceable.find((r) => r.id === replacesId) ?? null;

  // Premium bill.
  // An edit updates a bill that exists; a new policy gets one when there is an
  // insurance account or last term had a bill (§9.3.4 item 7).
  const billDefault = isEdit
    ? props.premiumBill.exists
    : props.premiumBill.exists || !!props.premiumBill.insuranceAccountId || !!replaced?.hasBill;
  const [trackChoice, setTrackChoice] = useState<boolean | null>(null);
  const track = trackChoice ?? billDefault;
  const [accountChoice, setAccountChoice] = useState<string | null>(null);
  const accountId = accountChoice ?? replaced?.billAccountId ?? props.premiumBill.insuranceAccountId ?? "";

  // What needs a look: review fields and required blanks, in form order.
  const reviewKeys = useMemo(
    () => new Set(props.resolved.filter((r) => r.status === "review").map((r) => r.key)),
    [props.resolved],
  );
  const diffs = props.readDiffs ?? {};
  const toCheck = formDefs.filter(
    (d) => reviewKeys.has(d.key) || !!diffs[d.key] || (isRequired(d) && !(initialValues[d.key] ?? "").trim() && !isEdit),
  );
  const isChecked = (key: string) => touched.has(key) || (!diffs[key] && (values[key] ?? "").trim() !== "");
  const checkedCount = toCheck.filter((d) => isChecked(d.key)).length;
  const allChecked = checkedCount === toCheck.length;
  const startsInCheck = (intent === "import" || intent === "from_quote" || Object.keys(diffs).length > 0) && toCheck.length > 0;
  const [checkMode, setCheckMode] = useState(startsInCheck);
  const [current, setCurrent] = useState(0);
  const [focused, setFocused] = useState(false);

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [alreadySavedId, setAlreadySavedId] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; carrier: string; savedOn: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; stamp: number } | null>(null);

  function setValue(key: string, v: string) {
    setValues((s) => ({ ...s, [key]: v }));
    setTouched((s) => new Set(s).add(key));
    setChanged((s) => new Set(s).add(key));
    setConfirmed((s) => {
      const n = new Set(s);
      n.delete(key);
      return n;
    });
    setMeta((m) => ({ ...m, [key]: { source: "manual", candidateIndex: null } }));
  }

  function applyCandidate(key: string, index: number, v: string) {
    setValues((s) => ({ ...s, [key]: v }));
    setTouched((s) => new Set(s).add(key));
    setChanged((s) => new Set(s).add(key));
    setConfirmed((s) => new Set(s).add(key));
    setMeta((m) => ({ ...m, [key]: { source: "extracted", candidateIndex: index } }));
  }

  function provenanceFor(key: string): ProvenanceInfo | null {
    if (!(values[key] ?? "").trim()) return null;
    const m = meta[key];
    const r = resolvedByKey.get(key);
    if (m?.source === "extracted" && r) {
      const c = r.candidates[m.candidateIndex ?? 0];
      return {
        source: confirmed.has(key) ? "confirmed" : "extracted",
        page: c?.page ?? r.page,
        snippet: c?.snippet ?? r.snippet,
      };
    }
    if (m?.source === "manual") return { source: "manual" };
    if (m?.source === "quote") return { source: "quote" };
    if (m?.source === "previous_policy") return { source: "previous_policy" };
    if (!changed.has(key) && props.storedProvenance[key]) return props.storedProvenance[key];
    return null;
  }

  // Values typed in sections that are no longer shown.
  const willClear = Object.entries(values)
    .filter(([k, v]) => v.trim() !== "" && !shownKeys.has(k) && changed.has(k))
    .map(([k]) => FIELD_BY_KEY.get(k)?.label ?? k);

  // Live warnings (§9.3.4 item 9).
  const warnings: string[] = [];
  const named = values.named_insured?.trim();
  if (named && props.legalName && normName(named) !== normName(props.legalName)) {
    warnings.push(`The named insured ("${named}") doesn't match the association's legal name on file ("${props.legalName}").`);
  }
  if (!isQuote && values.expires_on && values.expires_on < todayIso) warnings.push("This policy's end date has already passed.");
  if (coverage === "property" && (!values.coverage_form || values.coverage_form === "unknown")) {
    warnings.push("Ask your agent whether this is bare walls, single entity, or all-in. It matters for what unit owners need to cover themselves.");
  }

  // Premium breakdown sum.
  const premiumCents = centsOrNull(parseFieldValue(FIELD_BY_KEY.get("annual_premium")!, fromInput(FIELD_BY_KEY.get("annual_premium")!, values.annual_premium ?? "")));
  const lineCents = premiumLines.map((l) => centsOrNull(parseMoneyLoose(l.amount)));
  const sumCents = lineCents.every((c) => c !== null) && lineCents.length > 0 ? (lineCents as number[]).reduce((a, b) => a + b, 0) : null;

  // Premium bill preview.
  const preview = (() => {
    const premium = premiumCents !== null ? fromCents(premiumCents) : null;
    const from = values.effective_on;
    const to = values.expires_on;
    if (!premium || !from || !to || to <= from) return null;
    const s = premiumSchedule({ annual_premium: premium, payment_schedule: values.payment_schedule || "unknown", effective_from: from, effective_to: to }, todayIso);
    return `${formatMoney(s.perInstallment, { cents: true })} ${FREQUENCY_WORDS[s.frequency] ?? s.frequency}, next due ${longDate(s.nextDueOn)}`;
  })();

  function changeCoverage(next: string) {
    if (!isCoverageType(next)) return;
    setCoverage(next);
    setIncluded((inc) => inc.filter((s) => (OPTIONAL_SECTIONS[next] ?? []).includes(s)));
  }

  function listsForSave() {
    const endorsementsOut = endorsements
      .filter((e) => e.title.trim() || e.form_number.trim())
      .map((e) => ({ form_number: e.form_number.trim() || null, title: e.title.trim(), page: e.page }));
    const exclusionsOut = exclusions.filter((e) => e.title.trim()).map((e) => ({ title: e.title.trim(), page: e.page }));
    const premiumOut = premiumLines
      .filter((l) => l.label.trim() || l.amount.trim())
      .map((l) => ({ label: l.label.trim(), amount: parseMoneyLoose(l.amount) ?? l.amount.trim(), page: l.page }));
    return { endorsements: endorsementsOut, exclusions: exclusionsOut, premiumBreakdown: premiumOut };
  }

  function showErrors(r: { error: string; fieldErrors?: Record<string, string>; alreadySavedId?: string }) {
    setError(r.error);
    setFieldErrors(r.fieldErrors ?? {});
    setAlreadySavedId(r.alreadySavedId ?? null);
    const first = Object.keys(r.fieldErrors ?? {})[0];
    if (first) {
      if (checkMode && !toCheck.some((d) => d.key === first)) setCheckMode(false);
      window.setTimeout(() => {
        document.getElementById(`f-${first}-wrap`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        document.getElementById(`f-${first}`)?.focus({ preventScroll: true });
      }, 50);
    }
  }

  function afterSaved(id: string) {
    setToast((t) => ({ message: "Saved.", stamp: (t?.stamp ?? 0) + 1 }));
    if (props.returnTo) router.push(`${props.returnTo}?saved=1`);
    else router.push(isQuote ? `/insurance/quotes/${id}?saved=1` : `/insurance/policies/${id}?saved=1`);
  }

  function save(saveAsSeparate = false) {
    setError(null);
    setFieldErrors({});
    setAlreadySavedId(null);
    const sendValues: Record<string, string | null> = {};
    const sendMeta: Record<string, FieldMeta> = {};
    for (const d of formDefs) {
      const raw = fromInput(d, values[d.key] ?? "");
      sendValues[d.key] = raw === "" ? null : raw;
      if (raw !== "" && meta[d.key]) sendMeta[d.key] = meta[d.key];
    }
    const lists = listsForSave();
    start(async () => {
      if (isQuote) {
        const r = await saveQuote({
          quoteId: props.quoteId,
          clientToken: clientToken.current as string,
          coverage,
          includedSections: included,
          values: sendValues,
          meta: sendMeta,
          ...lists,
          quotedOn,
          validUntil: validUntil || null,
          contactId: contactId || null,
          quoteRequestId: props.quoteRequestId,
          notes: notes.trim() || null,
          options: {
            ...(props.documentId ? { documentId: props.documentId } : {}),
            ...(props.readId && props.readIndex !== null ? { readId: props.readId, readIndex: props.readIndex } : {}),
          },
        });
        if ("error" in r) showErrors(r);
        else afterSaved(r.quoteId);
        return;
      }
      const days = Number(reminderDays);
      const r = await savePolicy({
        policyId: props.policyId,
        clientToken: clientToken.current as string,
        coverage,
        includedSections: included,
        values: sendValues,
        meta: sendMeta,
        clearLegacy,
        ...lists,
        renewalReminderDays: Number.isFinite(days) ? days : -1,
        notes: notes.trim() || null,
        agentContactId: null,
        saveAsSeparate,
        options: {
          ...(props.documentId ? { documentId: props.documentId } : {}),
          ...(props.readId && props.readIndex !== null ? { readId: props.readId, readIndex: props.readIndex } : {}),
          ...(!isEdit ? { replacesPolicyId: replacesId || null } : {}),
          ...(props.acceptedQuoteId ? { acceptedQuoteId: props.acceptedQuoteId } : {}),
          ...(isEdit && props.expectedUpdatedAt ? { expectedUpdatedAt: props.expectedUpdatedAt } : {}),
          trackPremium: track ? { accountId: accountId || null } : null,
        },
      });
      if ("duplicateOf" in r) {
        setDuplicate(r.duplicateOf);
        return;
      }
      if ("error" in r) showErrors(r);
      else afterSaved(r.policyId);
    });
  }

  // ---------------------------------------------------------------------------
  // Rendering

  const saveLabel = isEdit ? "Save changes" : isQuote ? "Save quote" : "Save policy";
  const docName = props.documentFilename;

  const header = (() => {
    const cov = coverageLabel(coverage);
    switch (intent) {
      case "import":
        return {
          title: `Review: ${cov}`,
          blurb: `From ${docName ?? "the file"}${props.pagesLabel}. Check each figure. Anything Walkup wasn't sure of is highlighted. Nothing is saved until you press Save.`,
        };
      case "edit":
        return { title: `Edit ${coverageShort(coverage)}: ${props.carrierName ?? ""}`.trim(), blurb: null };
      case "from_quote":
        return {
          title: "Start a policy from this quote",
          blurb: `These figures come from the ${props.carrierName ?? "insurer's"} quote. Check them against the policy the insurer issues.`,
        };
      case "renew_copy":
        return {
          title: `Renew ${coverageShort(coverage)}`,
          blurb: "Last term's details are filled in. Change anything that's different, and enter the new premium.",
        };
      default:
        return {
          title: isQuote ? "Add a quote" : "Add a policy",
          blurb: "Enter what's on the declarations page. Leave anything that isn't stated blank.",
        };
    }
  })();

  const fieldNode = (d: FieldDef, opts?: { inCheck?: boolean; index?: number }) => {
    const r = resolvedByKey.get(d.key) ?? null;
    // A value Walkup assumed (a 12-month term), or a blank it asks for with no candidate (the renewal premium).
    const assumed =
      r && r.status === "review" && !touched.has(d.key) && r.reason && ((values[d.key] ?? "").trim() !== "" || r.candidates.length === 0);
    return (
      <div key={d.key} className={opts?.inCheck && opts.index !== current ? "max-sm:hidden" : undefined}>
        <FieldInput
          def={d}
          value={values[d.key] ?? ""}
          onChange={(v) => setValue(d.key, v)}
          onUse={(i, v) => applyCandidate(d.key, i, v)}
          review={r}
          provenance={provenanceFor(d.key)}
          documentId={props.documentId}
          documentName={docName}
          error={fieldErrors[d.key]}
          note={
            <>
              {assumed ? <p className="mt-1 text-[12px] text-warning-text">{r.reason}</p> : null}
              {diffs[d.key] && !touched.has(d.key) ? (
                <div className={`mt-2 space-y-2 ${warningBlock} text-[12px]`}>
                  <p>
                    Walkup read {displayDb(d, diffs[d.key].value)}; saved value {diffs[d.key].saved === null ? "none" : displayDb(d, diffs[d.key].saved as string)}.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`${btnGhost} w-full sm:w-auto`}
                      onClick={() => applyCandidate(d.key, diffs[d.key].candidateIndex, toInput(d, diffs[d.key].value))}
                    >
                      Use the new value
                    </button>
                    <button type="button" className={`${btnGhost} w-full sm:w-auto`} onClick={() => setTouched((t) => new Set(t).add(d.key))}>
                      Keep the saved value
                    </button>
                  </div>
                </div>
              ) : null}
              {d.key === "policy_number" && props.policyNumberRedacted ? (
                <p className={`mt-2 ${infoBlock} text-[12px]`}>
                  Walkup removes 9-digit numbers before saving, because they can be tax IDs. If your policy number was 9 digits, type it in.
                </p>
              ) : null}
            </>
          }
        />
        {opts?.inCheck ? (
          <div className="mt-3 flex gap-2 sm:hidden">
            {current > 0 ? (
              <button type="button" className={btnGhost} onClick={() => setCurrent((c) => Math.max(0, c - 1))}>
                Back
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const groups: { key: string; title: string; defs: FieldDef[] }[] = [];
  for (const g of ["basics", "agent", ...sections] as string[]) {
    const gd = formDefs.filter((d) => d.group === g);
    if (gd.length) groups.push({ key: g, title: sectionTitle(g), defs: gd });
  }
  const checkKeys = new Set(toCheck.map((d) => d.key));

  const sectionCard = (g: { key: string; title: string; defs: FieldDef[] }, exclude?: Set<string>) => {
    const ds = exclude ? g.defs.filter((d) => !exclude.has(d.key)) : g.defs;
    if (ds.length === 0) return null;
    return (
      <section key={g.key} className="rounded-xl border border-line bg-paper px-5 py-4">
        <h2 className="mb-3 text-[15px] font-bold tracking-tight text-ink">{g.title}</h2>
        <FieldGrid>{ds.map((d) => fieldNode(d))}</FieldGrid>
      </section>
    );
  };

  function next() {
    const key = toCheck[current]?.key;
    if (key) setTouched((s) => new Set(s).add(key));
    const nextIdx = Math.min(toCheck.length - 1, current + 1);
    setCurrent(nextIdx);
    const target = toCheck[nextIdx]?.key;
    if (target) {
      window.setTimeout(() => document.getElementById(`f-${target}-wrap`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 30);
    }
  }

  const rail = (
    <div className="space-y-4 text-[13px]">
      {toCheck.length > 0 ? (
        <div>
          <h2 className="text-[13px] font-bold text-ink">{toCheck.length - checkedCount} to check</h2>
          <ul className="mt-2 space-y-1">
            {toCheck.map((d, i) => (
              <li key={d.key}>
                <a
                  href={`#f-${d.key}-wrap`}
                  onClick={() => {
                    setCurrent(i);
                  }}
                  className={`inline-flex min-h-[32px] items-center ${isChecked(d.key) ? "text-mute line-through" : "text-ink underline underline-offset-2"}`}
                >
                  {d.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <ul className="space-y-2">
          {warnings.map((w) => (
            <li key={w} className={warningBlock}>
              {w}
            </li>
          ))}
        </ul>
      ) : null}
      {props.documentId ? (
        <div className="text-mute">
          Where this came from: <span className="text-ink">{docName ?? "the file"}</span>{" "}
          <OpenFileButton documentId={props.documentId} label="Open the file" />
        </div>
      ) : null}
    </div>
  );
  const hasRail = toCheck.length > 0 || warnings.length > 0 || !!props.documentId;

  const replacesHelp = replaced
    ? `The current policy stays active until this one starts${values.effective_on ? ` on ${longDate(values.effective_on)}` : ""}.`
    : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (checkMode && !allChecked) next();
        else save();
      }}
      onFocus={(e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      className="space-y-6 pb-28 sm:pb-0"
      noValidate
    >
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">{header.title}</h1>
        {header.blurb ? <p className="mt-1 max-w-2xl text-[13px] text-mute">{header.blurb}</p> : null}
      </div>

      {hasRail ? (
        <details className="rounded-xl border border-line bg-paper px-5 py-3 lg:hidden">
          <summary className="min-h-[44px] cursor-pointer py-2 text-[13px] font-medium text-ink">
            {toCheck.length > 0 ? `${toCheck.length - checkedCount} to check` : "About this form"}
          </summary>
          <div className="pb-3">{rail}</div>
        </details>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {props.quoteMode ? (
            <p className={infoBlock}>
              Walkup doesn&rsquo;t fill in a quote&rsquo;s figures by itself. Check each one against the quote and press Use this.
            </p>
          ) : null}

          <section className="space-y-4 rounded-xl border border-line bg-paper px-5 py-4">
            <div>
              <label htmlFor="f-policy_type" className={labelClass}>
                Kind of policy <span className="text-bad-text" aria-hidden="true">*</span>
              </label>
              <select id="f-policy_type" value={coverage} onChange={(e) => changeCoverage(e.target.value)} className={inputClass}>
                {COVERAGE_TYPES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <SectionToggles coverage={coverage} included={included} onChange={setIncluded} />
            {willClear.length > 0 ? (
              <p className={warningBlock}>Will be cleared when you save: {willClear.join(", ")}. Switch the section back on to keep them.</p>
            ) : null}
          </section>

          {isEdit && props.legacyValues.length > 0 ? (
            <section className={`${infoBlock} space-y-2`}>
              <p>These were saved with the old form and don&rsquo;t belong to this kind of policy. They aren&rsquo;t shown above.</p>
              <ul className="list-disc pl-5">
                {props.legacyValues.map((l) => (
                  <li key={l.key}>
                    {l.label}: <span className="figures">{l.value}</span>
                  </li>
                ))}
              </ul>
              <label className="inline-flex min-h-[44px] items-center gap-2">
                <input type="checkbox" checked={clearLegacy} onChange={(e) => setClearLegacy(e.target.checked)} />
                Clear these when I save
              </label>
            </section>
          ) : null}

          {checkMode ? (
            <>
              <section className="rounded-xl border border-warning-line bg-paper px-5 py-4">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-[15px] font-bold tracking-tight text-ink">
                    Check {toCheck.length} {toCheck.length === 1 ? "thing" : "things"}
                  </h2>
                  <button type="button" onClick={() => setCheckMode(false)} className={`${linkClass} min-h-[44px] text-[13px]`}>
                    Show everything
                  </button>
                </div>
                <p className="mb-3 text-[12px] text-mute sm:hidden">
                  {Math.min(current + 1, toCheck.length)} of {toCheck.length}
                </p>
                <div className="space-y-5">{toCheck.map((d, i) => fieldNode(d, { inCheck: true, index: i }))}</div>
              </section>
              <details className="rounded-xl border border-line bg-paper px-5 py-3">
                <summary className="min-h-[44px] cursor-pointer py-2 text-[13px] font-medium text-ink">
                  All details ({formDefs.length - toCheck.length})
                </summary>
                <div className="space-y-4 pb-3 pt-2">{groups.map((g) => sectionCard(g, checkKeys))}</div>
              </details>
            </>
          ) : (
            groups.map((g) => sectionCard(g))
          )}

          <section className="space-y-5 rounded-xl border border-line bg-paper px-5 py-4">
            <div>
              <h2 className="mb-3 text-[15px] font-bold tracking-tight text-ink">Endorsements</h2>
              <ListEditor<EndorsementRow>
                id="endorsement"
                rows={endorsements}
                onChange={setEndorsements}
                columns={[
                  { key: "form_number", label: "Form number", narrow: true },
                  { key: "title", label: "Title" },
                ]}
                blank={() => ({ form_number: "", title: "", page: null })}
                addLabel="Add an endorsement"
                rowLabel={(i) => `endorsement ${i + 1}`}
                renderPage={props.documentId ? (p) => <OpenFileButton documentId={props.documentId as string} page={p} /> : undefined}
              />
            </div>
            <div>
              <h2 className="mb-3 text-[15px] font-bold tracking-tight text-ink">Exclusions</h2>
              <ListEditor<ExclusionRow>
                id="exclusion"
                rows={exclusions}
                onChange={setExclusions}
                columns={[{ key: "title", label: "Title" }]}
                blank={() => ({ title: "", page: null })}
                addLabel="Add an exclusion"
                rowLabel={(i) => `exclusion ${i + 1}`}
                renderPage={props.documentId ? (p) => <OpenFileButton documentId={props.documentId as string} page={p} /> : undefined}
              />
            </div>
          </section>

          <section className="rounded-xl border border-line bg-paper px-5 py-4">
            <h2 className="mb-3 text-[15px] font-bold tracking-tight text-ink">Premium breakdown</h2>
            <ListEditor<PremiumLineRow>
              id="premium-line"
              rows={premiumLines}
              onChange={setPremiumLines}
              columns={[
                { key: "label", label: "What it's for" },
                { key: "amount", label: "Amount", narrow: true, inputMode: "decimal" },
              ]}
              blank={() => ({ label: "", amount: "", page: null })}
              addLabel="Add a line"
              rowLabel={(i) => `premium line ${i + 1}`}
              renderPage={props.documentId ? (p) => <OpenFileButton documentId={props.documentId as string} page={p} /> : undefined}
            />
            {sumCents !== null ? (
              premiumCents !== null && sumCents === premiumCents ? (
                <p className="mt-3 text-[12px] text-good-text">Adds up to {formatMoney(fromCents(sumCents), { cents: true })}</p>
              ) : (
                <p className="mt-3 text-[12px] text-warning-text">
                  Adds up to {formatMoney(fromCents(sumCents), { cents: true })}
                  {premiumCents !== null
                    ? `, which is different from the annual premium of ${formatMoney(fromCents(premiumCents), { cents: true })}`
                    : ""}
                </p>
              )
            ) : null}
          </section>

          {isQuote ? (
            <section className="space-y-4 rounded-xl border border-line bg-paper px-5 py-4">
              <h2 className="text-[15px] font-bold tracking-tight text-ink">About this quote</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="quote-from" className={labelClass}>
                    From
                  </label>
                  <select id="quote-from" value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputClass}>
                    <option value="">Someone else (from the agent details above)</option>
                    {props.contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="quote-on" className={labelClass}>
                    Quoted on
                  </label>
                  <input id="quote-on" type="date" value={quotedOn} onChange={(e) => setQuotedOn(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="quote-valid" className={labelClass}>
                    Valid until <span className="font-normal text-mute-soft">optional</span>
                  </label>
                  <input id="quote-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputClass} />
                  {fieldErrors.valid_until ? <p className="mt-1 text-[12px] text-bad-text">{fieldErrors.valid_until}</p> : null}
                </div>
              </div>
              <div>
                <label htmlFor="quote-notes" className={labelClass}>
                  Notes
                </label>
                <textarea id="quote-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
              </div>
            </section>
          ) : (
            <section className="space-y-4 rounded-xl border border-line bg-paper px-5 py-4">
              <h2 className="text-[15px] font-bold tracking-tight text-ink">After saving</h2>
              <div>
                <label htmlFor="reminder-days" className={labelClass}>
                  Remind the board to get quotes this many days before it ends
                </label>
                <input
                  id="reminder-days"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={365}
                  value={reminderDays}
                  onChange={(e) => {
                    setReminderDays(e.target.value);
                    setReminderTouched(true);
                  }}
                  className={`${inputClass} figures max-w-[10rem]`}
                />
                {fieldErrors.renewal_reminder_days ? (
                  <p className="mt-1 text-[12px] text-bad-text">{fieldErrors.renewal_reminder_days}</p>
                ) : null}
              </div>
              {!isEdit ? (
                <div>
                  <label htmlFor="replaces" className={labelClass}>
                    This replaces
                  </label>
                  <select
                    id="replaces"
                    value={replacesId}
                    onChange={(e) => {
                      setReplacesChoice(e.target.value);
                      const r = props.replaceable.find((x) => x.id === e.target.value);
                      if (r && !reminderTouched) setReminderDays(String(r.reminderDays));
                    }}
                    className={inputClass}
                  >
                    <option value="">Nothing, it&rsquo;s an additional policy</option>
                    {sameCoverage.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  {replacesHelp ? <p className={helpClass}>{replacesHelp}</p> : null}
                </div>
              ) : null}
              <div>
                <label className="inline-flex min-h-[44px] items-center gap-2 text-[13px] text-ink">
                  <input type="checkbox" checked={track} onChange={(e) => setTrackChoice(e.target.checked)} />
                  {props.premiumBill.exists ? "Update the premium bill to match" : "Track the premium as a bill"}
                </label>
                {track ? (
                  <div className="mt-2 space-y-2 pl-6">
                    <div>
                      <label htmlFor="bill-account" className={labelClass}>
                        Paid from
                      </label>
                      <select id="bill-account" value={accountId} onChange={(e) => setAccountChoice(e.target.value)} className={inputClass}>
                        <option value="">Choose…</option>
                        {props.premiumBill.accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {preview ? <p className="text-[12px] text-mute">{preview}</p> : null}
                    {replaced?.hasBill && !props.premiumBill.exists ? (
                      <p className={helpClass}>Last term&rsquo;s bill stays until its remaining payments are made. This policy gets its own bill.</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div>
                <label htmlFor="policy-notes" className={labelClass}>
                  Notes
                </label>
                <textarea id="policy-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
              </div>
            </section>
          )}

          {duplicate ? (
            <div className={`${warningBlock} space-y-2`}>
              <p>
                This looks like the {duplicate.carrier} policy you saved on {longDate(duplicate.savedOn)}.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/insurance/policies/${duplicate.id}/edit`} className={btnGhost}>
                  Update that policy instead
                </Link>
                <button type="button" className={btnGhost} disabled={pending} onClick={() => save(true)}>
                  Save as a separate policy
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className={`${errorBlock} space-y-2`} role="alert">
              <p>{error}</p>
              <div className="flex flex-wrap gap-2">
                {error.startsWith("Someone else changed") ? (
                  <button type="button" className={btnGhost} onClick={() => router.refresh()}>
                    Reload
                  </button>
                ) : null}
                {alreadySavedId ? (
                  <Link href={isQuote ? `/insurance/quotes/${alreadySavedId}` : `/insurance/policies/${alreadySavedId}`} className={btnGhost}>
                    Open it
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}

          {intent === "import" || props.readDiffs ? <AiWritten variant="reading" from={docName ?? "your document"} /> : null}

          <div
            className={`fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper px-4 pb-[env(safe-area-inset-bottom)] pt-3 sm:static sm:border-0 sm:bg-transparent sm:p-0 ${
              focused ? "max-sm:hidden" : ""
            }`}
          >
            <div className="flex items-center gap-3 pb-3 sm:pb-0">
              {checkMode && !allChecked ? (
                <button type="submit" className={`${btnPrimary} w-full sm:w-auto`} disabled={pending}>
                  {checkedCount} of {toCheck.length} checked · Next
                </button>
              ) : (
                <button type="submit" className={`${btnPrimary} w-full sm:w-auto`} disabled={pending}>
                  {pending ? "Saving…" : saveLabel}
                </button>
              )}
              {checkMode && !allChecked ? (
                <button type="button" className={`${btnGhost} hidden sm:inline-flex`} disabled={pending} onClick={() => save()}>
                  {pending ? "Saving…" : saveLabel}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {hasRail ? (
          <aside className="hidden lg:block">
            <div className="sticky top-6 rounded-xl border border-line bg-paper px-5 py-4">{rail}</div>
          </aside>
        ) : null}
      </div>
      <Toast message={toast?.message ?? null} stamp={toast?.stamp} />
    </form>
  );
}
