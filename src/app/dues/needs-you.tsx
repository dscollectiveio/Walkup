"use client";

import { useState, useTransition } from "react";
import { mailtoHref } from "@/lib/email/mailto";
import { addUnitCharge, chargeDueNow, chargeDuesPeriod, confirmDepositAsDues, dismissPaymentReport } from "./actions";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const day = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export interface UnitOption {
  id: string;
  label: string;
  ownerName: string | null;
  ownerEmail: string | null;
  /** Who a draft is addressed to when that is not the owner (the property manager as main contact). */
  contactName?: string | null;
}

export type NeedsYouItem =
  | { kind: "charge_all"; unitsLeft: number; totalCents: number; periodWords: string }
  | { kind: "charge"; scheduleId: string; periodLabel: string; unitsLeft: number; amountCents: number }
  | {
      kind: "deposit";
      bankTransactionId: string;
      description: string;
      postedOn: string;
      amountCents: number;
      suggestedUnitId: string | null;
      reason: string | null;
      /** An owner's report this deposit appears to settle. */
      reportId: string | null;
    }
  | {
      kind: "report";
      reportId: string;
      unitId: string;
      amountCents: number;
      paidOn: string;
      method: string;
      note: string | null;
    }
  | { kind: "late_fee"; unitId: string; periodLabel: string; daysOverdue: number; amountCents: number; periodStart: string }
  | { kind: "behind"; unitId: string; owedCents: number; overdueCents: number; daysOverdue: number };

const METHOD_WORDS: Record<string, string> = {
  zelle: "by Zelle",
  check: "by check",
  cash: "in cash",
  bank_transfer: "by bank transfer",
  other: "another way",
};

const btnPrimary =
  "inline-flex h-8 items-center rounded-md bg-ink px-3 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50";
const btnGhost =
  "inline-flex h-8 items-center rounded-md border border-line-strong bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill disabled:opacity-50";
const link = "text-[12px] text-mute underline-offset-2 hover:text-ink hover:underline";

/**
 * One decision per line, one button per decision. Everything here is a
 * person confirming something the page noticed; nothing applies itself.
 */
