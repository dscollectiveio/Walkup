"use client";

import { useActionState, useMemo, useState } from "react";
import {
  FIELD_DEFS,
  GROUP_LABEL,
  parseFieldValue,
  policyWarnings,
  type Candidate,
  type FieldDef,
  type FieldGroup,
  type ResolvedField,
} from "@/lib/insurance/declarations";
import { savePolicyFromReview, saveQuoteFromReview } from "../../actions";

type Source = "extracted" | "manual" | "quote";
interface Meta {
  source: Source;
  page: number | null;
  confidence: number | null;
  snippet: string | null;
}

const inputClass = "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink";

function sourceLabel(meta: Meta | undefined, value: string, mode: "policy" | "quote"): string | null {
  if (!value || !meta) return null;
  if (meta.source === "quote") return "From the quote";
  if (meta.source === "extracted") {
    const doc = mode === "quote" ? "the quote" : "your policy";
    return meta.page ? `From ${doc}, page ${meta.page}` : `From ${doc}`;
  }
  return "Entered by you";
}

function FieldInput({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `f_${def.key}`;
  if (def.kind === "enum") {
    return (
      <select id={id} name={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        <option value="">{def.required ? "Choose…" : "Not stated"}</option>
        {def.options!.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }
  if (def.kind === "boolean") {
    return (
      <select id={id} name={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        <option value="">Not stated</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  return (
    <input
      id={id}
      name={id}
      type={def.kind === "date" ? "date" : "text"}
      inputMode={def.kind === "money" ? "decimal" : undefined}
      placeholder={def.kind === "money" ? "Not stated" : ""}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${def.kind === "money" ? "figures " : ""}${inputClass}`}
    />
  );
}

export function ReviewForm({
  mode,
  documentId,
  requestId,
  acceptedQuoteId,
  resolved,
  initialSource,
  legalName,
  replaceable,
  deductiblesPage,
}: {
  mode: "policy" | "quote";
  documentId: string | null;
  requestId: string | null;
  acceptedQuoteId: string | null;
  resolved: ResolvedField[];
  /** "quote" when starting a policy from a chosen quote. */
  initialSource: Source;
  legalName: string | null;
  replaceable: { id: string; label: string; coverage: string }[];
  deductiblesPage: number | null;
}) {
  const [state, action, pending] = useActionState(mode === "quote" ? saveQuoteFromReview : savePolicyFromReview, null);
  const byKey = useMemo(() => new Map(resolved.map((r) => [r.key, r])), [resolved]);

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELD_DEFS.map((d) => [d.key, byKey.get(d.key)?.status === "high" ? (byKey.get(d.key)!.value ?? "") : ""])),
  );
  const [meta, setMeta] = useState<Record<string, Meta>>(() =>
    Object.fromEntries(
      resolved
        .filter((r) => r.status === "high")
        .map((r) => [r.key, { source: initialSource, page: r.page, confidence: r.confidence, snippet: r.snippet }]),
    ),
  );
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [reminderDays, setReminderDays] = useState(60);

  const set = (key: string, v: string, m?: Meta) => {
    setValues((s) => ({ ...s, [key]: v }));
    setMeta((s) => ({ ...s, [key]: m ?? { source: "manual", page: null, confidence: null, snippet: null } }));
  };

  const confirmCandidate = (def: FieldDef, c: Candidate, r: ResolvedField) => {
    const parsed = parseFieldValue(def, c.value);
    set(def.key, parsed ?? c.value, { source: initialSource, page: c.page, confidence: r.confidence, snippet: c.snippet });
    setConfirmed((s) => new Set(s).add(def.key));
  };

  const warnings = policyWarnings({
    values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v || null])),
    legalName: mode === "policy" ? legalName : null,
    renewalReminderDays: reminderDays,
    today: new Date(new Date().toDateString()),
    deductiblesPage,
  });
  const pendingReview = resolved.filter((r) => r.status === "review" && !confirmed.has(r.key) && !values[r.key]);
  const coverage = values.policy_type;
  const sameType = replaceable.filter((p) => p.coverage === coverage);

  return (
    <form action={action} className="space-y-6">
      {documentId ? <input type="hidden" name="document_id" value={documentId} /> : null}
      {requestId ? <input type="hidden" name="request_id" value={requestId} /> : null}
      {acceptedQuoteId ? <input type="hidden" name="accepted_quote_id" value={acceptedQuoteId} /> : null}
      {FIELD_DEFS.map((d) => (
        <input key={d.key} type="hidden" name={`m_${d.key}`} value={JSON.stringify(meta[d.key] ?? null)} />
      ))}

      {pendingReview.length > 0 ? (
        <p className="rounded-lg border border-warning-line bg-warning-tint px-4 py-3 text-[13px] text-warning-text">
          {pendingReview.length} field{pendingReview.length === 1 ? " needs" : "s need"} a quick look — highlighted below.
          Nothing is saved until you click {mode === "quote" ? "Save quote" : "Save policy"}.
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {warnings.map((w) => (
            <li key={w.key} className="rounded-full border border-warning-line bg-warning-tint px-3 py-1 text-[12px] text-warning-text">
              {w.text}
            </li>
          ))}
        </ul>
      ) : null}

      {(Object.keys(GROUP_LABEL) as FieldGroup[]).map((group) => (
        <section key={group} className="rounded-xl border border-line bg-paper">
          <h2 className="border-b border-line px-5 py-3 font-bold tracking-tight text-ink">{GROUP_LABEL[group]}</h2>
          <div className="grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2">
            {FIELD_DEFS.filter((d) => d.group === group).map((def) => {
              const r = byKey.get(def.key);
              const needsLook = r?.status === "review" && !confirmed.has(def.key) && !values[def.key];
              const label = sourceLabel(meta[def.key], values[def.key], mode);
              return (
                <div key={def.key} className={needsLook ? "-m-2 rounded-lg bg-warning-tint p-2" : undefined}>
                  <label htmlFor={`f_${def.key}`} className="block text-[12px] font-medium text-ink">
                    {def.label}
                    {def.required ? <span className="ml-1 text-bad-text">*</span> : null}
                  </label>
                  <FieldInput def={def} value={values[def.key]} onChange={(v) => set(def.key, v)} />
                  {label ? <p className="mt-1 text-[11px] text-mute-soft">{label}</p> : null}
                  {def.help ? <p className="mt-1 text-[11px] text-mute">{def.help}</p> : null}
                  {needsLook && r ? (
                    <div className="mt-2 space-y-1.5 text-[12px]">
                      <p className="font-medium text-warning-text">Is this right? {r.reason}</p>
                      {r.candidates.map((c, i) => (
                        <div key={i} className="rounded-md border border-warning-line bg-paper px-2.5 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="figures text-ink">{c.value}</span>
                            <button
                              type="button"
                              onClick={() => confirmCandidate(def, c, r)}
                              className="min-h-[32px] rounded-md bg-ink px-2.5 text-[11px] font-medium text-paper hover:bg-ink-mid"
                            >
                              Use this
                            </button>
                          </div>
                          <p className="mt-1 text-[11px] text-mute">
                            {c.page ? `Page ${c.page}: ` : ""}“{c.snippet}”
                          </p>
                        </div>
                      ))}
                      <p className="text-mute">Or type the right value above, or leave it blank.</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <section className="rounded-xl border border-line bg-paper px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === "policy" ? (
            <div>
              <label htmlFor="renewal_reminder_days" className="block text-[12px] font-medium text-ink">
                Remind the board to get quotes this many days before renewal
              </label>
              <input
                id="renewal_reminder_days"
                name="renewal_reminder_days"
                type="number"
                min={0}
                max={365}
                value={reminderDays}
                onChange={(e) => setReminderDays(Number(e.target.value) || 0)}
                className={`figures ${inputClass}`}
              />
            </div>
          ) : (
            <div>
              <label htmlFor="valid_until" className="block text-[12px] font-medium text-ink">
                Quote valid until <span className="font-normal text-mute-soft">optional</span>
              </label>
              <input id="valid_until" name="valid_until" type="date" className={inputClass} />
            </div>
          )}
          {mode === "policy" && sameType.length > 0 ? (
            <div>
              <label htmlFor="replaces_policy_id" className="block text-[12px] font-medium text-ink">
                This replaces
              </label>
              <select id="replaces_policy_id" name="replaces_policy_id" defaultValue={sameType[0].id} className={inputClass}>
                <option value="">Nothing — it&rsquo;s an additional policy</option>
                {sameType.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <label htmlFor="notes" className="block text-[12px] font-medium text-ink">
              Notes <span className="font-normal text-mute-soft">optional</span>
            </label>
            <textarea id="notes" name="notes" rows={2} className={inputClass} />
          </div>
        </div>
      </section>

      {state?.error ? (
        <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">{state.error}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-[44px] rounded-md bg-ink px-5 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Saving…" : mode === "quote" ? "Save quote" : "Save policy"}
      </button>
    </form>
  );
}
