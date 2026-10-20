import type { ReactNode } from "react";
import type { UrgentItem } from "@/lib/home/urgent-items";
import { WorthAMinute } from "./worth-a-minute";

/**
 * The Dashboard's to-do card: "Worth a minute today" as a small subsection on
 * top, and below it, while setup is still going, "Set up your building"
 * (passed in, since it is a client component with its own state).
 */
export function TodoCard({ items, emptyNote, setup }: { items: UrgentItem[]; emptyNote: string; setup: ReactNode | null }) {
  return (
    <section aria-labelledby="todo-card-title" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-paper">
      <header className="flex min-h-[4rem] shrink-0 flex-col justify-center band bg-ink px-5 py-3">
        <h2 id="todo-card-title" className="eyebrow text-paper">
          To-do and setup
        </h2>
        <p className="mt-0.5 text-[12px] text-ondark-mute">
          {setup ? "What needs a minute today, then what is left to set up." : "What most needs a board member today, most important first."}
        </p>
      </header>
      <div className="shrink-0">
        <WorthAMinute items={items} emptyNote={emptyNote} />
      </div>
      {setup}
    </section>
  );
}
