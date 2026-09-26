import Link from "next/link";
import { Lockup } from "@/components/mark";

/**
 * Shared chrome for the public policy pages (/security, /privacy,
 * /policies/*). Pulled out once these grew from two pages to five, rather
 * than copy the same header/Section markup a third and fourth time.
 */
export function PolicyPage({
  title,
  subtitle,
  intro,
  children,
}: {
  title: string;
  subtitle: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl py-16">
      <Link href="/">
        <Lockup />
      </Link>

      <h1 className="mt-8 text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-2 text-[13px] text-mute-soft">{subtitle}</p>

      {intro ? <p className="mt-6 text-[13px] leading-relaxed text-mute">{intro}</p> : null}

      {children}

      <p className="mt-10 text-[13px]">
        <Link href="/policies" className="text-ink underline-offset-2 hover:underline">
          &larr; All policies
        </Link>
      </p>
    </div>
  );
}

export function PolicySection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      <div className="mt-2 space-y-3 text-[13px] leading-relaxed text-mute">{children}</div>
    </section>
  );
}

export function PolicyList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function PolicyTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-mute">
            {headers.map((h) => (
              <th key={h} className="pb-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="py-2 pr-4 align-top text-ink">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
