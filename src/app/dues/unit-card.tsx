"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  recordReserveContribution,
  removePropertyManager,
  saveAdditionalAssessment,
  savePropertyManager,
  saveUnitDues,
  setMainContact,
} from "./actions";
import { FREQUENCY_WORDS, PLAN_FREQUENCIES, perPeriodCents } from "@/lib/dues/plan";
import { moneyToCents } from "@/lib/format/money-input";
import { MoneyInput } from "@/components/money-input";
import { DuesYearBar } from "./dues-year-bar";
import { prepareReminders } from "./email-actions";
import { SETUP_DUES_EVENT } from "./setup-dues-event";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);

/** What the card shows about a unit's Additional Agreed Assessment this year. */
export interface AdditionalView {
  /** The agreed amount, or the charge's amount when it is required. */
  agreedCents: number | null;
  /** Required means it has been charged to the unit for this year. */
  required: boolean;
  dueOn: string | null;
  /** Contributions, payments applied to it, and extra dues rolled over. */
  givenCents: number;
  /** 0 to 100, for the bar. */
  pct: number;
  /** Extra regular dues that rolled over into it. */
  rolledOverCents: number;
  /** Given voluntarily on its own (not counting roll-over). */
  voluntaryGivenCents: number;
}

/** A unit's property manager and who Walkup's email goes to for the unit. */
export interface ManagerView {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  main: "owner" | "manager";
}

export type UnitStatus =
  | { kind: "paid_up" }
  | { kind: "due_soon"; cents: number; dueLabel: string }
  | { kind: "past_due"; cents: number }
  | { kind: "credit"; cents: number }
  | { kind: "no_dues" };

export interface UnitPlan {
  annualCents: number;
  frequency: (typeof PLAN_FREQUENCIES)[number];
  note: string | null;
}

const field =
  "figures h-11 w-full rounded-md border border-line-strong bg-paper px-2 text-right text-[16px] text-ink sm:h-9 sm:text-[13px]";
const primary =
  "inline-flex h-11 items-center whitespace-nowrap sm:h-8 rounded-md bg-ink px-3 text-[12px] font-medium text-paper transition-colors hover:bg-ink-mid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:opacity-50";
const quiet =
  "inline-flex h-11 items-center whitespace-nowrap sm:h-8 rounded-md border border-line-strong px-3 text-[12px] font-medium text-ink transition-colors hover:bg-fill";

/**
 * One unit as its own card in "Where every unit stands": who and where it
 * stands (passed in from the page), the dues plan, the voluntary annual
 * reserve contribution, and the year's progress along the bottom, the full
 * width of the card. Editing the plan keeps the bar in step as the yearly
 * amount is typed.
 */
