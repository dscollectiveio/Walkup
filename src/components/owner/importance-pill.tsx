import { Pill } from "@/components/repairs/pills";
import { IMPORTANCE_LABEL, type Importance } from "@/lib/owner/announcements";

/** "Important" or "Urgent" as a pill; a normal post shows nothing. */
export function ImportancePill({ importance }: { importance: Importance }) {
  if (importance === "normal") return null;
  return <Pill tone={importance === "urgent" ? "bad" : "warning"}>{IMPORTANCE_LABEL[importance]}</Pill>;
}
