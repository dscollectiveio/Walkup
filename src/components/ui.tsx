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

/**
 * A zero in an aging bucket or table cell is the absence of data, not a
 * fact worth stating — rendering it as an em-dash instead of "$0.00" lets
 * the one meaningful number in a row carry the row.
 */
export function MoneyOrDash({
  value,
  className = "text-ink",
}: {
  value: string | number | null;
  className?: string;
}) {
  const n = value === null ? 0 : Number(value);
  if (n === 0) return <span className="text-line-strong">—</span>;
  return <span className={className}>{money(value)}</span>;
}

/**
 * The five status tone families from WALKUP_BRAND.md section 5. Every
 * consumer of a status must pair the tint with its own text stop — never mix
 * a tint from one row with text from another.
 */
const STATUS = {
  good: { rule: "border-good", bg: "bg-good-tint", text: "text-good-text" },
  warning: { rule: "border-warning", bg: "bg-warning-tint", text: "text-warning-text" },
  bad: { rule: "border-bad", bg: "bg-bad-tint", text: "text-bad-text" },
  info: { rule: "border-info", bg: "bg-info-tint", text: "text-info-text" },
  neutral: { rule: "border-neutral", bg: "bg-neutral-tint", text: "text-neutral-text" },
} as const;

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
    <section className="rounded-xl border border-line bg-paper">
      <header className="border-b border-line px-5 py-4">
        <h2 className="font-semibold tracking-tight text-ink">{title}</h2>
        {hint ? <p className="mt-1 text-[13px] text-mute">{hint}</p> : null}
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
 *
 * Styled as the brass-hairline signature element (section 9): a left rule in
 * the status color with square corners, not a rounded tinted card. Status is
 * never carried by the rule alone — the headline says it in words too.
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
  const tone = STATUS[status === "attention" ? "warning" : status];

  return (
    <section className={`border-l-[3px] ${tone.rule} ${tone.bg} px-5 py-4`}>
      <h2 className={`text-lg font-semibold tracking-tight ${tone.text}`}>
        {headline}
      </h2>
      {detail ? (
        <p className={`mt-1 text-[13px] leading-relaxed ${tone.text} opacity-90`}>
          {detail}
        </p>
      ) : null}
      {children ? <div className="mt-3">{children}</div> : null}
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
    tone === "good" ? "text-good-text" : tone === "bad" ? "text-bad-text" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-paper px-5 py-4">
      <div className="text-[11px] text-mute">{label}</div>
      <div className={`figures mt-1 text-[26px] ${toneClass}`}>{value}</div>
      {note ? <div className="mt-1 text-[13px] text-mute">{note}</div> : null}
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
        className="cursor-help text-[11px] text-mute-soft underline decoration-dotted underline-offset-2"
      >
        ({term})
      </span>
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[13px] text-mute">{children}</p>;
}

export function Restricted({ what }: { what: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-paper px-5 py-10 text-center">
      <p className="text-ink">You don&rsquo;t have access to {what}.</p>
      <p className="mt-2 text-[13px] text-mute">
        Owners can see their own unit. Ask a board member if you need more.
      </p>
    </div>
  );
}

export function Provisional({ children }: { children?: React.ReactNode }) {
  const tone = STATUS.warning;
  return (
    <div className={`border-l-[3px] ${tone.rule} ${tone.bg} px-5 py-4`}>
      <p className={`font-medium ${tone.text}`}>
        Have an accountant check this before you file
      </p>
      <p className={`mt-1 text-[13px] leading-relaxed ${tone.text} opacity-90`}>
        {children ??
          "Walkup works out these numbers from your records, but nobody has checked the tax rules against this year's IRS instructions. Treat it as a solid draft, not a finished return."}
      </p>
    </div>
  );
}

export function UnitLink({ id, label }: { id: string; label: string }) {
  return (
    <Link
      href={`/units/${id}`}
      className="font-medium text-ink underline-offset-2 hover:underline"
    >
      {label}
    </Link>
  );
}
