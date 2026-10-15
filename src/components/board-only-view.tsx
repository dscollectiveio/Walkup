import Link from "next/link";
import type { BoardContact } from "@/lib/owner/viewer-types";
import { mailtoLink } from "@/lib/email/mailto";

/** Presentational half of BoardOnly (server-safe, no data access), so it renders in a unit test. */
export function BoardOnlyView({
  what,
  why,
  alternative,
  contact,
}: {
  what: string;
  why: string;
  alternative?: { label: string; href: string };
  contact: BoardContact | null;
}) {
  const who = contact?.name ?? "the board";
  return (
    <div className="mx-auto w-full max-w-[640px]">
      <section className="rounded-xl border border-line bg-paper px-5 py-8">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">This part is for the board</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink">
          {what} is open to board members and the accountant. {why}
        </p>
        {alternative ? (
          <p className="mt-5">
            <Link
              href={alternative.href}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid"
            >
              {alternative.label}
            </Link>
          </p>
        ) : null}
        <p className="mt-5 text-[13px] text-mute">
          {contact?.email ? (
            <>
              Questions? Write to{" "}
              <a href={mailtoLink(contact.email)} className="text-ink underline underline-offset-2">
                {who}
              </a>
              .
            </>
          ) : (
            <>Questions? Ask a board member.</>
          )}
        </p>
      </section>
    </div>
  );
}
