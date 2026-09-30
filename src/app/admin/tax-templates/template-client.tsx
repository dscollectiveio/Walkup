"use client";

import { useActionState, useState, useTransition } from "react";
import { checkForUpdates, deactivate, fetchTemplate, saveFieldMap, verifyAndActivate } from "./actions";

const inputClass = "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink";
const btn = "min-h-[44px] rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-50";
const primary = "min-h-[44px] rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50";

export function FetchTemplateForm() {
  const [state, action, pending] = useActionState(fetchTemplate, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor="t-form" className="block text-[12px] font-medium text-ink">Form</label>
        <select id="t-form" name="form_code" required defaultValue="" className={inputClass}>
          <option value="" disabled>Choose…</option>
          <option value="irs_1120h">Form 1120-H</option>
          <option value="irs_1120">Form 1120</option>
          <option value="irs_1099_nec">Form 1099-NEC</option>
          <option value="irs_1096">Form 1096</option>
          <option value="il_1120">Illinois IL-1120</option>
          <option value="il_sos_annual_report">Illinois annual report</option>
        </select>
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
}

export function FieldMapForm({
  id,
  rows,
  locked,
  meta,
  keys,
}: {
  id: string;
  rows: MapRow[];
  locked: boolean;
  meta: { dueRule: string; dueCitation: string; instructions: string; filingCitation: string; notes: string; revision: string };
  keys: { setting: readonly string[]; ledger: readonly string[]; contractors: readonly string[] };
}) {
  const [state, action, pending] = useActionState(saveFieldMap, null);
  const [filter, setFilter] = useState("");
  const shown = rows.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()) || r.label.toLowerCase().includes(filter.toLowerCase()));

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
          <label htmlFor="m-inst" className="block text-[12px] font-medium text-ink">What to sign, attach, and where to mail it (cover sheet)</label>
          <textarea id="m-inst" name="filing_instructions" rows={3} defaultValue={meta.instructions} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="m-inst-cite" className="block text-[12px] font-medium text-ink">Those instructions come from</label>
          <input id="m-inst-cite" name="filing_citation" defaultValue={meta.filingCitation} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="m-notes" className="block text-[12px] font-medium text-ink">
            Notes <span className="font-normal text-mute-soft">e.g. verified Illinois treatment, shown to boards on IL-1120</span>
          </label>
          <textarea id="m-notes" name="notes" rows={2} defaultValue={meta.notes} className={inputClass} />
        </div>
      </fieldset>

      <div>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="text-[14px] font-black tracking-tight text-ink">Field map</h3>
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
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[60rem] text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-mute">
                <th className="pb-2 pr-2 font-medium">PDF field</th>
                <th className="pb-2 pr-2 font-medium">Label</th>
                <th className="pb-2 pr-2 font-medium">Section</th>
                <th className="pb-2 pr-2 font-medium">Source</th>
                <th className="pb-2 pr-2 font-medium">Rule</th>
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
                  <td className="py-1.5 pr-2"><input name={`label:${r.name}`} defaultValue={r.label} disabled={locked} aria-label={`Label for ${r.name}`} className="w-full rounded border border-line-strong px-2 py-1" /></td>
                  <td className="py-1.5 pr-2"><input name={`section:${r.name}`} defaultValue={r.section} disabled={locked} aria-label={`Section for ${r.name}`} className="w-24 rounded border border-line-strong px-2 py-1" /></td>
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
                  <td className="py-1.5 pr-2"><input name={`rule:${r.name}`} defaultValue={r.rule} disabled={locked} aria-label={`Rule for ${r.name}`} className="w-48 rounded border border-line-strong px-2 py-1 font-mono" /></td>
                  <td className="py-1.5"><input name={`cite:${r.name}`} defaultValue={r.citation} disabled={locked} aria-label={`Citation for ${r.name}`} className="w-56 rounded border border-line-strong px-2 py-1" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {state?.error ? <p className="text-[12px] text-bad-text">{state.error}</p> : null}
      {state?.ok ? <p className="text-[12px] text-good-text">Saved.</p> : null}
      {locked ? (
        <p className="text-[12px] text-mute">This template is active. Deactivate it to change the map.</p>
      ) : (
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving…" : "Save map"}
        </button>
      )}
    </form>
  );
}

export function ActivationControls({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ?? null);
      setConfirming(false);
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {active ? (
        <button type="button" disabled={pending} onClick={() => run(() => deactivate(id))} className={btn}>
          Deactivate
        </button>
      ) : confirming ? (
        <>
          <span className="text-[12px] text-ink">I checked the labeled preview against the printed form and every mapping&rsquo;s citation.</span>
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
