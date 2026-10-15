import Link from "next/link";

const STEPS = [
  { key: "options", label: "Your books" },
  { key: "fix", label: "Fix problems" },
  { key: "preview", label: "Preview" },
  { key: "done", label: "Done" },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

export function Steps({ batchId, current, canJump }: { batchId: string; current: StepKey; canJump: boolean }) {
  const index = STEPS.findIndex((s) => s.key === current);
  return (
    <nav aria-label="Import steps">
      <ol className="flex flex-wrap gap-2 text-[12px]">
        {STEPS.map((s, i) => {
          const state = i < index ? "past" : i === index ? "current" : "next";
          const cls =
            state === "current"
              ? "bg-ink text-paper"
              : state === "past"
                ? "bg-fill text-ink"
                : "border border-line text-mute";
          const body = (
            <span className={`inline-flex items-center rounded-full px-3 py-1 font-medium ${cls}`} aria-current={state === "current" ? "step" : undefined}>
              {i + 1}. {s.label}
            </span>
          );
          return (
            <li key={s.key}>
              {canJump && s.key !== "done" && state !== "current" ? (
                <Link href={`/building/import/${batchId}?step=${s.key}`}>{body}</Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
