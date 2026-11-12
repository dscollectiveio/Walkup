import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";

export type ConnectionHealth =
  "connected" | "checking" | "needs_signin" | "problem";

/** Word, icon and color for each state. The word carries the meaning; color and icon only back it up. */
const LOOK = {
  connected: { word: "Connected", Icon: CheckCircle2, tone: "text-moss" },
  checking: { word: "Checking", Icon: RefreshCw, tone: "text-mute" },
  needs_signin: {
    word: "Needs sign-in",
    Icon: AlertTriangle,
    tone: "text-warning-text",
  },
  problem: { word: "Problem", Icon: XCircle, tone: "text-bad-text" },
} as const;

/**
 * One bank connection's health: a status word with an icon, and the time of
 * the last sync in light grey beside it. Every account at the bank shares the
 * bank's login, so this sits on the bank's line rather than on each account.
 */
export function ConnectionStatus({
  health,
  syncedText,
  detail,
  actions,
}: {
  health: ConnectionHealth;
  /** e.g. "synced 5 minutes ago" */
  syncedText: string;
  /** What the problem is, in plain words, shown on hover. */
  detail?: string;
  /** Sync now and the manage menu, on the same line: they act on the whole bank login. */
  actions?: ReactNode;
}) {
  const { word, Icon, tone } = LOOK[health];
  return (
    <div
      className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px]"
      title={detail}
    >
      <span className={`inline-flex items-center gap-1 font-medium ${tone}`}>
        <Icon size={13} strokeWidth={2} aria-hidden="true" />
        {word}
      </span>
      <span className="text-mute-soft">· {syncedText}</span>
      {actions}
    </div>
  );
}
