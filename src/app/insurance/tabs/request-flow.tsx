"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { longDate } from "@/lib/dates";
import { coverageShort } from "@/lib/insurance/coverage";
import { parseMoneyLoose } from "@/lib/insurance/declarations";
import type { QuoteRequestPayloadV2 } from "@/lib/insurance/emails";
import { constructionLabel } from "@/lib/insurance/facts";
import { COVERAGE_FORMS, VALUATIONS } from "@/lib/insurance/fields";
import { formatMoney, formatPercent } from "@/lib/insurance/format";
import { createQuoteRequests } from "../request-actions";
import { ContactDialog } from "../components/contact-dialog";
import { DISCLAIMER } from "../components/page-header";
import { btnGhost, btnPrimary, errorBlock, helpClass, inputClass, labelClass, linkClass } from "../components/styles";
import type { RequestFlowData } from "../quotes-data";
import { moneyInputText } from "../quote-helpers";

/**
 * "Ask for quotes" (insurance-spec §9.7.2): who to ask, what coverage, what
 * the building is, what to share, consent. One button prepares a draft per
 * contact; nothing is sent. The board opens each draft in its own email.
 */

const ENUM_OPTIONS: Record<string, { value: string; label: string }[]> = {
  valuation: VALUATIONS.filter((o) => o.value !== "unknown"),
  coverage_form: COVERAGE_FORMS.filter((o) => o.value !== "unknown"),
};

const yesNo = (b: boolean | null) => (b === null ? null : b ? "Yes" : "No");

