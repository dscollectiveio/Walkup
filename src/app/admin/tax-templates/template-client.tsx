"use client";

import { useActionState, useState, useTransition } from "react";
import { checkForUpdates, createLinkOnlyTemplate, deactivate, fetchTemplate, saveFieldMap, verifyAndActivate } from "./actions";
import { btn, inputClass, primary } from "./styles";

const FORM_OPTIONS = [
  ["irs_1120h", "Form 1120-H"],
  ["irs_1120", "Form 1120"],
  ["irs_1099_nec", "Form 1099-NEC"],
  ["irs_1096", "Form 1096"],
  ["il_1120", "Illinois IL-1120"],
  ["il_sos_annual_report", "Illinois annual report"],
] as const;

function FormCodeSelect({ id }: { id: string }) {
  return (
    <select id={id} name="form_code" required defaultValue="" className={inputClass}>
      <option value="" disabled>Choose…</option>
      {FORM_OPTIONS.map(([code, label]) => (
        <option key={code} value={code}>{label}</option>
      ))}
    </select>
  );
}

export function FetchTemplateForm() {
  const [state, action, pending] = useActionState(fetchTemplate, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor="t-form" className="block text-[12px] font-medium text-ink">Form</label>
        <FormCodeSelect id="t-form" />
      </div>
      <div>
        <label htmlFor="t-year" className="block text-[12px] font-medium text-ink">Tax year</label>
        <input id="t-year" name="tax_year" type="number" required min={2000} max={2100} className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="t-url" className="block text-[12px] font-medium text-ink">Official PDF link</label>
        <input id="t-url" name="source_url" type="url" required placeholder="https://www.irs.gov/pub/irs-pdf/f1120h.pdf" className={inputClass} />
      </div>
      <div>
        <label htmlFor="t-rev" className="block text-[12px] font-medium text-ink">
          Revision <span className="font-normal text-mute-soft">as printed on the form</span>
        </label>
        <input id="t-rev" name="revision" className={inputClass} />
      </div>
      {state?.error ? <p className="text-[12px] text-bad-text sm:col-span-2">{state.error}</p> : null}
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Fetching…" : "Fetch and list its fields"}
        </button>
      </div>
    </form>
  );
}

/** Rules only, no PDF: for the forms Walkup never fills but still dates and explains. */
export function LinkOnlyTemplateForm() {
  const [state, action, pending] = useActionState(createLinkOnlyTemplate, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor="l-form" className="block text-[12px] font-medium text-ink">Form</label>
        <FormCodeSelect id="l-form" />
      </div>
      <div>
        <label htmlFor="l-year" className="block text-[12px] font-medium text-ink">Tax year</label>
        <input id="l-year" name="tax_year" type="number" required min={2000} max={2100} className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="l-src" className="block text-[12px] font-medium text-ink">
          Official source <span className="font-normal text-mute-soft">the page the rule comes from</span>
        </label>
        <input id="l-src" name="source_url" type="url" required placeholder="https://www.ilsos.gov/departments/business-services/annual-reports.html" className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="l-inst-url" className="block text-[12px] font-medium text-ink">
          Instructions link <span className="font-normal text-mute-soft">optional; shown to boards beside the form</span>
        </label>
        <input id="l-inst-url" name="instructions_url" type="url" className={inputClass} />
      </div>
      <div>
        <label htmlFor="l-rev" className="block text-[12px] font-medium text-ink">Revision</label>
        <input id="l-rev" name="revision" placeholder="2026" className={inputClass} />
      </div>
      <div>
        <label htmlFor="l-due" className="block text-[12px] font-medium text-ink">
          Due rule <span className="font-normal text-mute-soft">e.g. INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS, DAY LAST</span>
        </label>
        <input id="l-due" name="due_rule" className={`font-mono ${inputClass}`} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="l-due-cite" className="block text-[12px] font-medium text-ink">Due rule comes from</label>
        <input id="l-due-cite" name="due_rule_citation" placeholder="805 ILCS 105/114.10" className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="l-inst" className="block text-[12px] font-medium text-ink">Where and how to file (shown to boards)</label>
        <textarea id="l-inst" name="filing_instructions" rows={3} className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="l-inst-cite" className="block text-[12px] font-medium text-ink">Those instructions come from</label>
        <input id="l-inst-cite" name="filing_citation" className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="l-notes" className="block text-[12px] font-medium text-ink">Notes</label>
        <textarea id="l-notes" name="notes" rows={2} className={inputClass} />
      </div>
      {state?.error ? <p className="text-[12px] text-bad-text sm:col-span-2">{state.error}</p> : null}
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving…" : "Save the link-only template"}
        </button>
      </div>
    </form>
  );
}

export function CheckUpdatesButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await checkForUpdates();
            if ("error" in r && r.error) {
              setMsg(r.error);
            } else if ("checked" in r) {
              const changed = r.changed ?? [];
              const failed = r.failed ?? [];
              setMsg(
                `Checked ${r.checked}. ${changed.length ? `Changed (new inactive copy to review): ${changed.join(", ")}.` : "None changed."}${failed.length ? ` Couldn't check: ${failed.join("; ")}` : ""}`,
              );
            }
          })
        }
        className={btn}
      >
        {pending ? "Checking…" : "Check active forms for updates"}
      </button>
      {msg ? <span className="text-[12px] text-mute">{msg}</span> : null}
    </span>
  );
}

