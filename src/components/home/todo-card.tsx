import type { ReactNode } from "react";
import { RestoreSetupButton } from "./restore-setup-button";

/**
 * The Dashboard's setup card, headed "Set up your building" (the header lives in the setup panel). What most needs a
 * board member now rides in the banner at the top of the Dashboard (announcements-strip.tsx), not here. Once setup
 * is hidden with "Skip for now" and is not finished, a slim card offers to bring it back (board admin).
 */
export function TodoCard({
  setup,
  canRestoreSetup = false,
}: {
  /** Builds the setup panel, or null when setup is done or hidden. */
  setup: (() => ReactNode) | null;
  /** Setup was hidden with "Skip for now" and is not finished: offer a way to bring it back (board admin). */
  canRestoreSetup?: boolean;
}) {
  if (setup) {
    return (
      <section aria-labelledby="setup-guide-title" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-paper">
        {setup()}
      </section>
    );
  }
  if (!canRestoreSetup) return null;
  return (
    <section aria-labelledby="todo-card-title" className="shrink-0 overflow-hidden rounded-xl border border-line bg-paper">
      <header className="flex min-h-[4rem] items-center justify-between gap-3 band bg-ink px-5 py-3">
        <div className="min-w-0">
          <h2 id="todo-card-title" className="eyebrow text-paper">
            Set up your building
          </h2>
          <p className="mt-0.5 text-[12px] text-ondark-mute">You hid the setup guide. Bring it back any time; nothing was lost.</p>
        </div>
        <RestoreSetupButton />
      </header>
    </section>
  );
}
