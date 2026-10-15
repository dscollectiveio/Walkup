import Link from "next/link";
import { findHref, toggleWant, WANT_LABEL } from "@/lib/contractors/find-params";
import { JOB_WANTS, type JobWant } from "@/lib/contractors/ranking";

/**
 * "What matters for this job" (repairs-spec §9.1 item 2): four toggles,
 * each a GET link that adds or removes `want=`. They change the ranking,
 * the reasons shown and the web search's wording; they never hide anyone.
 * Links rather than client state, so the choice survives a reload and the
 * web search's cache key matches what the page shows.
 */
export function WantsBar(props: {
  ticket?: string | null;
  task?: string | null;
  trade: string;
  phrase: string;
  wants: JobWant[];
}) {
  return (
    <div>
      <p id="wants-label" className="text-[13px] font-medium text-ink">
        What matters for this job
      </p>
      <div role="group" aria-labelledby="wants-label" className="mt-2 flex flex-wrap gap-2">
        {JOB_WANTS.map((w) => {
          const on = props.wants.includes(w);
          return (
            <Link
              key={w}
              role="button"
              aria-pressed={on}
              scroll={false}
              replace
              href={findHref({ ticket: props.ticket, task: props.task, trade: props.trade, phrase: props.phrase, wants: toggleWant(props.wants, w) })}
              className={`inline-flex min-h-[44px] items-center rounded-full border px-4 text-[13px] ${
                on ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-ink hover:bg-fill"
              }`}
            >
              {WANT_LABEL[w]}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
