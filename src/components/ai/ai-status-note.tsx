"use client";

import Link from "next/link";
import type { AiFailure } from "@/lib/ai/errors";

/**
 * Why an AI step didn't happen, and what to do instead (foundation-spec 10.1).
 * A left-ruled note that starts with a bold leading word, so the meaning
 * never depends on colour alone. Owners never see these (10.3): owner-facing
 * AI degrades silently.
 */

type Code = AiFailure["code"];
type Tone = "neutral" | "warning";

const RETRY_CODES: ReadonlySet<Code> = new Set<Code>([
  "timeout", "busy", "unreachable", "bad_output", "incomplete", "unknown", "quota_unknown",
]);

/** Tone, leading word and whether a retry is offered, per code. Exported for tests. */
export function statusNoteStyle(code: Code): { tone: Tone; lead: string; retry: boolean } {
  switch (code) {
    case "not_configured":
      return { tone: "neutral", lead: "By hand:", retry: false };
    case "quota":
      return { tone: "warning", lead: "Limit reached:", retry: false };
    case "refused":
    case "bad_request":
    case "too_long":
    case "unsupported_file":
      return { tone: "warning", lead: "Couldn't do this:", retry: false };
    case "rejected_key":
      return { tone: "neutral", lead: "Unavailable:", retry: false };
    default:
      return { tone: "warning", lead: "Couldn't finish:", retry: RETRY_CODES.has(code) };
  }
}

export const NOT_COUNTED = "This didn't count toward today's limit.";

const TONE = {
  neutral: "border-neutral bg-neutral-tint text-neutral-text",
  warning: "border-warning bg-warning-tint text-warning-text",
} as const;

export function AiStatusNote(props: {
  failure: Pick<AiFailure, "code" | "reason" | "counted">;
  onRetry?: () => void;
  byHandHref?: string;
  byHandLabel?: string;
}) {
  const { failure, onRetry, byHandHref, byHandLabel } = props;
  const style = statusNoteStyle(failure.code);
  const showRetry = style.retry && Boolean(onRetry);

  return (
    <div className={`border-l-[3px] px-4 py-3 text-[13px] leading-relaxed ${TONE[style.tone]}`}>
      <p>
        <strong className="font-bold">{style.lead}</strong> {failure.reason}
        {style.retry && failure.counted === false ? ` ${NOT_COUNTED}` : null}
      </p>
      {showRetry || byHandHref ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {showRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill"
            >
              Try again
            </button>
          ) : null}
          {byHandHref ? (
            <Link
              href={byHandHref}
              className="inline-flex min-h-[44px] items-center rounded-md px-2 py-2 text-[13px] font-medium text-ink underline underline-offset-2"
            >
              {byHandLabel ?? "Do it by hand"}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
