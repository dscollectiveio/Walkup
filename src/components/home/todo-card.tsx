import type { ReactNode } from "react";
import type { UrgentItem } from "@/lib/home/urgent-items";
import { WorthAMinute } from "./worth-a-minute";
import { RestoreSetupButton } from "./restore-setup-button";

/**
 * The Dashboard's to-do card. While setup is going, the card is headed "Set up your building" (the header lives
 * in the setup panel, which is handed the urgent notices to show right under it). Once setup is hidden it is
 * headed "To-do" with the notices below.
 */
export function TodoCard({
  items,
  emptyNote,
  setup,
  canRestoreSetup = false,
}: {
  items: UrgentItem[];
  emptyNote: string;
  /** Builds the setup panel around the notices, or null when setup is done or hidden. */
  setup: ((notices: ReactNode) => ReactNode) | null;
  /** Setup was hidden with "Skip for now" and is not finished: offer a way to bring it back (board admin). */
  canRestoreSetup?: boolean;
}) {
  const notices = (
    <div className="shrink-0">
      <WorthAMinute items={items} emptyNote={emptyNote} />
    </div>
  );
  return (
    <section aria-labelledby={setup ? "setup-guide-title" : "todo-card-title"} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-paper">
      {setup ? (
        setup(notices)
      ) : (
        <>
          <header className="flex min-h-[4rem] shrink-0 items-center justify-between gap-3 band bg-ink px-5 py-3">
            <div className="min-w-0">
              <h2 id="todo-card-title" className="eyebrow text-paper">
                To-do
              </h2>
              <p className="mt-0.5 text-[12px] text-ondark-mute">What most needs a board member today, most important first.</p>
            </div>
            {canRestoreSetup ? <RestoreSetupButton /> : null}
          </header>
          {notices}
        </>
      )}
    </section>
  );
}
