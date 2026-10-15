import { Info } from "lucide-react";

/**
 * A small "written by AI" label, placed next to the thing the person decides
 * on (the draft's actions, a summary's save button, a triage suggestion, the
 * extracted values' save button), never in a page footer (foundation-spec 10.5).
 */

export type AiWrittenVariant = "draft" | "summary" | "triage" | "reading";

/** Pure, for tests. */
export function aiWrittenText(variant: AiWrittenVariant, from?: string, checkAgainst?: string): string {
  switch (variant) {
    case "draft":
      return "Written by AI. Read and edit it before you send it.";
    case "summary":
      return `Written by AI from ${from ?? "your documents"}. Check it against ${checkAgainst ?? "the original"}.`;
    case "triage":
      return "Suggested by AI from the description. The board decides.";
    case "reading":
      return `Read by AI from ${from ?? "your document"}. Check each value before you save it.`;
  }
}

export function AiWritten(props: {
  variant: AiWrittenVariant;
  from?: string;          // summary/reading: what it was made from, e.g. "your policy's details"
  checkAgainst?: string;  // summary: e.g. "the policy"
}) {
  return (
    <p className="flex items-start gap-1.5 text-[12px] text-mute">
      <Info aria-hidden="true" className="mt-[2px] h-3.5 w-3.5 shrink-0" />
      <span>{aiWrittenText(props.variant, props.from, props.checkAgainst)}</span>
    </p>
  );
}
