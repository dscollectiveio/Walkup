"use client";

import Link from "next/link";
import { useActionState, useOptimistic, useState, useTransition } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { DerivedTask } from "@/lib/home/setup-tasks";
import { addBoardTask, toggleBoardTask } from "@/app/home-actions";

export interface ManualTask {
  id: string;
  title: string;
  completedAt: string | null;
  ownerName: string | null;
  isYou: boolean;
}

function formatDone(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The checklist. Two kinds of rows, deliberately different:
 * - Derived rows tick themselves from actual state and are not toggleable —
 *   completing one happens by doing the thing, so the row links there.
 * - Manual rows persist to board_tasks and toggle optimistically, then
 *   reconcile with the server response.
 */
export function YourList({
  derived,
  manual,
  persons,
}: {
  derived: DerivedTask[];
  manual: ManualTask[];
  persons: { id: string; full_name: string }[];
}) {
  const [, startTransition] = useTransition();
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [optimisticManual, applyToggle] = useOptimistic(
    manual,
    (state, update: { id: string; completed: boolean }) =>
      state.map((t) =>
        t.id === update.id
          ? { ...t, completedAt: update.completed ? new Date().toISOString() : null }
          : t,
      ),
  );
  const [addState, addAction, addPending] = useActionState(addBoardTask, null);
  const [adding, setAdding] = useState(false);

  if (addState?.ok && adding) setAdding(false);

  const done =
    derived.filter((t) => t.done).length + optimisticManual.filter((t) => t.completedAt).length;
  const total = derived.length + optimisticManual.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  function toggle(id: string, completed: boolean) {
    setToggleError(null);
    startTransition(async () => {
      applyToggle({ id, completed });
      const result = await toggleBoardTask(id, completed);
      if (result.error) setToggleError(result.error);
      // revalidatePath in the action reconciles the list either way.
    });
  }

  return (
    <section className="rounded-xl border border-line bg-paper">
      <header className="border-b border-line px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold tracking-tight text-ink">Your list</h2>
          <span className="tabular text-[12px] text-mute">
            {done} of {total} done
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-fill">
          <div className="h-full rounded-full bg-moss transition-all" style={{ width: `${pct}%` }} />
        </div>
      </header>

      <ul className="divide-y divide-line px-5">
        {derived.map((task) => (
          <li key={task.name} className="flex items-center gap-3 py-3">
            <span
              aria-hidden="true"
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                task.done ? "border-moss bg-moss text-paper" : "border-line-strong bg-fill"
              }`}
            >
              {task.done ? <Check size={11} strokeWidth={2.5} /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-[13px] ${task.done ? "text-mute" : "font-medium text-ink"}`}>
                {task.name}
              </span>
              <span className="mt-0.5 block text-[11px] text-mute-soft">{task.detail}</span>
            </span>
            {task.done ? (
              <span className="shrink-0 rounded-full border border-good-line bg-good-tint px-2 py-0.5 text-[11px] text-good-text">
                Done{task.doneOn ? ` ${formatDone(task.doneOn)}` : ""}
              </span>
            ) : (
              <Link
                href={task.href}
                aria-label={`Open ${task.name}`}
                className="shrink-0 text-mute-soft hover:text-ink"
              >
                <ChevronRight size={15} strokeWidth={1.75} aria-hidden="true" />
              </Link>
            )}
          </li>
        ))}

        {optimisticManual.map((task) => (
          <li key={task.id} className="flex items-center gap-3 py-3">
            <button
              type="button"
              role="checkbox"
              aria-checked={Boolean(task.completedAt)}
              aria-label={`${task.completedAt ? "Reopen" : "Complete"}: ${task.title}`}
              onClick={() => toggle(task.id, !task.completedAt)}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                task.completedAt
                  ? "border-moss bg-moss text-paper"
                  : "border-line-strong bg-paper hover:border-mute"
              }`}
            >
              {task.completedAt ? <Check size={11} strokeWidth={2.5} aria-hidden="true" /> : null}
            </button>
            <span className="min-w-0 flex-1">
              <span
                className={`block text-[13px] ${
                  task.completedAt ? "text-mute line-through decoration-line-strong" : "font-medium text-ink"
                }`}
              >
                {task.title}
              </span>
            </span>
            {task.ownerName ? (
              <span className="shrink-0 rounded-full border border-line bg-fill px-2 py-0.5 text-[11px] text-mute">
                {task.isYou ? "You" : task.ownerName.split(" ")[0]}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="border-t border-line px-5 py-3">
        {toggleError ? <p className="mb-2 text-[12px] text-bad-text">{toggleError}</p> : null}
        {adding ? (
          <form action={addAction} className="flex flex-wrap items-center gap-2">
            <label htmlFor="task_title" className="sr-only">
              Task name
            </label>
            <input
              id="task_title"
              name="title"
              required
              placeholder="Get a snow contract"
              className="min-w-0 flex-1 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] text-ink"
            />
            <label htmlFor="task_owner" className="sr-only">
              Who owns it
            </label>
            <select
              id="task_owner"
              name="owner_person_id"
              defaultValue=""
              className="rounded-lg border border-line-strong bg-paper px-2 py-1.5 text-[12px] text-ink"
            >
              <option value="">No owner</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={addPending}
              className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
            >
              {addPending ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-[12px] text-mute underline-offset-2 hover:underline"
            >
              Cancel
            </button>
            {addState?.error ? (
              <p className="w-full text-[12px] text-bad-text">{addState.error}</p>
            ) : null}
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-[12px] text-mute underline-offset-2 hover:underline"
          >
            Add a task
          </button>
        )}
      </div>
    </section>
  );
}
