import Link from "next/link";

export function money(numeric: string | number | null): string {
  const n = numeric === null ? 0 : Number(numeric);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
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
    <section className="rounded-lg border border-stone-200 bg-white">
      <header className="border-b border-stone-100 px-5 py-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-stone-500">{hint}</p> : null}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  tone = "neutral",
  note,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
  note?: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-red-700"
        : "text-stone-900";
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-5 py-4">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`tabular mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {note ? <div className="mt-1 text-xs text-stone-500">{note}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-stone-500">{children}</p>;
}

/**
 * Shown when RLS returns nothing. Distinguishing "no data" from "not permitted"
 * matters: an owner who sees a blank delinquency report should understand it is
 * scoped to them, not that the association has no arrears.
 */
export function Restricted({ what }: { what: string }) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-white px-5 py-8 text-center">
      <p className="text-sm text-stone-600">
        You do not have access to {what} for this association.
      </p>
      <p className="mt-1 text-xs text-stone-400">
        Owners see their own unit only. Ask a board member if you need more.
      </p>
    </div>
  );
}

export function Provisional({ children }: { children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4">
      <p className="text-sm font-medium text-amber-900">
        Provisional — not reviewed by a CPA
      </p>
      <p className="mt-1 text-xs leading-relaxed text-amber-800">
        {children ??
          "These figures were computed from tax parameters that carry no verification date. Nobody has checked them against current-year IRS instructions."}
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
