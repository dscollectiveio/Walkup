"use client";

import { useActionState, useState, useTransition } from "react";
import { Card, Empty, money } from "@/components/ui";
import { chargeDuesPeriod, createDuesSchedule } from "./actions";

export interface ScheduleView {
  id: string;
  name: string;
  frequency: string;
  allocation_method: string;
  total_amount: number;
  starts_on: string;
  /** Null when the schedule hasn't started yet or has ended. */
  periodStart: string | null;
  periodLabel: string | null;
  chargedUnits: number;
}

const FREQ_LABEL: Record<string, string> = {
  monthly: "a month",
  quarterly: "a quarter",
  annual: "a year",
  one_time: "one time",
};

const inputClass = "mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink";

function firstOfNextMonth(): string {
  const d = new Date();
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`;
}

function AddScheduleForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createDuesSchedule, null);
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid"
      >
        Add a dues schedule
      </button>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-paper p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sched-name" className="block text-[12px] font-medium text-ink">
            Name
          </label>
          <input id="sched-name" name="name" defaultValue="Regular assessments" className={inputClass} />
        </div>
        <div>
          <label htmlFor="sched-frequency" className="block text-[12px] font-medium text-ink">
            Charged
          </label>
          <select id="sched-frequency" name="frequency" defaultValue="monthly" className={`${inputClass} bg-paper`}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Once a year</option>
          </select>
        </div>
        <div>
          <label htmlFor="sched-allocation" className="block text-[12px] font-medium text-ink">
            The amount is
          </label>
          <select
            id="sched-allocation"
            name="allocation_method"
            defaultValue="fixed_per_unit"
            className={`${inputClass} bg-paper`}
          >
            <option value="fixed_per_unit">The same for every unit</option>
            <option value="equal">A building total, split equally</option>
          </select>
        </div>
        <div>
          <label htmlFor="sched-amount" className="block text-[12px] font-medium text-ink">
            Amount
          </label>
          <input
            id="sched-amount"
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            placeholder="350.00"
            className={`figures ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="sched-starts" className="block text-[12px] font-medium text-ink">
            First period
          </label>
          <input id="sched-starts" name="starts_on" type="date" required defaultValue={firstOfNextMonth()} className={inputClass} />
        </div>
      </div>
      <p className="text-[11px] text-mute-soft">
        Splitting by ownership percentage isn&rsquo;t available yet — use a per-unit amount for now.
      </p>
      {state?.error ? (
        <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">{state.error}</p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save schedule"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function ChargeButton({ schedule, unitCount }: { schedule: ScheduleView; unitCount: number }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  if (!schedule.periodStart || !schedule.periodLabel) {
    return <span className="text-[11px] text-mute-soft">Starts {schedule.starts_on}</span>;
  }
  if (schedule.chargedUnits >= unitCount && unitCount > 0) {
    return (
      <span className="rounded-full border border-good-line bg-good-tint px-2 py-0.5 text-[11px] text-good-text">
        Charged for {schedule.periodLabel}
      </span>
    );
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setResult(null);
            const r = await chargeDuesPeriod(schedule.id);
            if (r.error) setResult(r.error);
            else if (r.errors && r.errors.length > 0) setResult(`${r.charged} charged; ${r.errors[0]}`);
            else setResult(null);
          })
        }
        className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Charging…" : `Charge ${schedule.periodLabel}`}
      </button>
      {schedule.chargedUnits > 0 ? (
        <span className="text-[11px] text-mute-soft">
          {schedule.chargedUnits} of {unitCount} units already charged
        </span>
      ) : null}
      {result ? <span className="max-w-[18rem] text-right text-[11px] text-bad-text">{result}</span> : null}
    </span>
  );
}

export function DuesScheduleCard({
  schedules,
  unitCount,
  canManage,
}: {
  schedules: ScheduleView[];
  unitCount: number;
  canManage: boolean;
}) {
  return (
    <Card
      title="Dues schedule"
      hint="How much each unit owes and how often. Charging a period is what makes “What's owed” real."
    >
      {schedules.length === 0 ? (
        <Empty>
          {canManage
            ? "No schedule yet — set the amount and cadence, then charge the first period."
            : "The board hasn't set a dues schedule yet."}
        </Empty>
      ) : (
        <ul className="divide-y divide-line">
          {schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="text-[13px] font-medium text-ink">{s.name}</div>
                <div className="mt-0.5 text-[12px] text-mute">
                  {money(s.total_amount)}{" "}
                  {s.allocation_method === "equal" ? "for the building, split equally" : "per unit"}
                  {", "}
                  {FREQ_LABEL[s.frequency] ?? s.frequency}
                </div>
              </div>
              {canManage ? <ChargeButton schedule={s} unitCount={unitCount} /> : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <div className="mt-4">
          <AddScheduleForm />
        </div>
      ) : null}
    </Card>
  );
}
