"use client";

import { useActionState, useState, useTransition } from "react";
import { addUpkeepTask, addUpkeepTemplates, archiveUpkeepTask, markUpkeepDone, updateUpkeepTask } from "./upkeep-actions";
import { MONTH_NAMES, UPKEEP_TEMPLATES } from "@/lib/upkeep/schedule";

const inputClass = "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink";
const btnPrimary = "rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50";
const btnGhost = "rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-50";
const link = "text-[12px] text-mute underline-offset-2 hover:text-ink hover:underline";

export interface VendorOption {
  id: string;
  name: string;
}

export interface TaskForForm {
  id: string;
  name: string;
  description: string | null;
  interval_months: number;
  due_month: number | null;
  next_due_on: string;
  vendor_id: string | null;
  estimated_cost: number | null;
}

const INTERVALS: { months: number; label: string }[] = [
  { months: 1, label: "Every month" },
  { months: 3, label: "Every 3 months" },
  { months: 6, label: "Every 6 months" },
  { months: 12, label: "Every year" },
  { months: 24, label: "Every 2 years" },
  { months: 36, label: "Every 3 years" },
  { months: 60, label: "Every 5 years" },
];

function TaskFields({ task, vendors }: { task: TaskForForm | null; vendors: VendorOption[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor={`name-${task?.id ?? "new"}`} className="block text-[12px] font-medium text-ink">
          What
        </label>
        <input id={`name-${task?.id ?? "new"}`} name="name" required defaultValue={task?.name ?? ""} placeholder="Boiler service" className={inputClass} />
      </div>
      <div>
        <label className="block text-[12px] font-medium text-ink">How often</label>
        <select name="interval_months" defaultValue={task?.interval_months ?? 12} className={inputClass}>
          {INTERVALS.map((i) => (
            <option key={i.months} value={i.months}>
              {i.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[12px] font-medium text-ink">
          Usual month <span className="font-normal text-mute">(optional)</span>
        </label>
        <select name="due_month" defaultValue={task?.due_month ?? ""} className={inputClass}>
          <option value="">Any time</option>
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[12px] font-medium text-ink">
          Who usually does it <span className="font-normal text-mute">(optional)</span>
        </label>
        <select name="vendor_id" defaultValue={task?.vendor_id ?? ""} className={inputClass}>
          <option value="">Not decided</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[12px] font-medium text-ink">
          Rough cost <span className="font-normal text-mute">(optional)</span>
        </label>
        <input name="estimated_cost" type="number" min="0" step="1" defaultValue={task?.estimated_cost ?? ""} placeholder="250" className={inputClass} />
      </div>
      <div>
        <label className="block text-[12px] font-medium text-ink">Next due</label>
        <input name="next_due_on" type="date" defaultValue={task?.next_due_on ?? ""} className={inputClass} />
        {!task ? <p className="mt-1 text-[11px] text-mute-soft">Leave blank to use the usual month.</p> : null}
      </div>
      <div className="sm:col-span-2">
        <label className="block text-[12px] font-medium text-ink">
          Notes <span className="font-normal text-mute">(optional)</span>
        </label>
        <input name="description" defaultValue={task?.description ?? ""} placeholder="Where the shut-off is, what the last guy said…" className={inputClass} />
      </div>
    </div>
  );
}

export function AddTaskForm({ vendors }: { vendors: VendorOption[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addUpkeepTask, null);
  const [prev, setPrev] = useState(state);
  if (state !== prev) {
    setPrev(state);
    if (state?.ok) setOpen(false);
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btnPrimary}>
        Add a task
      </button>
    );
  }
  return (
    <form action={action} className="space-y-3 rounded-lg border border-line bg-fill/40 p-4">
      <TaskFields task={null} vendors={vendors} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={btnGhost}>
          Cancel
        </button>
        {state?.error ? <span className="text-[12px] text-bad-text">{state.error}</span> : null}
      </div>
    </form>
  );
}

/** The usual checklist, ticked by default; the board unticks what doesn't apply. */
export function TemplatePicker({ existingNames }: { existingNames: string[] }) {
  const have = new Set(existingNames.map((n) => n.toLowerCase()));
  const available = UPKEEP_TEMPLATES.filter((t) => !have.has(t.name.toLowerCase()));
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set(available.map((t) => t.name)));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (available.length === 0) return null;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btnGhost}>
        {existingNames.length === 0 ? "Start with the usual checklist" : "Add from the usual checklist"}
      </button>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border border-line bg-fill/40 p-4">
      <p className="text-[13px] text-ink">
        The jobs most small buildings do on a calendar. Untick anything that doesn&rsquo;t apply — you can edit each one after.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {available.map((t) => (
          <li key={t.name}>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-line bg-paper px-3 py-2 has-[:checked]:border-ink">
              <input
                type="checkbox"
                checked={picked.has(t.name)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(t.name);
                  else next.delete(t.name);
                  setPicked(next);
                }}
                className="mt-1"
              />
              <span>
                <span className="block text-[13px] font-medium text-ink">{t.name}</span>
                <span className="block text-[11px] text-mute">
                  {t.description}
                  {t.due_month ? ` · ${MONTH_NAMES[t.due_month - 1]}` : ""}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || picked.size === 0}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await addUpkeepTemplates([...picked]);
              if (r.error) setError(r.error);
              else setOpen(false);
            })
          }
          className={btnPrimary}
        >
          {pending ? "Adding…" : `Add ${picked.size} task${picked.size === 1 ? "" : "s"}`}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={btnGhost}>
          Cancel
        </button>
        {error ? <span className="text-[12px] text-bad-text">{error}</span> : null}
      </div>
    </div>
  );
}

