import Link from "next/link";
import { Card } from "@/components/ui";
import type { Viewer } from "@/lib/owner/viewer";
import { SUPPORT_EMAIL } from "@/lib/site-config";
import { btnSecondary } from "@/components/repairs/styles";
import { linkClass } from "./shared";

/**
 * Privacy and data: what Walkup keeps about this person, a download of it,
 * where the association's own records are, and how to leave.
 */
export function PrivacyTab({ viewer }: { viewer: Viewer }) {
  const closeSubject = encodeURIComponent(`Close my Walkup account (${viewer.associationName})`);
  return (
    <>
      <Card navy title="What Walkup keeps about you">
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink">
          <li>Your name, email, phone and mailing address, while you have access to {viewer.associationName} or own a unit there.</li>
          <li>Your role, the units you own, and your email choices.</li>
          <li>A record of important changes you make, such as approving a transaction, so the board can see who did what.</li>
          <li>Walkup never sees or stores card or bank numbers, and never sells or shares your details for marketing.</li>
        </ul>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <a href="/account/export" download className={btnSecondary}>
            Download your details
          </a>
          <p className="text-[12px] text-mute">A small file with everything above, in a format any computer can open.</p>
        </div>
      </Card>

      {viewer.canReadFinancials ? (
        <Card navy title="The association's records">
          <p className="text-[13px] leading-relaxed text-ink">
            The books belong to the association, never to Walkup. Download{" "}
            <Link href="/financial-statements" className={linkClass}>
              financial statements
            </Link>{" "}
            (PDF or Excel with the general ledger) and{" "}
            <Link href="/documents" className={linkClass}>
              documents
            </Link>{" "}
            any time, whatever happens with the plan.
          </p>
        </Card>
      ) : null}

      <Card navy title="Close your account">
        <p className="text-[13px] leading-relaxed text-ink">
          {viewer.isBoardAdmin
            ? "Before you go, make sure another board admin is set up under Building & Owners, so the association isn't left without one. "
            : ""}
          To close your account or have your details removed, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}?subject=${closeSubject}`} className={linkClass}>
            {SUPPORT_EMAIL}
          </a>
          . We do it within 30 days and tell you what was removed. The association keeps its own records, such as payments you
          made, as the law requires. See the{" "}
          <Link href="/privacy" className={linkClass}>
            Privacy Policy
          </Link>{" "}
          and the{" "}
          <Link href="/policies/data-retention" className={linkClass}>
            Data Retention Policy
          </Link>
          .
        </p>
      </Card>
    </>
  );
}
