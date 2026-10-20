// One color per urgency, used wherever urgency is chosen: Low is green, Normal
// is gold, Urgent is red. Color never carries it alone; each option still says
// its word. Class names are written out in full so Tailwind can see them.

import type { TicketPriority } from "./labels";

export const PRIORITY_TONE: Record<
  TicketPriority,
  { option: string; select: string; text: string }
> = {
  low: {
    option:
      "border-good-line bg-good-tint text-good-text has-[:checked]:border-good has-[:checked]:ring-2 has-[:checked]:ring-good/30 accent-[var(--color-good)]",
    select: "border-good-line bg-good-tint text-good-text",
    text: "text-good-text",
  },
  normal: {
    option:
      "border-warning-line bg-warning-tint text-warning-text has-[:checked]:border-warning has-[:checked]:ring-2 has-[:checked]:ring-warning/30 accent-[var(--color-warning)]",
    select: "border-warning-line bg-warning-tint text-warning-text",
    text: "text-warning-text",
  },
  urgent: {
    option:
      "border-bad-line bg-bad-tint text-bad-text has-[:checked]:border-bad has-[:checked]:ring-2 has-[:checked]:ring-bad/30 accent-[var(--color-bad)]",
    select: "border-bad-line bg-bad-tint text-bad-text",
    text: "text-bad-text",
  },
};