export function NeedsYou({
  items,
  units,
  associationName,
}: {
  items: NeedsYouItem[];
  units: UnitOption[];
  associationName: string;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const unitById = new Map(units.map((u) => [u.id, u]));

  const run = (key: string, fn: () => Promise<{ error?: string; warning?: string }>) => {
    setBusyKey(key);
    setErrors((e) => ({ ...e, [key]: "" }));
    start(async () => {
      const result = await fn();
      setBusyKey(null);
      if (result.error) setErrors((e) => ({ ...e, [key]: result.error as string }));
      else if (result.warning) setErrors((e) => ({ ...e, [key]: result.warning as string }));
      else setHidden((h) => new Set(h).add(key));
    });
  };

  const visible = items.filter((it) => !hidden.has(keyOf(it)));
  if (visible.length === 0) return null;

  return (
    <ul className="divide-y divide-line">
      {visible.map((it) => {
        const key = keyOf(it);
        const busy = pending && busyKey === key;
        const err = errors[key];
        return (
          <li key={key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
            {it.kind === "charge_all" ? (
              <>
                <div className="min-w-0 text-[13px]">
                  <span className="font-medium text-ink">{it.periodWords} dues haven&rsquo;t been charged yet</span>
                  <span className="ml-2 text-mute">
                    {it.unitsLeft} unit{it.unitsLeft === 1 ? "" : "s"} · {money(it.totalCents)} in total
                  </span>
                </div>
                <button type="button" disabled={busy} onClick={() => run(key, () => chargeDueNow())} className={btnPrimary}>
                  {busy ? "Charging…" : "Charge what's due"}
                </button>
              </>
            ) : null}

            {it.kind === "charge" ? (
              <>
                <div className="min-w-0 text-[13px]">
                  <span className="font-medium text-ink">{it.periodLabel} dues haven&rsquo;t been charged yet</span>
                  <span className="ml-2 text-mute">
                    {it.unitsLeft} unit{it.unitsLeft === 1 ? "" : "s"} · {money(it.amountCents)} each
                  </span>
                </div>
                <button type="button" disabled={busy} onClick={() => run(key, () => chargeDuesPeriod(it.scheduleId))} className={btnPrimary}>
                  {busy ? "Charging…" : `Charge ${it.periodLabel}`}
                </button>
              </>
            ) : null}

            {it.kind === "deposit" ? (
              <DepositLine
                item={it}
                units={units}
                busy={busy}
                onConfirm={(unitId) =>
                  run(key, () =>
                    confirmDepositAsDues({ bankTransactionId: it.bankTransactionId, unitId, reportId: it.reportId }),
                  )
                }
              />
            ) : null}

            {it.kind === "report" ? (
              <ReportLine
                item={it}
                unit={unitById.get(it.unitId) ?? null}
                busy={busy}
                onDismiss={(note) => run(key, () => dismissPaymentReport(it.reportId, note))}
                onLater={() => setHidden((h) => new Set(h).add(key))}
              />
            ) : null}

            {it.kind === "late_fee" ? (
              <>
                <div className="min-w-0 text-[13px]">
                  <span className="font-medium text-ink">
                    {unitById.get(it.unitId)?.label ?? "A unit"} is {it.daysOverdue} days late on {it.periodLabel}
                  </span>
                  <span className="ml-2 text-mute">late fee would be {money(it.amountCents)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(key, () =>
                        addUnitCharge({
                          unitId: it.unitId,
                          amount: it.amountCents / 100,
                          kind: "late_fee",
                          periodStart: it.periodStart,
                          memo: `Late fee: ${it.periodLabel} dues`,
                        }),
                      )
                    }
                    className={btnPrimary}
                  >
                    {busy ? "Adding…" : `Add the ${money(it.amountCents)} fee`}
                  </button>
                  <button type="button" onClick={() => setHidden((h) => new Set(h).add(key))} className={link}>
                    Skip this time
                  </button>
                </div>
              </>
            ) : null}

            {it.kind === "behind" ? (
              <BehindLine item={it} unit={unitById.get(it.unitId) ?? null} associationName={associationName} />
            ) : null}

            {err ? <p className="w-full text-[12px] text-bad-text">{err}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

function keyOf(it: NeedsYouItem): string {
  switch (it.kind) {
    case "charge_all":
      return "charge_all";
    case "charge":
      return `charge:${it.scheduleId}`;
    case "deposit":
      return `deposit:${it.bankTransactionId}`;
    case "report":
      return `report:${it.reportId}`;
    case "late_fee":
      return `fee:${it.unitId}:${it.periodStart}`;
    case "behind":
      return `behind:${it.unitId}`;
  }
}

function DepositLine({
  item,
  units,
  busy,
  onConfirm,
}: {
  item: Extract<NeedsYouItem, { kind: "deposit" }>;
  units: UnitOption[];
  busy: boolean;
  onConfirm: (unitId: string) => void;
}) {
  const [unitId, setUnitId] = useState(item.suggestedUnitId ?? "");
  const suggested = units.find((u) => u.id === item.suggestedUnitId);
  return (
    <>
      <div className="min-w-0 text-[13px]">
        <span className="font-medium text-ink">
          {money(item.amountCents)} came in on {day(item.postedOn)}
        </span>
        <span className="ml-2 text-mute">“{item.description}”</span>
        {suggested ? (
          <div className="text-[12px] text-mute">
            Looks like <span className="font-medium text-ink">{suggested.label}</span>
            {suggested.ownerName ? ` (${suggested.ownerName})` : ""}, {item.reason}.
          </div>
        ) : (
          <div className="text-[12px] text-mute">Which unit is this from?</div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {suggested ? (
          <button type="button" disabled={busy} onClick={() => onConfirm(suggested.id)} className={btnPrimary}>
            {busy ? "Posting…" : `Yes, ${suggested.label}`}
          </button>
        ) : null}
        <select
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
          aria-label="Unit this deposit is from"
          className="h-8 rounded-md border border-line-strong bg-paper px-2 text-[12px] text-ink"
        >
          <option value="">{suggested ? "A different unit…" : "Choose a unit…"}</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
              {u.ownerName ? ` · ${u.ownerName}` : ""}
            </option>
          ))}
        </select>
        {unitId && unitId !== item.suggestedUnitId ? (
          <button type="button" disabled={busy} onClick={() => onConfirm(unitId)} className={btnGhost}>
            {busy ? "Posting…" : "Post as dues"}
          </button>
        ) : null}
        <a href="/bank-feed?status=needs" className={link}>
          Not dues
        </a>
      </div>
    </>
  );
}

function ReportLine({
  item,
  unit,
  busy,
  onDismiss,
  onLater,
}: {
  item: Extract<NeedsYouItem, { kind: "report" }>;
  unit: UnitOption | null;
  busy: boolean;
  onDismiss: (note: string) => void;
  onLater: () => void;
}) {
  const [dismissing, setDismissing] = useState(false);
  const [note, setNote] = useState("");
  return (
    <>
      <div className="min-w-0 text-[13px]">
        <span className="font-medium text-ink">
          {unit?.label ?? "A unit"} says they paid {money(item.amountCents)} {METHOD_WORDS[item.method] ?? ""} on{" "}
          {day(item.paidOn)}
        </span>
        <div className="text-[12px] text-mute">
          {item.note ? `“${item.note}” · ` : ""}No matching deposit has shown up on the bank feed yet. It usually
          takes a few days.
        </div>
      </div>
      {dismissing ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note to the owner (optional)"
            className="h-8 min-w-[14rem] rounded-md border border-line-strong bg-paper px-2 text-[12px] text-ink"
          />
          <button type="button" disabled={busy} onClick={() => onDismiss(note)} className={btnPrimary}>
            {busy ? "Saving…" : "Mark not received"}
          </button>
          <button type="button" onClick={() => setDismissing(false)} className={link}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button type="button" onClick={onLater} className={btnGhost}>
            Keep waiting
          </button>
          <button type="button" onClick={() => setDismissing(true)} className={link}>
            Not received
          </button>
        </div>
      )}
    </>
  );
}

function BehindLine({
  item,
  unit,
  associationName,
}: {
  item: Extract<NeedsYouItem, { kind: "behind" }>;
  unit: UnitOption | null;
  associationName: string;
}) {
  const label = unit?.label ?? "A unit";
  const subject = `${label}: dues balance of ${money(item.owedCents)}`;
  const body =
    `Hi ${(unit?.contactName ?? unit?.ownerName)?.split(" ")[0] ?? "there"},\n\n` +
    `A quick reminder that ${label} has ${money(item.overdueCents)} in dues past due` +
    (item.owedCents > item.overdueCents ? ` (${money(item.owedCents)} owed in total)` : "") +
    `. Payment details are on the Dues page in Walkup.\n\nThanks,\nThe ${associationName} board`;
  const mailto = unit?.ownerEmail
    ? mailtoHref(unit.ownerEmail, subject, body)
    : null;
  return (
    <>
      <div className="min-w-0 text-[13px]">
        <span className="font-medium text-ink">
          {label} is behind: {money(item.overdueCents)} past due
        </span>
        <span className="ml-2 text-mute">
          {item.daysOverdue} day{item.daysOverdue === 1 ? "" : "s"}
          {unit?.ownerName ? ` · ${unit.ownerName}` : ""}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {mailto ? (
          <a href={mailto} className={btnGhost} title="Opens a draft in your own mail app. Nothing is sent by Walkup">
            Draft a reminder
          </a>
        ) : (
          <span className="text-[12px] text-warning-text">No email on file for the owner</span>
        )}
        <a href={`/delinquency?select=${item.unitId}`} className={btnGhost} title="Review a reminder email on the Collections page before anything goes out">
          Prepare reminder
        </a>
        <a href={`/units/${item.unitId}`} className={link}>
          Statement
        </a>
      </div>
    </>
  );
}