function namesList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function RequestFlow({
  data,
  preselectContacts,
  preselectCoverage,
}: {
  data: RequestFlowData;
  /** Contact ids to tick (from ?contact=); otherwise the current agent. */
  preselectContacts: string[];
  /** One coverage to tick (from ?coverage=); otherwise in-force lines plus open findings. */
  preselectCoverage: string | null;
}) {
  const router = useRouter();
  const p = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const emailable = data.contacts.filter((c) => c.email);
  const [picked, setPicked] = useState<Set<string>>(() => {
    const wanted = preselectContacts.filter((id) => emailable.some((c) => c.id === id));
    if (wanted.length) return new Set(wanted);
    const agent = emailable.find((c) => c.isCurrentAgent);
    return new Set(agent ? [agent.id] : []);
  });
  const [coverages, setCoverages] = useState<Set<string>>(() => {
    if (preselectCoverage && data.coverages.some((c) => c.coverage === preselectCoverage)) return new Set([preselectCoverage]);
    return new Set(data.coverages.filter((c) => c.preselected).map((c) => c.coverage));
  });
  const [wanted, setWanted] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(
      data.coverages.map((c) => [c.coverage, Object.fromEntries(c.wanted.map((w) => [w.key, w.kind === "money" ? moneyInputText(w.value || null) : w.value]))]),
    ),
  );
  const [shareCurrent, setShareCurrent] = useState(false);
  const [claimAmounts, setClaimAmounts] = useState(false);
  const [anything, setAnything] = useState("");
  const [reply, setReply] = useState(data.replyTo);
  const [consent, setConsent] = useState(false);

  const chosen = emailable.filter((c) => picked.has(c.id));
  const chosenCoverages = data.coverages.filter((c) => coverages.has(c.coverage));
  const firstCurrent =
    (coverages.has("property") ? data.current.property : null) ??
    chosenCoverages.map((c) => data.current[c.coverage]).find(Boolean) ??
    null;
  const a = data.association;

  function toggle(set: Set<string>, value: string, on: boolean): Set<string> {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  }

  function buildPayload(): QuoteRequestPayloadV2 | { error: string } {
    const out: QuoteRequestPayloadV2["coverages"] = [];
    for (const c of chosenCoverages) {
      const w: Record<string, string | null> = {};
      for (const input of c.wanted) {
        const text = (wanted[c.coverage]?.[input.key] ?? "").trim();
        if (!text) {
          w[input.key] = null;
          continue;
        }
        if (input.kind === "money") {
          const parsed = parseMoneyLoose(text);
          if (!parsed) return { error: `${coverageShort(c.coverage)}, ${input.label.toLowerCase()}: enter an amount like $2,400,000.` };
          w[input.key] = parsed;
        } else {
          w[input.key] = text;
        }
      }
      out.push({ coverage: c.coverage, wanted: w });
    }
    return {
      version: 2,
      association: {
        legal_name: a.legal_name,
        address: a.address,
        city: a.city,
        units: a.units,
        year_built: a.year_built,
        construction: a.construction,
        stories: a.stories,
        roof_replaced_year: a.roof_replaced_year,
        total_square_feet: a.total_square_feet,
        has_sprinklers: a.has_sprinklers,
        has_amenities: a.has_amenities,
        rental_share: a.rental_share,
      },
      coverages: out,
      deductibles_today: coverages.has("property") ? data.deductiblesToday : null,
      current: shareCurrent && firstCurrent ? firstCurrent : null,
      claims: data.claims,
      include_claim_amounts: claimAmounts,
      anything_else: anything.trim() || null,
      contact: { name: reply.name.trim(), email: reply.email.trim(), phone: reply.phone.trim() || null },
    };
  }

  function submit() {
    setError(null);
    if (chosen.length === 0) return setError("Choose at least one agency or insurer.");
    if (chosenCoverages.length === 0) return setError("Choose at least one kind of coverage.");
    if (!consent) return setError("Tick the box confirming these details can be shared.");
    const payload = buildPayload();
    if ("error" in payload) return setError(payload.error);
    start(async () => {
      const r = await createQuoteRequests({ contactIds: chosen.map((c) => c.id), payload, consent: true });
      if ("error" in r) setError(r.error);
      else router.push(`/insurance?view=quotes&drafts=${r.messageIds.length}${r.messageIds[0] ? `&open=${r.messageIds[0]}` : ""}`);
    });
  }

  const building: { label: string; value: string | null }[] = [
    { label: "Legal name", value: a.legal_name || null },
    { label: "Address", value: a.address || null },
    { label: "Units", value: a.units ? String(a.units) : null },
    { label: "Stories", value: a.stories ? String(a.stories) : null },
    { label: "Year built", value: a.year_built ? String(a.year_built) : null },
    { label: "Construction", value: constructionLabel(a.construction) },
    { label: "Roof last replaced", value: a.roof_replaced_year ? String(a.roof_replaced_year) : null },
    { label: "Square feet", value: a.total_square_feet ? a.total_square_feet.toLocaleString("en-US") : null },
    { label: "Sprinklers", value: yesNo(a.has_sprinklers) },
    { label: "Shared amenities", value: yesNo(a.has_amenities) },
    { label: "Units rented out", value: formatPercent(a.rental_share) },
  ];

  const sectionTitle = "text-[15px] font-bold tracking-tight text-ink";

  return (
    <section aria-labelledby={`${p}-title`} className="space-y-6 rounded-xl border border-line bg-paper px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`${p}-title`} className="text-[18px] font-bold tracking-tight text-ink">
            Ask for quotes
          </h2>
          <p className="mt-1 text-[13px] text-mute">Walkup prepares an email for each contact. You send them from your own email.</p>
        </div>
        <Link href="/insurance?view=quotes" className={btnGhost}>
          Close
        </Link>
      </div>

      <fieldset className="space-y-2">
        <legend className={sectionTitle}>Who should we ask?</legend>
        {emailable.length === 0 ? (
          <p className="text-[13px] text-mute">None of your contacts has an email address yet. Add one below, or save an agency from the Marketplace.</p>
        ) : (
          <ul className="space-y-1">
            {emailable.map((c) => (
              <li key={c.id}>
                <label className="flex min-h-[44px] items-center gap-2 text-[13px] text-ink">
                  <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => setPicked((s) => toggle(s, c.id, e.target.checked))} />
                  <span>
                    {c.name}
                    {c.isCurrentAgent ? <span className="ml-2 text-[11px] text-mute">Your agent</span> : null}
                    <span className="ml-2 text-[12px] text-mute">{c.email}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {data.contacts.length > emailable.length ? (
          <p className={helpClass}>
            {data.contacts.length - emailable.length} saved {data.contacts.length - emailable.length === 1 ? "contact has" : "contacts have"} no email address. Open them in the Marketplace to add one.
          </p>
        ) : null}
        {chosen.length === 1 ? <p className={helpClass}>Asking two or three gives you something to compare.</p> : null}
        <button type="button" className={btnGhost} onClick={() => setAdding(true)}>
          Add a contact
        </button>
        <ContactDialog
          open={adding}
          contact={null}
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            setPicked((s) => toggle(s, id, true));
            router.refresh();
          }}
        />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className={sectionTitle}>What coverage?</legend>
        <div className="grid gap-x-4 sm:grid-cols-2">
          {data.coverages.map((c) => (
            <label key={c.coverage} className="flex min-h-[44px] items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" checked={coverages.has(c.coverage)} onChange={(e) => setCoverages((s) => toggle(s, c.coverage, e.target.checked))} />
              {c.label}
              {c.fromCheck ? <span className="text-[11px] text-mute">from Coverage check</span> : null}
            </label>
          ))}
        </div>
        {chosenCoverages
          .filter((c) => c.wanted.length > 0)
          .map((c) => (
            <div key={c.coverage} className="rounded-lg border border-line px-4 py-3">
              <h3 className="text-[13px] font-medium text-ink">{c.label}: what you&rsquo;d ask for</h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {c.wanted.map((w) => {
                  const id = `${p}-${c.coverage}-${w.key}`;
                  const value = wanted[c.coverage]?.[w.key] ?? "";
                  const set = (v: string) => setWanted((all) => ({ ...all, [c.coverage]: { ...all[c.coverage], [w.key]: v } }));
                  return (
                    <div key={w.key}>
                      <label htmlFor={id} className={labelClass}>
                        {w.label}
                      </label>
                      {w.kind === "money" ? (
                        <input id={id} inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} placeholder="$" className={inputClass} />
                      ) : (
                        <select id={id} value={value} onChange={(e) => set(e.target.value)} className={inputClass}>
                          <option value="">Not sure</option>
                          {(ENUM_OPTIONS[w.key] ?? []).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )}
                      {w.caption ? <p className={helpClass}>{w.caption}</p> : null}
                      {w.note ? <p className={helpClass}>{w.note}</p> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
      </fieldset>

      <div className="space-y-2">
        <h3 className={sectionTitle}>About the building</h3>
        <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
          {building.map((b) => (
            <div key={b.label} className="flex justify-between gap-3 border-b border-line py-1.5">
              <dt className="text-mute">{b.label}</dt>
              <dd className={b.value ? "text-right text-ink" : "text-right text-mute-soft"}>{b.value ?? "Not recorded"}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <Link href="/insurance/facts" className={linkClass}>
            Edit building facts
          </Link>
          {data.isAdmin ? (
            <Link href="/building" className={linkClass}>
              Edit in Building & Owners
            </Link>
          ) : (
            <span className="text-mute">Only {data.adminNames} can change the address.</span>
          )}
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className={sectionTitle}>Share</legend>
        {firstCurrent ? (
          <label className="flex min-h-[44px] items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={shareCurrent} onChange={(e) => setShareCurrent(e.target.checked)} />
            Share what we pay now ({formatMoney(firstCurrent.premium)} with {firstCurrent.carrier})
          </label>
        ) : null}
        <label className="flex min-h-[44px] items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={claimAmounts} onChange={(e) => setClaimAmounts(e.target.checked)} />
          Include amounts paid on past claims
        </label>
        <div className="text-[13px]">
          <p className="font-medium text-ink">Claims in the last 5 years</p>
          {data.claims.length === 0 ? (
            <p className="text-mute">None recorded. The email will say so only if you add it below.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-ink">
              {data.claims.map((c, i) => (
                <li key={i}>
                  {longDate(c.date_of_loss)}: {c.description} ({c.status}
                  {claimAmounts && c.amount_paid ? `, ${formatMoney(c.amount_paid)} paid` : ""})
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <label htmlFor={`${p}-else`} className={labelClass}>
            Anything else
          </label>
          <textarea id={`${p}-else`} rows={3} maxLength={2000} value={anything} onChange={(e) => setAnything(e.target.value)} className={inputClass} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor={`${p}-rn`} className={labelClass}>
              Reply to: name
            </label>
            <input id={`${p}-rn`} value={reply.name} onChange={(e) => setReply({ ...reply, name: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label htmlFor={`${p}-re`} className={labelClass}>
              Email
            </label>
            <input id={`${p}-re`} type="email" inputMode="email" value={reply.email} onChange={(e) => setReply({ ...reply, email: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label htmlFor={`${p}-rp`} className={labelClass}>
              Phone
            </label>
            <input id={`${p}-rp`} type="tel" value={reply.phone} onChange={(e) => setReply({ ...reply, phone: e.target.value })} className={inputClass} />
          </div>
        </div>
      </fieldset>

      <label className="flex min-h-[44px] items-start gap-2 py-2 text-[13px] text-ink">
        <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
        <span>
          I&rsquo;m OK sharing these details with {chosen.length ? namesList(chosen.map((c) => c.name)) : "the contacts I chose"}. Walkup prepares the emails; you send them from your own email.
        </span>
      </label>

      <p className="text-[12px] leading-relaxed text-mute">{DISCLAIMER}</p>

      <div className="space-y-2">
        {error ? <p className={errorBlock}>{error}</p> : null}
        <button type="button" className={`${btnPrimary} w-full sm:w-auto`} disabled={pending} onClick={submit}>
          {pending ? "Preparing…" : chosen.length === 0 ? "Prepare emails" : chosen.length === 1 ? "Prepare 1 email" : `Prepare ${chosen.length} emails`}
        </button>
      </div>
    </section>
  );
}
