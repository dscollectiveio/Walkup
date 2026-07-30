import Link from "next/link";

export function money(numeric: string | number | null): string {
  const n = numeric === null ? 0 : Number(numeric);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

/** Money without cents, for headline figures where precision is noise. */
export function moneyRounded(numeric: string | number | null): string {
  const n = numeric === null ? 0 : Number(numeric);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white">
      <header className="border-b border-stone-100 px-5 py-4">
        <h2 className="font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="mt-1 text-sm text-stone-500">{hint}</p> : null}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/**
 * A headline answer in plain language, with the number as support.
 *
 * The user is a board member with no accounting training doing this unpaid in
 * the evenings. They need to know whether something is wrong, not to derive it
 * from a figure. So the sentence comes first and the number second — the
 * reverse of how an accounting package would show it.
 */
export function Answer({
  status,
  headline,
  detail,
  children,
}: {
  status: "good" | "attention" | "bad" | "neutral";
  headline: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  const tone = {
    good: { box: "border-emerald-200 bg-emerald-50", text: "text-emerald-900", dot: "bg-emerald-500" },
    attention: { box: "border-amber-200 bg-amber-50", text: "text-amber-900", dot: "bg-amber-500" },
    bad: { box: "border-red-200 bg-red-50", text: "text-red-900", dot: "bg-red-500" },
    neutral: { box: "border-stone-200 bg-white", text: "text-stone-900", dot: "bg-stone-400" },
  }[status];

  return (
    <section className={`rounded-xl border p-5 ${tone.box}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
        <div>
          <h2 className={`text-lg font-semibold tracking-tight ${tone.text}`}>
            {headline}
          </h2>
          {detail ? (
            <p className={`mt-1 text-sm leading-relaxed ${tone.text} opacity-90`}>
              {detail}
            </p>
          ) : null}
          {children ? <div className="mt-3">{children}</div> : null}
        </div>
      </div>
    </section>
  );
}

export function Stat({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const toneClass =
    tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-stone-900";
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-5 py-4">
      <div className="text-sm text-stone-500">{label}</div>
      <div className={`tabular mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {note ? <div className="mt-1 text-sm text-stone-500">{note}</div> : null}
    </div>
  );
}

/**
 * Accounting jargon with its plain meaning attached.
 *
 * The terms cannot simply be removed — an accountant or a CPA reviewing the
 * return needs the real vocabulary, and so does the next board. So the plain
 * words lead and the technical term follows, rather than the other way round.
 */
export function Jargon({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap">
      {children}{" "}
      <span
        title={term}
        className="cursor-help text-xs text-stone-400 underline decoration-dotted underline-offset-2"
      >
        ({term})
      </span>
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-stone-500">{children}</p>;
}

export function Restricted({ what }: { what: string }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-white px-5 py-10 text-center">
      <p className="text-stone-700">You don&rsquo;t have access to {what}.</p>
      <p className="mt-2 text-sm text-stone-500">
        Owners can see their own unit. Ask a board member if you need more.
      </p>
    </div>
  );
}

export function Provisional({ children }: { children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
      <p className="font-medium text-amber-900">
        Have an accountant check this before you file
      </p>
      <p className="mt-1 text-sm leading-relaxed text-amber-900/90">
        {children ??
          "Walkup works out these numbers from your records, but nobody has checked the tax rules against this year's IRS instructions. Treat it as a solid draft, not a finished return."}
      </p>
    </div>
  );
}

export function UnitLink({ id, label }: { id: string; label: string }) {
  return (
    <Link href={`/units/${id}`} className="font-medium underline-offset-2 hover:underline">
      {label}
    </Link>
  );
}
