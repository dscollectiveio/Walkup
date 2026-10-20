"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  clearSuppression,
  previewRuleRecipients,
  saveReminderRule,
  setDailyCap,
  setRulePaused,
  setSendingEnabled,
} from "@/app/dues/email-actions";
import type { RuleFieldErrors } from "@/lib/email-outbox/actions-core";
import { btnPrimary, btnSecondary } from "@/components/repairs/styles";

const btn = btnPrimary;
const btnGhost = btnSecondary;
const input = "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[16px] text-ink sm:text-[14px]";
const label = "block text-[12px] font-medium text-ink";

function Err({ text }: { text: string | null | undefined }) {
  return text ? (
    <p role="alert" className="mt-2 text-[13px] text-bad-text">
      {text}
    </p>
  ) : null;
}

// ---- Sending switch -----------------------------------------------------------------

export function SendingSwitch({ enabled, canAdmin, hasReplyTo }: { enabled: boolean; canAdmin: boolean; hasReplyTo: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canAdmin) return <p className="text-[13px] text-mute">A board admin can turn sending on or off.</p>;

  const change = (next: boolean) => {
    setError(null);
    start(async () => {
      const res = await setSendingEnabled(next);
      if ("error" in res) setError(res.error);
      else {
        setConfirming(false);
        router.refresh();
      }
    });
  };

  if (!enabled && !hasReplyTo) {
    return (
      <a href="/building#contact" className={btnGhost}>
        Add the board contact email
      </a>
    );
  }
  if (!enabled) {
    return (
      <div>
        <button type="button" className={btn} disabled={pending} onClick={() => change(true)}>
          Turn on sending
        </button>
        <Err text={error} />
      </div>
    );
  }
  return (
    <div>
      {confirming ? (
        <div className="rounded-lg border border-line bg-fill p-3">
          <p className="text-[13px] text-ink">Turn off sending? Waiting emails are cancelled and every rule is switched off.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={pending} onClick={() => change(false)}>
              Turn off sending
            </button>
            <button type="button" className={btnGhost} disabled={pending} onClick={() => setConfirming(false)}>
              Keep it on
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={btnGhost} onClick={() => setConfirming(true)}>
          Turn off sending
        </button>
      )}
      <Err text={error} />
    </div>
  );
}

// ---- Daily limit --------------------------------------------------------------------

export function DailyLimit({ cap }: { cap: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(cap));
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const save = () => {
    setMsg(null);
    start(async () => {
      const res = await setDailyCap(Number(value));
      if ("error" in res) setMsg({ text: res.error, bad: true });
      else {
        setMsg({ text: "Saved." });
        router.refresh();
      }
    });
  };
  return (
    <div>
      <label htmlFor="daily-cap" className={label}>
        Emails per day
      </label>
      <div className="flex items-center gap-2">
        <input id="daily-cap" type="number" min={1} max={200} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className={`${input} max-w-[8rem]`} />
        <button type="button" className={btnGhost} disabled={pending || value === String(cap)} onClick={save}>
          Save
        </button>
      </div>
      <p className="mt-2 text-[12px] text-mute">Walkup never sends more than this many a day for your building, and no more than one email per person per week of each kind.</p>
      <p aria-live="polite" className={`mt-1 text-[13px] ${msg?.bad ? "text-bad-text" : "text-good-text"}`}>
        {msg?.text}
      </p>
    </div>
  );
}

// ---- Reminder rules -----------------------------------------------------------------

export interface RuleView {
  kind: "dues_upcoming" | "dues_overdue";
  id: string | null;
  days: number;
  minAmount: string;
  repeatEveryDays: number;
  maxReminders: number;
  enabled: boolean;
  paused: boolean;
  lastRunOn: string | null;
}

const RULE_TITLE = { dues_upcoming: "Before dues are due", dues_overdue: "After dues are overdue" } as const;

