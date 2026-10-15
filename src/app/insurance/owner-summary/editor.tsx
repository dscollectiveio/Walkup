"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { longDate } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/insurance/format";
import type { OwnerSummaryContent } from "@/lib/insurance/owner-summary";
import { COVERAGE_FORM_OWNER_WORDS, NO_AGENT_CERTIFICATE_INSTRUCTIONS } from "@/lib/insurance/owner-summary-text";
import { publishOwnerSummary, saveOwnerSummaryDraft, unpublishOwnerSummary } from "../owner-summary-actions";
import { ConfirmDialog } from "../components/confirm-dialog";
import { OwnerSummaryView } from "../components/owner-summary-view";
import { btnGhost, btnPrimary, errorBlock, helpClass, inputClass, labelClass, linkClass, warningBlock } from "../components/styles";
import { Toast } from "../components/toast";

/**
 * The owner summary editor (insurance-spec §9.9): the draft on the left, a
 * preview of exactly what owners will see on the right (below on phones).
 * Save keeps a draft; Publish replaces what owners see.
 */

export interface MasterOption {
  id: string;
  label: string;
  master: OwnerSummaryContent["master"];
  deductibles: OwnerSummaryContent["deductibles"];
  claimsLine: OwnerSummaryContent["claims_line"];
  leftToOwners: string[];
  tips: string[];
}

