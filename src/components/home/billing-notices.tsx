import { noticeBanner, type BillingNotice } from "@/lib/billing/notices";

const TONE = {
  attention: "border-warning-line bg-warning-tint text-warning-text",
  neutral: "border-info-line bg-info-tint text-info-text",
} as const;

/**
 * The notices the Terms promise (a price change, read-only, the end of early access, the end of a founding
 * year), shown to the board in Walkup as well as by email. One slim block per notice; nothing when there are none.
 */
export function BillingNotices({ notices }: { notices: BillingNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <section aria-label="Notices about your Walkup plan" className="flex flex-col gap-2">
      {notices.map((n) => {
        const b = noticeBanner(n);
        return (
          <div key={n.id} className={`rounded-xl border px-5 py-3 ${TONE[b.tone]}`}>
            <p className="text-[14px] font-semibold">{b.headline}</p>
            {b.detail ? <p className="mt-0.5 text-[13px] opacity-90">{b.detail}</p> : null}
          </div>
        );
      })}
    </section>
  );
}