/** Row actions: mark done (date, cost, note), edit, remove. */
export function TaskActions({ task, vendors }: { task: TaskForForm; vendors: VendorOption[] }) {
  const [mode, setMode] = useState<"idle" | "done" | "edit">("idle");
  const [doneState, doneAction, donePending] = useActionState(markUpkeepDone, null);
  const [editState, editAction, editPending] = useActionState(updateUpkeepTask, null);
  const [prevDone, setPrevDone] = useState(doneState);
  const [prevEdit, setPrevEdit] = useState(editState);
  const [archiving, startArchive] = useTransition();
  const [archiveError, setArchiveError] = useState<string | null>(null);
  if (doneState !== prevDone) {
    setPrevDone(doneState);
    if (doneState?.ok) setMode("idle");
  }
  if (editState !== prevEdit) {
    setPrevEdit(editState);
    if (editState?.ok) setMode("idle");
  }
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  if (mode === "done") {
    return (
      <form action={doneAction} className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-fill/40 p-3">
        <input type="hidden" name="id" value={task.id} />
        <label className="block text-[11px] text-mute">
          Done on
          <input name="done_on" type="date" defaultValue={todayIso} max={todayIso} className="mt-0.5 block h-8 rounded-md border border-line-strong bg-paper px-2 text-[13px] text-ink" />
        </label>
        <label className="block text-[11px] text-mute">
          Cost
          <input name="cost" type="number" min="0" step="0.01" placeholder="0" className="figures mt-0.5 block h-8 w-24 rounded-md border border-line-strong bg-paper px-2 text-[13px] text-ink" />
        </label>
        <label className="block text-[11px] text-mute">
          Who did it
          <select name="vendor_id" defaultValue={task.vendor_id ?? ""} className="mt-0.5 block h-8 rounded-md border border-line-strong bg-paper px-2 text-[13px] text-ink">
            <option value="">—</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-[12rem] flex-1 text-[11px] text-mute">
          Note
          <input name="note" placeholder="Anything worth remembering next time" className="mt-0.5 block h-8 w-full rounded-md border border-line-strong bg-paper px-2 text-[13px] text-ink" />
        </label>
        <button type="submit" disabled={donePending} className="h-8 rounded-md bg-ink px-3 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50">
          {donePending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setMode("idle")} className={link}>
          Cancel
        </button>
        {doneState?.error ? <span className="w-full text-[11px] text-bad-text">{doneState.error}</span> : null}
      </form>
    );
  }

  if (mode === "edit") {
    return (
      <form action={editAction} className="mt-2 space-y-3 rounded-lg border border-line bg-fill/40 p-3">
        <input type="hidden" name="id" value={task.id} />
        <TaskFields task={task} vendors={vendors} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={editPending} className={btnPrimary}>
            {editPending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setMode("idle")} className={btnGhost}>
            Cancel
          </button>
          <button
            type="button"
            disabled={archiving}
            onClick={() =>
              startArchive(async () => {
                setArchiveError(null);
                const r = await archiveUpkeepTask(task.id);
                if (r.error) setArchiveError(r.error);
              })
            }
            className="ml-auto text-[12px] text-bad-text underline-offset-2 hover:underline"
          >
            {archiving ? "Removing…" : "Remove from the schedule"}
          </button>
          {editState?.error ? <span className="w-full text-[12px] text-bad-text">{editState.error}</span> : null}
          {archiveError ? <span className="w-full text-[12px] text-bad-text">{archiveError}</span> : null}
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => setMode("done")}
        className="inline-flex h-8 items-center rounded-md bg-ink px-3 text-[12px] font-medium text-paper hover:bg-ink-mid"
      >
        Mark done
      </button>
      <button type="button" onClick={() => setMode("edit")} className={link}>
        Edit
      </button>
    </div>
  );
}