/** JSON with sorted keys: jsonb from the database doesn't keep the draft's key order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

type CertContact = { id: string; name: string; contact: OwnerSummaryContent["certificate_contact"]; instructions: string };

function TextList({
  id,
  label,
  items,
  max,
  maxLength,
  onChange,
  addLabel,
}: {
  id: string;
  label: string;
  items: string[];
  max: number;
  maxLength: number;
  onChange: (items: string[]) => void;
  addLabel: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className={labelClass}>{label}</legend>
      {items.map((t, i) => (
        <div key={i} className="flex items-start gap-2">
          <label htmlFor={`${id}-${i}`} className="sr-only">
            {label} {i + 1}
          </label>
          <textarea
            id={`${id}-${i}`}
            rows={2}
            maxLength={maxLength}
            value={t}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            className={inputClass}
          />
          <button
            type="button"
            aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="mt-1 min-h-[44px] rounded-md px-3 text-[12px] text-mute hover:bg-fill hover:text-ink"
          >
            Remove
          </button>
        </div>
      ))}
      {items.length < max ? (
        <button
          type="button"
          onClick={() => onChange([...items, ""])}
          className="inline-flex min-h-[44px] items-center rounded-md border border-dashed border-line-strong px-4 text-[13px] text-ink hover:bg-fill"
        >
          {addLabel}
        </button>
      ) : null}
    </fieldset>
  );
}

export function OwnerSummaryEditor({
  initial,
  published,
  publishedAt,
  staleText,
  masters,
  defaultMasterId,
  contacts,
  defaultContactId,
  todayIso,
  illinois,
  citation,
}: {
  initial: OwnerSummaryContent;
  published: OwnerSummaryContent | null;
  publishedAt: string | null;
  staleText: string | null;
  masters: MasterOption[];
  defaultMasterId: string | null;
  contacts: CertContact[];
  defaultContactId: string | null;
  todayIso: string;
  illinois: boolean;
  citation: { section: string; url: string };
}) {
  const router = useRouter();
  const p = useId();
  const [content, setContent] = useState<OwnerSummaryContent>(initial);
  const [masterId, setMasterId] = useState(defaultMasterId ?? "");
  const [contactId, setContactId] = useState(defaultContactId ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [toast, setToast] = useState<{ message: string; stamp: number } | null>(null);

  const option = masters.find((m) => m.id === masterId) ?? null;
  const set = (patch: Partial<OwnerSummaryContent>) => setContent((c) => ({ ...c, ...patch }));
  const say = (message: string) => setToast((t) => ({ message, stamp: (t?.stamp ?? 0) + 1 }));

  function chooseMaster(id: string) {
    const next = masters.find((m) => m.id === id) ?? null;
    setMasterId(id);
    setContent((c) => {
      const tips = [...c.tips];
      // The first tip describes the master deductible: follow the chosen policy when it still has Walkup's wording.
      if (option && next && tips[0] === option.tips[0]) tips[0] = next.tips[0];
      return {
        ...c,
        master: next?.master ?? null,
        deductibles: next?.deductibles ?? { all_perils: null, water: null, wind_hail: null, wind_hail_percent: null, per_unit: null },
        claims_line: next?.claimsLine ?? null,
        tips,
      };
    });
  }

  function chooseContact(id: string) {
    const c = contacts.find((x) => x.id === id) ?? null;
    setContactId(id);
    set({ certificate_contact: c?.contact ?? null, certificate_instructions: c?.instructions ?? NO_AGENT_CERTIFICATE_INSTRUCTIONS });
  }

  /** Blank list items and a blank liability line or note are dropped before saving. */
  function cleaned(): OwnerSummaryContent {
    return {
      ...content,
      left_to_owners: content.left_to_owners.map((s) => s.trim()).filter(Boolean),
      tips: content.tips.map((s) => s.trim()).filter(Boolean),
      liability_requirement: content.liability_requirement?.trim() || null,
      board_note: content.board_note?.trim() || null,
      certificate_instructions: content.certificate_instructions.trim() || NO_AGENT_CERTIFICATE_INSTRUCTIONS,
    };
  }

  const differs = published !== null && stable(published) !== stable(cleaned());
  const d = content.deductibles;
  const windHail = formatPercent(d.wind_hail_percent) ?? formatMoney(d.wind_hail);
  const deductibleWords = [
    formatMoney(d.all_perils) ? `${formatMoney(d.all_perils)} all other perils` : null,
    formatMoney(d.water) ? `${formatMoney(d.water)} water damage` : null,
    windHail ? `${windHail} wind or hail` : null,
    formatMoney(d.per_unit) ? `${formatMoney(d.per_unit)} per unit` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">What owners see</h1>
        <p className="mt-1 text-mute">A short summary of what the master policy covers and what it leaves to each owner&rsquo;s own condo (HO-6) policy.</p>
      </div>
      {staleText ? <p className={warningBlock}>{staleText}</p> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <form
          className="space-y-5 rounded-xl border border-line bg-paper px-5 py-5"
          onSubmit={(e) => e.preventDefault()}
          aria-label="The owner summary draft"
        >
          <div>
            <label htmlFor={`${p}-master`} className={labelClass}>
              Master policy
            </label>
            {masters.length ? (
              <select id={`${p}-master`} value={masterId} onChange={(e) => chooseMaster(e.target.value)} className={inputClass}>
                {masters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-1 text-[13px] text-mute">
                No master policy in force is recorded.{" "}
                <Link href="/insurance/import" className={linkClass}>
                  Add it
                </Link>{" "}
                first, or publish the parts below on their own.
              </p>
            )}
          </div>

          {content.master ? (
            <div className="space-y-2 text-[13px]">
              <div>
                <span className={labelClass}>Coverage form</span>
                <p className="mt-1 text-ink">{COVERAGE_FORM_OWNER_WORDS[content.master.coverage_form]}</p>
                {masterId ? (
                  <Link href={`/insurance/policies/${masterId}/edit`} className={`${linkClass} text-[12px]`}>
                    Change it on the policy
                  </Link>
                ) : null}
              </div>
              <div>
                <span className={labelClass}>Deductibles</span>
                <p className="mt-1 text-ink">{deductibleWords.length ? deductibleWords.join(", ") : "Not recorded on the policy"}</p>
              </div>
              <div>
                <span className={labelClass}>Claims phone</span>
                <p className="mt-1 text-ink">{content.claims_line?.phone ?? "Not recorded on the policy"}</p>
              </div>
            </div>
          ) : null}

          <TextList
            id={`${p}-left`}
            label="What the master policy leaves to owners"
            items={content.left_to_owners}
            max={12}
            maxLength={200}
            onChange={(left_to_owners) => set({ left_to_owners })}
            addLabel="Add a line"
          />
          {option ? (
            <button type="button" className={btnGhost} onClick={() => set({ left_to_owners: [...option.leftToOwners] })}>
              Reset to Walkup&rsquo;s wording
            </button>
          ) : null}

          <TextList id={`${p}-tips`} label="Tips" items={content.tips} max={8} maxLength={400} onChange={(tips) => set({ tips })} addLabel="Add a tip" />

          <div>
            <label htmlFor={`${p}-liab`} className={labelClass}>
              Liability requirement <span className="font-normal text-mute-soft">optional</span>
            </label>
            <textarea
              id={`${p}-liab`}
              rows={2}
              maxLength={300}
              value={content.liability_requirement ?? ""}
              onChange={(e) => set({ liability_requirement: e.target.value })}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor={`${p}-cc`} className={labelClass}>
              Certificate contact
            </label>
            <select id={`${p}-cc`} value={contactId} onChange={(e) => chooseContact(e.target.value)} className={inputClass}>
              <option value="">Nobody: owners ask the board</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${p}-ci`} className={labelClass}>
              Instructions for certificates
            </label>
            <textarea
              id={`${p}-ci`}
              rows={3}
              maxLength={500}
              value={content.certificate_instructions}
              onChange={(e) => set({ certificate_instructions: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`${p}-note`} className={labelClass}>
              A note from the board <span className="font-normal text-mute-soft">optional</span>
            </label>
            <textarea id={`${p}-note`} rows={3} maxLength={1000} value={content.board_note ?? ""} onChange={(e) => set({ board_note: e.target.value })} className={inputClass} />
          </div>

          <div className="space-y-2 border-t border-line pt-4">
            {publishedAt ? (
              <p className="text-[13px] text-ink">
                Published {longDate(publishedAt)}.{differs ? " You have unpublished changes." : ""}
              </p>
            ) : (
              <p className="text-[13px] text-mute">Not published. Owners don&rsquo;t see anything yet.</p>
            )}
            {error ? <p className={errorBlock}>{error}</p> : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                className={btnGhost}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const r = await saveOwnerSummaryDraft(cleaned(), masterId || null);
                    if ("error" in r) setError(r.error);
                    else {
                      say("Draft saved.");
                      router.refresh();
                    }
                  })
                }
              >
                {pending ? "Saving…" : "Save draft"}
              </button>
              <button type="button" className={btnPrimary} disabled={pending} onClick={() => setConfirm(true)}>
                Publish to owners
              </button>
              {publishedAt ? (
                <button
                  type="button"
                  className={btnGhost}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const r = await unpublishOwnerSummary();
                      if ("error" in r) setError(r.error);
                      else {
                        say("Unpublished. Owners no longer see the summary.");
                        router.refresh();
                      }
                    })
                  }
                >
                  Unpublish
                </button>
              ) : null}
            </div>
            {illinois ? (
              <p className={helpClass}>
                Selling a unit? Illinois requires the association to tell buyers what insurance it provides for owners (
                <a href={citation.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  Section 22.1
                </a>
                ). This summary can help answer that.
              </p>
            ) : null}
          </div>
        </form>

        <section aria-labelledby={`${p}-preview`} className="space-y-3">
          <h2 id={`${p}-preview`} className="eyebrow text-mute">
            Preview: what owners see
          </h2>
          <div className="rounded-xl border border-dashed border-line-strong bg-fill/40 p-4">
            <OwnerSummaryView content={cleaned()} publishedAt={publishedAt} todayIso={todayIso} />
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirm}
        title="Publish to owners?"
        body="Owners will see this summary on their Insurance page. Publish?"
        confirmLabel="Publish to owners"
        pendingLabel="Publishing…"
        onConfirm={async () => {
          const r = await publishOwnerSummary(cleaned(), masterId || null);
          if ("error" in r) return r;
          say("Published. Owners can see it now.");
          router.refresh();
          return { ok: true };
        }}
        onClose={() => setConfirm(false)}
      />
      <Toast message={toast?.message ?? null} stamp={toast?.stamp} />
    </div>
  );
}