function RuleRow({ rule, sendingOn, canAdmin, canBoard }: { rule: RuleView; sendingOn: boolean; canAdmin: boolean; canBoard: boolean }) {
  const router = useRouter();
  const [days, setDays] = useState(String(rule.days));
  const [minAmount, setMinAmount] = useState(rule.minAmount);
  const [repeat, setRepeat] = useState(String(rule.repeatEveryDays));
  const [max, setMax] = useState(String(rule.maxReminders));
  const [confirmOn, setConfirmOn] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<RuleFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const values = (enabled: boolean) => ({
    kind: rule.kind,
    days: Number(days),
    minAmount: minAmount.trim(),
    repeatEveryDays: Number(repeat),
    maxReminders: Number(max),
    enabled,
  });
  const save = (enabled: boolean) => {
    setError(null);
    setInfo(null);
    setFieldErrors({});
    start(async () => {
      const res = await saveReminderRule(values(enabled));
      if ("error" in res) {
        setError(res.error);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
      } else {
        setConfirmOn(false);
        setInfo("Saved.");
        router.refresh();
      }
    });
  };
  const togglePause = () => {
    if (!rule.id) return;
    setError(null);
    start(async () => {
      const res = await setRulePaused(rule.id!, !rule.paused);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  };
  const preview = () => {
    setError(null);
    setInfo(null);
    start(async () => {
      const res = await previewRuleRecipients(values(false));
      if ("error" in res) setError(res.error);
      else setInfo(res.sentence);
    });
  };

  const state = !rule.enabled ? "Off" : rule.paused ? "Paused" : "On";
  const idBase = `rule-${rule.kind}`;
  const sentence =
    rule.kind === "dues_upcoming"
      ? `Send a reminder ${days || "N"} days before a payment is due`
      : `Send a reminder when a unit is ${days || "N"} days overdue, then every ${repeat || "N"} days, up to ${max || "N"} times`;

  return (
    <li className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-ink">{RULE_TITLE[rule.kind]}</h3>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${state === "On" ? "bg-good-tint text-good-text" : "bg-fill text-mute"}`}>{state}</span>
      </div>
      <p className="mt-1 text-[13px] text-mute">{sentence}. Only for balances of {minAmount || "N"} or more.</p>

      {canBoard ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div>
            <label htmlFor={`${idBase}-days`} className={label}>
              {rule.kind === "dues_upcoming" ? "Days before" : "Days overdue"}
            </label>
            <input id={`${idBase}-days`} type="number" min={1} max={90} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} className={input} disabled={!canAdmin} />
            <Err text={fieldErrors.days} />
          </div>
          {rule.kind === "dues_overdue" ? (
            <>
              <div>
                <label htmlFor={`${idBase}-repeat`} className={label}>
                  Then every (days)
                </label>
                <input id={`${idBase}-repeat`} type="number" min={7} max={60} inputMode="numeric" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={input} disabled={!canAdmin} />
                <Err text={fieldErrors.repeatEveryDays} />
              </div>
              <div>
                <label htmlFor={`${idBase}-max`} className={label}>
                  Up to (times)
                </label>
                <input id={`${idBase}-max`} type="number" min={1} max={6} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} className={input} disabled={!canAdmin} />
                <Err text={fieldErrors.maxReminders} />
              </div>
            </>
          ) : null}
          <div>
            <label htmlFor={`${idBase}-min`} className={label}>
              Only balances of ($)
            </label>
            <input id={`${idBase}-min`} inputMode="decimal" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className={input} disabled={!canAdmin} />
            <Err text={fieldErrors.minAmount} />
          </div>
        </div>
      ) : null}

      {confirmOn ? (
        <div className="mt-3 rounded-lg border border-line bg-fill p-3 text-[13px] text-ink">
          <p>Walkup will email owners on its own under this rule, once a day at about 9 a.m., without asking each time. You can pause it any time. Turn it on?</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-mute">
            <li>Never more than one email per owner per week.</li>
            <li>Never to anyone who unsubscribed.</li>
            <li>Never for a balance the ledger doesn&apos;t show.</li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={pending} onClick={() => save(true)}>
              Turn on this rule
            </button>
            <button type="button" className={btnGhost} disabled={pending} onClick={() => setConfirmOn(false)}>
              Not now
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canAdmin ? (
          <button type="button" className={btnGhost} disabled={pending} onClick={() => save(rule.enabled)}>
            Save
          </button>
        ) : null}
        {canAdmin && !rule.enabled ? (
          <button type="button" className={btn} disabled={pending || !sendingOn} onClick={() => setConfirmOn(true)} title={sendingOn ? undefined : "Turn on sending first."}>
            Turn on
          </button>
        ) : null}
        {canAdmin && rule.enabled ? (
          <button type="button" className={btnGhost} disabled={pending} onClick={() => save(false)}>
            Turn off
          </button>
        ) : null}
        {canBoard && rule.enabled && rule.id ? (
          <button type="button" className={btnGhost} disabled={pending} onClick={togglePause}>
            {rule.paused ? "Resume" : "Pause"}
          </button>
        ) : null}
        {canBoard ? (
          <button type="button" className={btnGhost} disabled={pending} onClick={preview}>
            Preview
          </button>
        ) : null}
      </div>
      {!sendingOn && !rule.enabled && canAdmin ? <p className="mt-2 text-[12px] text-mute">Turn on sending first.</p> : null}
      {rule.lastRunOn ? <p className="mt-2 text-[12px] text-mute">Last ran {rule.lastRunOn}.</p> : null}
      <p aria-live="polite" className="mt-2 text-[13px] text-ink">
        {info}
      </p>
      <Err text={error} />
    </li>
  );
}

export function RulesCard({ rules, sendingOn, canAdmin, canBoard }: { rules: RuleView[]; sendingOn: boolean; canAdmin: boolean; canBoard: boolean }) {
  return (
    <ul className="space-y-3">
      {rules.map((r) => (
        <RuleRow key={r.kind} rule={r} sendingOn={sendingOn} canAdmin={canAdmin} canBoard={canBoard} />
      ))}
    </ul>
  );
}

// ---- Blocked addresses --------------------------------------------------------------

export function BlockedList({ items, canAdmin }: { items: { email: string; reason: string; date: string }[]; canAdmin: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const clear = (email: string) => {
    setError(null);
    start(async () => {
      const res = await clearSuppression(email);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  };
  return (
    <div>
      <ul className="divide-y divide-line text-[13px]">
        {items.map((i) => (
          <li key={i.email} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0 break-all text-ink">{i.email}</span>
            <span className="text-mute">
              {i.reason === "complaint" ? "Reported as spam" : "Bounced"} on {i.date}
            </span>
            {canAdmin && i.reason !== "complaint" ? (
              <button type="button" className={btnGhost} disabled={pending} onClick={() => clear(i.email)}>
                Clear
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-mute">Clear only after you&apos;ve fixed the address.</p>
      <Err text={error} />
    </div>
  );
}