export interface MapRow {
  name: string;
  type: string;
  label: string;
  section: string;
  source: string;
  rule: string;
  citation: string;
  kind: string;
  review: boolean;
  zeroOk: boolean;
  hint: string;
}

export interface TemplateMeta {
  dueRule: string;
  dueCitation: string;
  instructions: string;
  filingCitation: string;
  instructionsUrl: string;
  notes: string;
  revision: string;
  /** "4, 5, 6"; empty = every page. */
  includePages: string;
  /** One "from -> to" pair per line. */
  mirror: string;
}

export function FieldMapForm({
  id,
  kind,
  rows,
  locked,
  meta,
  keys,
}: {
  id: string;
  kind: "pdf" | "link_only";
  rows: MapRow[];
  locked: boolean;
  meta: TemplateMeta;
  keys: { setting: readonly string[]; ledger: readonly string[]; contractors: readonly string[] };
}) {
  const [state, action, pending] = useActionState(saveFieldMap, null);
  const [filter, setFilter] = useState("");
  const shown = rows.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()) || r.label.toLowerCase().includes(filter.toLowerCase()));
  const cell = "w-full rounded border border-line-strong px-2 py-1";

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="id" value={id} />
      <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="m-rev" className="block text-[12px] font-medium text-ink">Revision</label>
          <input id="m-rev" name="revision" defaultValue={meta.revision} className={inputClass} />
        </div>
        <div>
          <label htmlFor="m-due" className="block text-[12px] font-medium text-ink">
            Due rule <span className="font-normal text-mute-soft">e.g. FY_END + 4 MONTHS, DAY 15</span>
          </label>
          <input id="m-due" name="due_rule" defaultValue={meta.dueRule} className={`font-mono ${inputClass}`} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="m-due-cite" className="block text-[12px] font-medium text-ink">Due rule comes from</label>
          <input id="m-due-cite" name="due_rule_citation" defaultValue={meta.dueCitation} placeholder="Form 1120-H instructions, “When To File”" className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="m-inst" className="block text-[12px] font-medium text-ink">
            {kind === "pdf" ? "What to sign, attach, and where to mail it (cover sheet)" : "Where and how to file (shown to boards)"}
          </label>
          <textarea id="m-inst" name="filing_instructions" rows={3} defaultValue={meta.instructions} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="m-inst-cite" className="block text-[12px] font-medium text-ink">Those instructions come from</label>
          <input id="m-inst-cite" name="filing_citation" defaultValue={meta.filingCitation} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="m-inst-url" className="block text-[12px] font-medium text-ink">
            Instructions link <span className="font-normal text-mute-soft">irs.gov, tax.illinois.gov or ilsos.gov; boards see it beside the form once this is active</span>
          </label>
          <input id="m-inst-url" name="instructions_url" type="url" defaultValue={meta.instructionsUrl} className={inputClass} />
        </div>
        {kind === "pdf" ? (
          <>
            <div>
              <label htmlFor="m-pages" className="block text-[12px] font-medium text-ink">
                Pages to keep in exports <span className="font-normal text-mute-soft">1-based, e.g. 4, 5, 6; empty = all</span>
              </label>
              <input id="m-pages" name="include_pages" defaultValue={meta.includePages} className={`font-mono ${inputClass}`} />
            </div>
            <div>
              <label htmlFor="m-mirror" className="block text-[12px] font-medium text-ink">
                Mirror <span className="font-normal text-mute-soft">one “from -&gt; to” per line, e.g. CopyB[0] -&gt; Copy2[0]</span>
              </label>
              <textarea id="m-mirror" name="mirror" rows={2} defaultValue={meta.mirror} className={`font-mono ${inputClass}`} />
            </div>
          </>
        ) : null}
        <div className="sm:col-span-2">
          <label htmlFor="m-notes" className="block text-[12px] font-medium text-ink">
            Notes <span className="font-normal text-mute-soft">shown to boards on the form card — e.g. which boxes are left blank on purpose</span>
          </label>
          <textarea id="m-notes" name="notes" rows={3} defaultValue={meta.notes} className={inputClass} />
        </div>
      </fieldset>

      {kind === "pdf" ? (
        <div>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h3 className="text-[14px] font-bold tracking-tight text-ink">Field map</h3>
            <input
              aria-label="Filter fields"
              placeholder="Filter fields"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="min-h-[36px] rounded-lg border border-line-strong bg-paper px-3 text-[12px] text-ink"
            />
          </div>
          <p className="mt-1 text-[12px] text-mute">
            Leave a field&rsquo;s source empty to leave it unmapped — it prints blank. Every mapped field needs a citation.
            Settings: {keys.setting.join(", ")}. Ledger: {keys.ledger.join(", ")}. Contractors: {keys.contractors.join(", ")}.
            Calculated: add(), sub(), mul(), max0() of field names, numbers, or param:&lt;tax_parameters key&gt;.
            Kind tells the form page how to show the line; Review caps confidence so a person always looks; Enter 0 offers that button on a money line.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[84rem] text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-mute">
                  <th className="pb-2 pr-2 font-medium">PDF field</th>
                  <th className="pb-2 pr-2 font-medium">Label</th>
                  <th className="pb-2 pr-2 font-medium">Section</th>
                  <th className="pb-2 pr-2 font-medium">Source</th>
                  <th className="pb-2 pr-2 font-medium">Rule</th>
                  <th className="pb-2 pr-2 font-medium">Kind</th>
                  <th className="pb-2 pr-2 font-medium">Review</th>
                  <th className="pb-2 pr-2 font-medium">Enter 0</th>
                  <th className="pb-2 pr-2 font-medium">Hint</th>
                  <th className="pb-2 font-medium">Citation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.name} className={shown.includes(r) ? "" : "hidden"}>
                    <td className="py-1.5 pr-2 align-top font-mono text-[11px] text-mute">
                      {r.name}
                      <div className="text-mute-soft">{r.type}</div>
                    </td>
                    <td className="py-1.5 pr-2"><input name={`label:${r.name}`} defaultValue={r.label} disabled={locked} aria-label={`Label for ${r.name}`} className={`${cell} min-w-[14rem]`} /></td>
                    <td className="py-1.5 pr-2"><input name={`section:${r.name}`} defaultValue={r.section} disabled={locked} aria-label={`Section for ${r.name}`} className={`${cell} w-28`} /></td>
                    <td className="py-1.5 pr-2">
                      <select name={`src:${r.name}`} defaultValue={r.source} disabled={locked} aria-label={`Source for ${r.name}`} className="rounded border border-line-strong bg-paper px-1 py-1">
                        <option value="">Unmapped</option>
                        <option value="setting">Setting</option>
                        <option value="ledger">Ledger</option>
                        <option value="contractors">Contractors</option>
                        <option value="calculated">Calculated</option>
                        <option value="manual">Entered by hand</option>
                      </select>
                    </td>
                    <td className="py-1.5 pr-2"><input name={`rule:${r.name}`} defaultValue={r.rule} disabled={locked} aria-label={`Rule for ${r.name}`} className={`${cell} w-48 font-mono`} /></td>
                    <td className="py-1.5 pr-2">
                      <select name={`kind:${r.name}`} defaultValue={r.kind} disabled={locked} aria-label={`Kind for ${r.name}`} className="rounded border border-line-strong bg-paper px-1 py-1">
                        <option value="">—</option>
                        <option value="money">Money</option>
                        <option value="text">Text</option>
                        <option value="date">Date</option>
                        <option value="checkbox">Checkbox</option>
                      </select>
                    </td>
                    <td className="py-1.5 pr-2 text-center"><input type="checkbox" name={`review:${r.name}`} defaultChecked={r.review} disabled={locked} aria-label={`Always review ${r.name}`} /></td>
                    <td className="py-1.5 pr-2 text-center"><input type="checkbox" name={`zero:${r.name}`} defaultChecked={r.zeroOk} disabled={locked} aria-label={`Offer Enter 0 on ${r.name}`} /></td>
                    <td className="py-1.5 pr-2"><input name={`hint:${r.name}`} defaultValue={r.hint} disabled={locked} aria-label={`Hint for ${r.name}`} className={`${cell} min-w-[14rem]`} /></td>
                    <td className="py-1.5"><input name={`cite:${r.name}`} defaultValue={r.citation} disabled={locked} aria-label={`Citation for ${r.name}`} className={`${cell} min-w-[16rem]`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {state?.error ? <p className="text-[12px] text-bad-text">{state.error}</p> : null}
      {state?.ok ? <p className="text-[12px] text-good-text">Saved.</p> : null}
      {locked ? (
        <p className="text-[12px] text-mute">This template is active. Deactivate it to change {kind === "pdf" ? "the map" : "its rules"}.</p>
      ) : (
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving…" : kind === "pdf" ? "Save map and rules" : "Save rules"}
        </button>
      )}
    </form>
  );
}

export function ActivationControls({ id, active, kind }: { id: string; active: boolean; kind: "pdf" | "link_only" }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ?? null);
      setConfirming(false);
    });
  const attestation =
    kind === "pdf"
      ? "I opened the labeled preview and the filled sample export in a PDF viewer and checked every mapped line, the due rule and the links against the printed form and its instructions."
      : "I opened the official page and checked the due rule, the filing instructions and the links against it.";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {active ? (
        <button type="button" disabled={pending} onClick={() => run(() => deactivate(id))} className={btn}>
          Deactivate
        </button>
      ) : confirming ? (
        <>
          <span className="text-[12px] text-ink">{attestation}</span>
          <button type="button" disabled={pending} onClick={() => run(() => verifyAndActivate(id))} className={primary}>
            Verify and activate
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={btn}>Cancel</button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={primary}>
          Verify and activate…
        </button>
      )}
      {msg ? <span className="w-full text-[12px] text-bad-text">{msg}</span> : null}
    </div>
  );
}
