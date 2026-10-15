import Link from "next/link";

/** The heading on every insurance tab (§9): the blurb depends on who is reading. */
export function InsuranceHeader({ isBoard }: { isBoard: boolean }) {
  return (
    <div>
      <h1 className="text-[20px] font-bold tracking-tight text-ink">Insurance</h1>
      <p className="mt-1 text-mute">
        {isBoard
          ? "Your policies, what they cover, what's missing, and who to ask."
          : "The association's policies and premiums."}
      </p>
    </div>
  );
}

/** The decision-point disclaimer (§9): Coverage check, Marketplace, Compare, Request quotes. */
export const DISCLAIMER =
  "Walkup organises your insurance and finds options. It isn't an insurance broker and doesn't give insurance or legal advice. Your agent can confirm what fits your building.";

export function Disclaimer() {
  return <p className="text-[12px] leading-relaxed text-mute">{DISCLAIMER}</p>;
}

/** "← Insurance" and similar back links at the top of a sub-page. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-[44px] items-center text-[13px] text-mute hover:text-ink">
      ← {children}
    </Link>
  );
}
