"use client";

import { useActionState, useState, useTransition } from "react";
import { dateWords } from "@/lib/tax/copy";
import { LINK_KIND_LABEL, type LinkKind } from "@/lib/tax/links";
import { addLink, checkLinks, setLinkActive, verifyLink } from "./actions";
import { LINK_FORM_CODES, LINK_KINDS } from "./rules";
import { btn, inputClass, primary, smallBtn } from "./styles";

/** A tax_form_links row with everything the admin needs to judge it. */
export interface AdminLinkRow {
  id: string;
  form_code: string;
  kind: string;
  label: string;
  url: string;
  state_code: string | null;
  retrieved_on: string;
  retrieved_note: string | null;
  verified_at: string | null;
  last_checked_at: string | null;
  last_check_status: string | null;
  active: boolean;
  sort_order: number;
}

const pill = (tone: "good" | "warning" | "mute") =>
  tone === "good"
    ? "rounded-full border border-good-line bg-good-tint px-2 py-0.5 text-[11px] text-good-text"
    : tone === "warning"
      ? "rounded-full border border-warning-line bg-warning-tint px-2 py-0.5 text-[11px] text-warning-text"
      : "rounded-full border border-line bg-fill px-2 py-0.5 text-[11px] text-mute";

/** What the automatic check said, in words an admin can act on. */
function checkWords(status: string | null, checkedAt: string | null): string {
  if (!status || !checkedAt) return "not checked automatically yet";
  const when = dateWords(checkedAt.slice(0, 10), "short");
  if (status === "200") return `answered ${when}`;
  if (status === "blocked") return `blocked for non-browsers ${when} — open it yourself`;
  return `${status} (${when})`;
}