export function UnitCard({
  unitId,
  label,
  ownerName,
  ownerNoEmail,
  status,
  bar,
  remind,
  planSummary,
  onlinePending = null,
  details,
  plan,
  canEdit,
  year,
  todayKey,
  paidCents,
  pendingCents,
  isAdmin,
  additional,
  manager,
  ownerEmail,
}: {
  unitId: string;
  /** The unit's name, e.g. "Unit 3". */
  label: string;
  ownerName: string | null;
  /** The owner has no email on file. */
  ownerNoEmail: boolean;
  /** The one status on the right of the row, from the two buckets (past due, due soon) and nothing else. */
  status: UnitStatus;
  /** This year's charges and how much is paid. Null when the unit has no charges this year: no bar. */
  bar: { paidCents: number; chargedCents: number } | null;
  /** The Remind button on a past-due row: null hides it, a reason disables it. */
  remind: { ok: boolean; reason: string | null } | null;
  /** "$5,000 a year, monthly", shown when the row is open. */
  planSummary: string | null;
  /** An online payment on its way (DECISIONS #57): "$400 paid online, pending". Still owed until the deposit is confirmed. */
  onlinePending?: string | null;
  /** What is owed, last payment, next charge, statement link: shown when the card is open. */
  details: React.ReactNode;
  plan: UnitPlan | null;
  canEdit: boolean;
  /** The calendar year shown, e.g. "2026". */
  year: string;
  todayKey: string;
  /** Dues paid this calendar year, including deposits labeled dues but not yet posted. */
  paidCents: number;
  /** The part of paidCents not yet posted to the books. */
  pendingCents: number;
  /** Only a board admin can make an Additional Agreed Assessment required. */
  isAdmin: boolean;
  additional: AdditionalView;
  manager: ManagerView | null;
  /** The owner's email, for showing who the main contact is. */
  ownerEmail: string | null;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [remindPending, startRemind] = useTransition();
  const [remindError, setRemindError] = useState<string | null>(null);
  const [showManager, setShowManager] = useState(false);
  const [showAdditional, setShowAdditional] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const [editingReserve, setEditingReserve] = useState(false);
  const [mode, setMode] = useState<"voluntary" | "required">("voluntary");
  const [editingManager, setEditingManager] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactBusy, startContact] = useTransition();
  const [managerState, managerAction, managerPending] = useActionState(savePropertyManager, null);
  const [prevManager, setPrevManager] = useState(managerState);
  if (managerState !== prevManager) {
    setPrevManager(managerState);
    if (managerState && "ok" in managerState) setEditingManager(false);
  }
  const managerHasEmail = !!manager && (manager.email ?? "").trim() !== "";
  const choose = (main: "owner" | "manager") =>
    startContact(async () => {
      setContactError(null);
      const r = await setMainContact(unitId, main);
      if ("error" in r) setContactError(r.error);
    });
  const [recording, setRecording] = useState(false);
  const [annual, setAnnual] = useState(plan ? String(plan.annualCents / 100) : "");
  const [frequency, setFrequency] = useState<UnitPlan["frequency"]>(plan?.frequency ?? "monthly");

  const [planState, planAction, planPending] = useActionState(saveUnitDues, null);
  const [prevPlan, setPrevPlan] = useState(planState);
  if (planState !== prevPlan) {
    setPrevPlan(planState);
    if (planState?.ok) setEditingPlan(false);
  }
  const [reserveState, reserveAction, reservePending] = useActionState(saveAdditionalAssessment, null);
  const [prevReserve, setPrevReserve] = useState(reserveState);
  if (reserveState !== prevReserve) {
    setPrevReserve(reserveState);
    if (reserveState && "ok" in reserveState) setEditingReserve(false);
  }
  const [giveState, giveAction, givePending] = useActionState(recordReserveContribution, null);
  const [prevGive, setPrevGive] = useState(giveState);
  if (giveState !== prevGive) {
    setPrevGive(giveState);
    if (giveState && "ok" in giveState) setRecording(false);
  }

  const annualCents = editingPlan ? moneyToCents(annual) : (plan?.annualCents ?? 0);
  const preview = annualCents > 0 ? perPeriodCents(annualCents, frequency) : 0;
  const agreed = additional.agreedCents;
  const hasAdditional = agreed !== null && agreed > 0;
  const lastDay = `${year}-12-31`;
  /** One panel at a time under the buttons: opening one closes the others and any form left half open. */
  const openPanel = (which: "plan" | "manager" | "additional") => {
    const next = {
      plan: which === "plan" && !editingPlan,
      manager: which === "manager" && !showManager,
      additional: which === "additional" && !showAdditional,
    };
    setEditingPlan(next.plan);
    setShowManager(next.manager);
    setShowAdditional(next.additional);
    setEditingManager(false);
    setEditingReserve(false);
    setRecording(false);
  };
  const panelButton = (active: boolean) =>
    `inline-flex h-11 items-center whitespace-nowrap sm:h-8 rounded-md bg-ink px-3 text-[12px] font-medium text-paper transition-colors hover:bg-ink-mid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass ${
      active ? "ring-2 ring-brass ring-offset-1 ring-offset-paper" : ""
    }`;
  /** Open the row with the dues plan editor showing: the "Set up" link and the summary line's link. */
  const openSetup = () => {
    setOpen(true);
    setEditingPlan(true);
    setShowManager(false);
    setShowAdditional(false);
  };
  useEffect(() => {
    const onSetup = (e: Event) => {
      if ((e as CustomEvent<string>).detail === unitId) {
        setOpen(true);
        setEditingPlan(true);
        setShowManager(false);
        setShowAdditional(false);
      }
    };
    window.addEventListener(SETUP_DUES_EVENT, onSetup);
    return () => window.removeEventListener(SETUP_DUES_EVENT, onSetup);
  }, [unitId]);

  return (
    <article
      className={`flex flex-col rounded-xl border bg-paper transition-shadow duration-300 ${
        editingPlan || showManager || showAdditional ? "border-line-strong shadow-md" : "border-line"
      }`}
    >
      {/* One row: the whole row opens it. The Remind button and the Set up link stop that click. */}
      <div
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer px-1 py-3 hover:bg-fill/40 sm:px-2"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
            className="flex min-h-[44px] min-w-0 items-center gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass sm:min-h-0"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`shrink-0 text-mute transition-transform ${open ? "rotate-90" : ""}`}>
              <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="shrink-0 text-[15px] font-bold text-ink">{label}</span>
            <span className="hidden min-w-0 truncate text-[13px] text-mute sm:inline">
              {ownerName ?? "no owner on file"}
              {ownerName && ownerNoEmail ? " · no email" : ""}
            </span>
          </button>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {onlinePending ? (
              <span className="whitespace-nowrap rounded-full bg-info-tint px-2 py-0.5 text-[11px] text-info-text">{onlinePending}</span>
            ) : null}
            <StatusText status={status} onSetup={() => openSetup()} />
            {status.kind === "past_due" && remind ? (
              <button
                type="button"
                disabled={!remind.ok || remindPending}
                title={remind.reason ?? undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  startRemind(async () => {
                    setRemindError(null);
                    const res = await prepareReminders({ unitIds: [unitId] });
                    if ("error" in res) setRemindError(res.error);
                    else router.push(`/dues/send/${res.batchId}`);
                  });
                }}
                className="inline-flex min-h-[44px] items-center rounded-md bg-ink px-3 text-[12px] font-medium text-paper transition-colors hover:bg-ink-mid disabled:opacity-50 sm:min-h-0 sm:py-1"
              >
                {remindPending ? "Preparing…" : "Remind"}
              </button>
            ) : null}
          </div>
        </div>
        <p className="mt-0.5 pl-6 text-[13px] text-mute sm:hidden">
          {ownerName ?? "no owner on file"}
          {ownerName && ownerNoEmail ? " · no email" : ""}
        </p>
        {bar ? (
          <div className="mt-1.5 flex flex-col gap-1 pl-6 sm:flex-row sm:items-center sm:gap-3">
            <div
              className="h-1 flex-1 overflow-hidden rounded-full bg-line"
              role="img"
              aria-label={`${money(bar.paidCents)} of ${money(bar.chargedCents)} paid this year`}
            >
              <div className="h-full rounded-full bg-good" style={{ width: `${Math.min(100, bar.chargedCents > 0 ? (bar.paidCents / bar.chargedCents) * 100 : 0)}%` }} />
            </div>
            <span className="figures whitespace-nowrap text-[12px] text-mute sm:text-right">
              {money(bar.paidCents)} of {money(bar.chargedCents)} paid this year
            </span>
          </div>
        ) : null}
        {remindError ? (
          <p role="alert" className="mt-1 pl-6 text-[12px] text-bad-text">
            {remindError}
          </p>
        ) : null}
      </div>

      {open ? (
      <>
      <div className="flex-1 p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1 md:max-w-sm">
            {planSummary ? <p className="mb-3 text-[13px] text-mute">{planSummary}</p> : null}
            {details}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {canEdit ? (
              <button type="button" onClick={() => openPanel("plan")} aria-expanded={editingPlan} className={panelButton(editingPlan)}>
                {plan ? "Edit dues plan" : "Set dues plan"}
              </button>
            ) : null}
            <button type="button" onClick={() => openPanel("manager")} aria-expanded={showManager} className={panelButton(showManager)}>
              Property manager
            </button>
            <button type="button" onClick={() => openPanel("additional")} aria-expanded={showAdditional} className={panelButton(showAdditional)}>
              Additional Agreed Assessments
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-4">

        {/* Dues plan: just the editor, opened by the button above */}
        {editingPlan ? (
        <div className="border-t border-line pt-4">
            <form action={planAction} className="space-y-4">
              <input type="hidden" name="unit_id" value={unitId} />
              <div>
                <h4 className="text-[13px] font-bold text-ink">{plan ? "Edit the dues plan" : "Set the dues plan"}</h4>
                <p className="mt-0.5 text-[12px] text-mute">
                  Changing it affects charges not yet posted. Anything already in the books stays as it is. The bar below follows the amount as you type.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block text-[12px] font-medium text-ink">
                  Dues for the year
                  <MoneyInput
                    name="annual_amount"
                    defaultValue={plan ? plan.annualCents / 100 : null}
                    onValueChange={setAnnual}
                    placeholder="$5,400"
                    autoFocus
                    className="figures mt-1 block h-11 w-full rounded-md border border-line-strong bg-paper px-3 text-right text-[16px] text-ink sm:text-[14px]"
                  />
                </label>
                <label className="block text-[12px] font-medium text-ink">
                  How often they pay
                  <select
                    name="frequency"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as UnitPlan["frequency"])}
                    className="mt-1 block h-11 w-full rounded-md border border-line-strong bg-paper px-3 text-[16px] text-ink sm:text-[14px]"
                  >
                    {PLAN_FREQUENCIES.map((f) => (
                      <option key={f} value={f}>
                        {FREQUENCY_WORDS[f]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[12px] font-medium text-ink sm:col-span-2">
                  Note <span className="font-normal text-mute-soft">(optional)</span>
                  <input
                    name="note"
                    defaultValue={plan?.note ?? ""}
                    placeholder="includes parking spot"
                    className="mt-1 block h-11 w-full rounded-md border border-line-strong bg-paper px-3 text-[16px] text-ink sm:text-[14px]"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={planPending} className={primary}>
                  {planPending ? "Saving…" : "Save"}
                </button>
                <button type="button" onClick={() => setEditingPlan(false)} className="h-11 px-2 text-[12px] text-mute hover:underline sm:h-8 sm:px-0">
                  Cancel
                </button>
                <span className="figures text-[13px] text-mute">{preview > 0 ? `That is ${money(preview)} ${FREQUENCY_WORDS[frequency]}.` : ""}</span>
              </div>
              {planState?.error ? <p className="text-[12px] text-bad-text">{planState.error}</p> : null}
            </form>
        </div>
        ) : null}

        {/* Property manager and the main contact, opened by its button */}
        {showManager ? (
        <div className="border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 text-[13px]">
              <div className="text-[11px] font-medium uppercase tracking-wide text-mute">Property manager</div>
              {manager ? (
                <div className="mt-0.5 space-y-0.5">
                  <div className="text-ink">
                    {manager.name}
                    {manager.company ? <span className="text-mute"> · {manager.company}</span> : null}
                  </div>
                  <div className="text-[12px] text-mute">
                    {manager.email ? (
                      <a href={`mailto:${manager.email}`} className="break-all underline underline-offset-2 hover:text-ink">
                        {manager.email}
                      </a>
                    ) : (
                      <span className="text-warning-text">no email yet</span>
                    )}
                    {manager.phone ? (
                      <>
                        {" · "}
                        <a href={`tel:${manager.phone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-2 hover:text-ink">
                          {manager.phone}
                        </a>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="mt-0.5 text-mute-soft">none</div>
              )}
            </div>
            {canEdit && !editingManager ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setEditingManager(true)} className={quiet}>
                  {manager ? "Edit" : "Add a property manager"}
                </button>
                {manager ? (
                  <button
                    type="button"
                    disabled={contactBusy}
                    onClick={() =>
                      startContact(async () => {
                        setContactError(null);
                        const r = await removePropertyManager(unitId);
                        if ("error" in r) setContactError(r.error);
                      })
                    }
                    className={quiet}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {editingManager ? (
            <form action={managerAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="unit_id" value={unitId} />
              <label className="block text-[11px] text-mute">
                Name
                <input name="manager_name" defaultValue={manager?.name ?? ""} required autoFocus className="mt-0.5 block h-11 w-full rounded-md border border-line-strong bg-paper px-2 text-[16px] text-ink sm:h-9 sm:text-[13px]" />
              </label>
              <label className="block text-[11px] text-mute">
                Company <span className="text-mute-soft">(optional)</span>
                <input name="manager_company" defaultValue={manager?.company ?? ""} className="mt-0.5 block h-11 w-full rounded-md border border-line-strong bg-paper px-2 text-[16px] text-ink sm:h-9 sm:text-[13px]" />
              </label>
              <label className="block text-[11px] text-mute">
                Email
                <input name="manager_email" type="email" defaultValue={manager?.email ?? ""} className="mt-0.5 block h-11 w-full rounded-md border border-line-strong bg-paper px-2 text-[16px] text-ink sm:h-9 sm:text-[13px]" />
              </label>
              <label className="block text-[11px] text-mute">
                Phone <span className="text-mute-soft">(optional)</span>
                <input name="manager_phone" type="tel" defaultValue={manager?.phone ?? ""} className="mt-0.5 block h-11 w-full rounded-md border border-line-strong bg-paper px-2 text-[16px] text-ink sm:h-9 sm:text-[13px]" />
              </label>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button type="submit" disabled={managerPending} className={primary}>
                  {managerPending ? "Saving…" : "Save"}
                </button>
                <button type="button" onClick={() => setEditingManager(false)} className="h-11 px-2 text-[12px] text-mute hover:underline sm:h-8 sm:px-0">
                  Cancel
                </button>
                <p className="text-[11px] text-mute-soft">
                  The manager has no sign-in. Nothing goes to them until you make them the main contact below.
                </p>
              </div>
              {managerState && "error" in managerState ? <p className="text-[11px] text-bad-text sm:col-span-2">{managerState.error}</p> : null}
            </form>
          ) : null}

          {manager ? (
            <div className="mt-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-mute">Main contact</div>
              <div role="radiogroup" aria-label="Main contact" className="mt-1 inline-flex rounded-full border border-line bg-paper p-0.5">
                {(["owner", "manager"] as const).map((who) => {
                  const active = manager.main === who;
                  const blocked = who === "manager" && !managerHasEmail;
                  return (
                    <button
                      key={who}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={!canEdit || contactBusy || blocked}
                      onClick={() => !active && choose(who)}
                      className={`inline-flex min-h-[44px] items-center rounded-full sm:min-h-[36px] px-4 text-[12px] font-medium transition-colors duration-300 disabled:cursor-not-allowed ${
                        active ? "bg-ink text-paper" : "text-mute hover:text-ink disabled:opacity-50"
                      }`}
                    >
                      {who === "owner" ? "Owner" : "Property manager"}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[11px] text-mute-soft">
                {manager.main === "manager"
                  ? `Walkup's emails for this unit (reminders, statements, announcements) go to ${manager.name}, and drafts open to them. They don't go to the owner.`
                  : `Walkup's emails for this unit go to the owner${ownerEmail ? ` (${ownerEmail})` : ""}. Choose the property manager to send them there instead.`}
                {!managerHasEmail ? " Add the manager's email to choose them." : ""}
              </p>
              {contactError ? <p className="mt-1 text-[11px] text-bad-text">{contactError}</p> : null}
            </div>
          ) : null}
        </div>
        ) : null}

        {/* Additional Agreed Assessments, opened by its button */}
        {showAdditional ? (
        <div className="border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-mute">Additional Agreed Assessments</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${additional.required ? "bg-ink text-paper" : "bg-fill text-mute"}`}
                >
                  {additional.required ? "Required" : "Voluntary"}
                </span>
              </div>
              {hasAdditional ? (
                <div className="mt-0.5">
                  <span className="figures text-ink">{money(agreed as number)}</span>
                  <span className="text-mute"> agreed for {year}</span>
                  {additional.required && additional.dueOn ? <span className="text-mute"> · due {additional.dueOn}</span> : null}
                </div>
              ) : (
                <div className="mt-0.5 text-mute-soft">no amount set</div>
              )}
              <p className="mt-1 max-w-prose text-[11px] leading-relaxed text-mute-soft">
                An extra amount this unit agrees to put toward the reserve each year, on top of regular dues.{" "}
                {additional.required
                  ? "It is required this year: it is charged to the unit, shows as owed, and payments apply to it like any charge."
                  : "It is voluntary unless a board admin makes it required: nothing is owed and it never changes the unit's standing."}{" "}
                Extra dues paid beyond the yearly plan roll over into it.
              </p>
            </div>
            {canEdit && !additional.required && !editingReserve && !recording ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setEditingReserve(true)} className={quiet}>
                  {hasAdditional ? "Edit amount" : "Set amount"}
                </button>
                <button type="button" onClick={() => setRecording(true)} className={quiet}>
                  Record a contribution
                </button>
              </div>
            ) : null}
          </div>

          {editingReserve ? (
            <form action={reserveAction} className="mt-3 flex flex-wrap items-end gap-3">
              <input type="hidden" name="unit_id" value={unitId} />
              <input type="hidden" name="mode" value={isAdmin ? mode : "voluntary"} />
              <label className="block min-w-[9rem] flex-1 text-[11px] text-mute">
                Agreed amount for {year}
                <MoneyInput name="agreed_amount" defaultValue={hasAdditional ? (agreed as number) / 100 : null} placeholder="$500" autoFocus className={`${field} mt-0.5 block`} />
              </label>
              {isAdmin ? (
                <fieldset className="flex items-center gap-4 pb-2 text-[12px] text-ink">
                  <legend className="sr-only">Voluntary or required</legend>
                  <label className="flex min-h-[44px] items-center gap-1.5 sm:min-h-0">
                    <input type="radio" checked={mode === "voluntary"} onChange={() => setMode("voluntary")} /> Voluntary
                  </label>
                  <label className="flex min-h-[44px] items-center gap-1.5 sm:min-h-0">
                    <input type="radio" checked={mode === "required"} onChange={() => setMode("required")} /> Required
                  </label>
                </fieldset>
              ) : null}
              {isAdmin && mode === "required" ? (
                <label className="block text-[11px] text-mute">
                  Due on
                  <input
                    type="date"
                    name="due_on"
                    defaultValue={lastDay}
                    min={todayKey}
                    max={lastDay}
                    required
                    className="mt-0.5 block h-11 rounded-md border border-line-strong bg-paper px-2 text-[16px] text-ink sm:h-9 sm:text-[13px]"
                  />
                </label>
              ) : null}
              <button type="submit" disabled={reservePending} className={primary}>
                {reservePending ? "Saving…" : mode === "required" && isAdmin ? "Charge it" : "Save"}
              </button>
              <button type="button" onClick={() => setEditingReserve(false)} className="h-11 px-2 text-[12px] text-mute hover:underline sm:h-8 sm:px-0">
                Cancel
              </button>
              <p className="w-full text-[11px] text-mute-soft">
                {isAdmin && mode === "required"
                  ? "Required charges the unit this amount now, as owed on the due date. It appears on their statement and a late fee can apply, like regular dues. It can't be switched back to voluntary here."
                  : "Leave it blank to end the agreement. Money already given stays on the books."}
              </p>
              {reserveState?.error ? <p className="w-full text-[11px] text-bad-text">{reserveState.error}</p> : null}
            </form>
          ) : null}

          {recording ? (
            <form action={giveAction} className="mt-3 flex flex-wrap items-end gap-3">
              <input type="hidden" name="unit_id" value={unitId} />
              <label className="block min-w-[9rem] flex-1 text-[11px] text-mute">
                Amount given
                <MoneyInput name="contribution_amount" placeholder="$250" required autoFocus className={`${field} mt-0.5 block`} />
              </label>
              <label className="block text-[11px] text-mute">
                Date received
                <input
                  type="date"
                  name="received_on"
                  defaultValue={todayKey}
                  required
                  className="mt-0.5 block h-11 rounded-md border border-line-strong bg-paper px-2 text-[16px] text-ink sm:h-9 sm:text-[13px]"
                />
              </label>
              <button type="submit" disabled={givePending} className={primary}>
                {givePending ? "Recording…" : "Record"}
              </button>
              <button type="button" onClick={() => setRecording(false)} className="h-11 px-2 text-[12px] text-mute hover:underline sm:h-8 sm:px-0">
                Cancel
              </button>
              <p className="w-full text-[11px] text-mute-soft">
                Goes to the reserve fund, as Special Assessments income for this unit. For a check, cash, or money already in the reserve
                account. If the bank feed already shows this deposit, don&rsquo;t record it here too.
              </p>
              {giveState?.error ? <p className="w-full text-[11px] text-bad-text">{giveState.error}</p> : null}
            </form>
          ) : null}
        </div>
        ) : null}
        </div>
      </div>

      {/* The year, along the bottom, the full width of the card */}
      <footer className="space-y-3 rounded-b-xl border-t border-line bg-fill/40 px-4 py-3">
        <DuesYearBar
          year={year}
          annualCents={annualCents}
          paidCents={paidCents}
          pendingCents={pendingCents}
          todayKey={todayKey}
          rolledOverCents={hasAdditional ? additional.rolledOverCents : 0}
        />
        {hasAdditional || additional.givenCents > 0 ? (
          <div
            role="group"
            aria-label={`${year} Additional Agreed Assessments: ${money(additional.givenCents)}${hasAdditional ? ` of ${money(agreed as number)}` : " given"}.`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[12px]">
              <span className="font-semibold text-ink">{year} Additional Agreed Assessments</span>
              <span className="figures text-ink">
                {money(additional.givenCents)}
                {hasAdditional ? <span className="text-mute"> of {money(agreed as number)}</span> : <span className="text-mute"> given</span>}
              </span>
            </div>
            {hasAdditional ? (
              <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-line" aria-hidden="true">
                <div className="h-full rounded-full bg-brass transition-[width] duration-500 ease-out" style={{ width: `${additional.pct}%` }} />
              </div>
            ) : null}
            {additional.rolledOverCents > 0 ? (
              <p className="mt-1 text-[11px] text-mute-soft">
                Includes {money(additional.rolledOverCents)} rolled over from extra regular dues.
              </p>
            ) : null}
          </div>
        ) : null}
      </footer>
      </>
      ) : null}
    </article>
  );
}

/** The one status on the right of a row. Past due is brick, a credit is green, a due date is navy. */
function StatusText({ status, onSetup }: { status: UnitStatus; onSetup: () => void }) {
  switch (status.kind) {
    case "paid_up":
      return <span className="whitespace-nowrap text-[13px] text-mute">Paid up</span>;
    case "due_soon":
      return (
        <span className="figures whitespace-nowrap text-[13px] font-medium text-ink">
          {money(status.cents)} due {status.dueLabel}
        </span>
      );
    case "past_due":
      return <span className="figures whitespace-nowrap text-[13px] font-semibold text-bad">{money(status.cents)} past due</span>;
    case "credit":
      return <span className="figures whitespace-nowrap text-[13px] font-medium text-good-text">{money(status.cents)} credit</span>;
    case "no_dues":
      return (
        <span className="whitespace-nowrap text-[13px] text-mute">
          No dues set up ·{" "}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSetup();
            }}
            className="underline underline-offset-2 hover:text-ink"
          >
            Set up
          </button>
        </span>
      );
  }
}
