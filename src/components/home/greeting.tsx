/**
 * "Good morning, Doug." Time of day comes from the association's own clock —
 * the server computes the hour in the building's timezone (the one state on
 * record is Illinois), which keeps this a server component with no
 * hydration mismatch. A visitor in another timezone sees the building's
 * morning, which for a board member of that building is the right morning.
 */
export function Greeting({
  firstName,
  statusLine,
  hour,
  books,
}: {
  firstName: string;
  statusLine: string;
  hour: number;
  books: { visible: boolean; balanced: boolean } | null;
}) {
  const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">
          Good {timeOfDay}, {firstName}.
        </h1>
        <p className="mt-1 text-[13px] text-mute">{statusLine}</p>
      </div>
      {books?.visible ? (
        <span
          className={`shrink-0 rounded-full border px-3 py-1 text-[12px] font-medium ${
            books.balanced
              ? "border-good-line bg-good-tint text-good-text"
              : "border-bad-line bg-bad-tint text-bad-text"
          }`}
        >
          {books.balanced ? "Books balance · checked just now" : "Books don't match — check the ledger"}
        </span>
      ) : null}
    </div>
  );
}