function LinkRowView({ row, pending, onVerify, onToggle }: { row: AdminLinkRow; pending: boolean; onVerify: () => void; onToggle: () => void }) {
  return (
    <li className={`flex flex-wrap items-start justify-between gap-3 py-3 ${row.active ? "" : "opacity-60"}`}>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <a href={row.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline-offset-2 hover:underline">
            {row.label} ↗
          </a>
          <span className={pill("mute")}>{LINK_KIND_LABEL[row.kind as LinkKind] ?? row.kind}</span>
          <span className={pill("mute")}>{row.state_code ?? "Federal"}</span>
          {!row.active ? <span className={pill("warning")}>Inactive — boards don&rsquo;t see it</span> : null}
        </p>
        <p className="mt-0.5 break-all font-mono text-[11px] text-mute-soft">{row.url}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-mute">
          <span>retrieved {dateWords(row.retrieved_on, "short")}</span>
          <span>·</span>
          {row.verified_at ? (
            <span className={pill("good")}>opened by a person {dateWords(row.verified_at.slice(0, 10), "short")}</span>
          ) : (
            <span className={pill("warning")}>not yet checked by a person</span>
          )}
          <span>·</span>
          <span>automatic check: {checkWords(row.last_check_status, row.last_checked_at)}</span>
        </p>
        {row.retrieved_note ? <p className="mt-1 text-[11px] text-mute-soft">{row.retrieved_note}</p> : null}
      </div>
      <span className="flex flex-wrap gap-2">
        {row.active ? (
          <button type="button" disabled={pending} onClick={onVerify} className={smallBtn}>
            I opened this and it&rsquo;s current
          </button>
        ) : null}
        <button type="button" disabled={pending} onClick={onToggle} className={smallBtn}>
          {row.active ? "Deactivate" : "Reactivate"}
        </button>
      </span>
    </li>
  );
}

export function AddLinkForm() {
  const [state, action, pending] = useActionState(addLink, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor="k-form" className="block text-[12px] font-medium text-ink">Form</label>
        <select id="k-form" name="form_code" required defaultValue="" className={inputClass}>
          <option value="" disabled>Choose…</option>
          {LINK_FORM_CODES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="k-kind" className="block text-[12px] font-medium text-ink">Kind</label>
        <select id="k-kind" name="kind" required defaultValue="" className={inputClass}>
          <option value="" disabled>Choose…</option>
          {LINK_KINDS.map((k) => (
            <option key={k} value={k}>{LINK_KIND_LABEL[k]}</option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="k-label" className="block text-[12px] font-medium text-ink">Label (what boards see)</label>
        <input id="k-label" name="label" required placeholder="About Form 1120-H" className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="k-url" className="block text-[12px] font-medium text-ink">
          Address <span className="font-normal text-mute-soft">https on irs.gov, illinois.gov, ilsos.gov or ilga.gov</span>
        </label>
        <input id="k-url" name="url" type="url" required placeholder="https://www.irs.gov/forms-pubs/about-form-1120-h" className={inputClass} />
      </div>
      <div>
        <label htmlFor="k-state" className="block text-[12px] font-medium text-ink">
          State <span className="font-normal text-mute-soft">two letters; blank for a federal link</span>
        </label>
        <input id="k-state" name="state_code" maxLength={2} placeholder="IL" className={inputClass} />
      </div>
      {state?.error ? <p className="text-[12px] text-bad-text sm:col-span-2">{state.error}</p> : null}
      {state?.ok ? <p className="text-[12px] text-good-text sm:col-span-2">Added — retrieved today, not yet checked by a person. Open it, then click “I opened this and it&rsquo;s current”.</p> : null}
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Adding…" : "Add the link"}
        </button>
      </div>
    </form>
  );
}

/**
 * Every official link, grouped by form in the order boards meet them.
 * "I opened this and it's current" is the only thing that marks a link
 * checked; "Check all links" only records whether each address answered.
 */
export function LinksPanel({ rows, formLabels, formOrder }: { rows: AdminLinkRow[]; formLabels: Record<string, string>; formOrder: string[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string; ok?: boolean }>) =>
    start(async () => {
      const r = await fn();
      setMsg("error" in r && r.error ? r.error : null);
    });
  const check = () =>
    start(async () => {
      const r = await checkLinks();
      if ("error" in r && r.error) {
        setMsg(r.error);
        return;
      }
      if (!("checked" in r)) return;
      const blocked = r.blocked ?? [];
      const errors = r.errors ?? [];
      setMsg(
        `Checked ${r.checked}: ${r.answered ?? 0} answered.${blocked.length ? ` Blocked for non-browsers (open these yourself): ${blocked.join(", ")}.` : ""}${errors.length ? ` Problems: ${errors.join("; ")}.` : ""}`,
      );
    });

  const groups = formOrder.filter((code) => rows.some((r) => r.form_code === code)).map((code) => ({
    code,
    label: formLabels[code] ?? code,
    rows: rows.filter((r) => r.form_code === code).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)),
  }));

  return (
    <div className="space-y-5 text-[13px]">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending} onClick={check} className={btn}>
          {pending ? "Checking…" : "Check all links"}
        </button>
        <span className="text-[12px] text-mute">
          Opens each active address once, as a browser would, and records what answered. ilsos.gov refuses anything that isn&rsquo;t a browser — those read &ldquo;blocked&rdquo;, and a person opens them.
        </span>
        {msg ? <span className="w-full text-[12px] text-mute">{msg}</span> : null}
      </div>
      {groups.length === 0 ? <p className="py-2 text-mute">No links on file.</p> : null}
      {groups.map((g) => (
        <div key={g.code}>
          <h3 className="text-[14px] font-bold tracking-tight text-ink">{g.label}</h3>
          <ul className="divide-y divide-line">
            {g.rows.map((row) => (
              <LinkRowView
                key={row.id}
                row={row}
                pending={pending}
                onVerify={() => run(() => verifyLink(row.id))}
                onToggle={() => run(() => setLinkActive(row.id, !row.active))}
              />
            ))}
          </ul>
        </div>
      ))}
      <div className="border-t border-line pt-4">
        <h3 className="text-[14px] font-bold tracking-tight text-ink">Add a link</h3>
        <div className="mt-2">
          <AddLinkForm />
        </div>
      </div>
    </div>
  );
}
