"use client";

import { useEffect } from "react";
import { smsHref, telHref, type EmergencyContact } from "@/components/repairs/emergency-banner";

/**
 * The one-time notice after reporting (repairs-spec §5.2): what number the
 * problem got, that nobody was alerted, photos that didn't make it, and for
 * something urgent, the board's listed numbers. Focus moves to the title;
 * the query string is dropped so a reload doesn't show it again.
 */
export function ReportedNotice(props: {
  reference: number;
  failed: number;
  urgent: boolean;
  contacts: EmergencyContact[];
  titleId: string;
}) {
  const { titleId } = props;
  useEffect(() => {
    document.getElementById(titleId)?.focus();
    const url = new URL(window.location.href);
    url.searchParams.delete("reported");
    url.searchParams.delete("failed");
    window.history.replaceState(null, "", url.toString());
  }, [titleId]);

  return (
    <div role="status" className="space-y-2">
      <p className="border-l-[3px] border-good bg-good-tint px-4 py-3 text-[14px] text-good-text">
        Reported as #{props.reference}. Walkup doesn&rsquo;t alert anyone, so the board sees it the next time they open Walkup.
        {props.failed > 0 ? ` ${props.failed} ${props.failed === 1 ? "photo" : "photos"} didn't upload. Add ${props.failed === 1 ? "it" : "them"} below.` : ""}
      </p>
      {props.urgent ? (
        <div className="border-l-[3px] border-bad bg-bad-tint px-4 py-3 text-[14px] text-bad-text">
          <p className="font-medium">If this can&rsquo;t wait, call or text a board member now.</p>
          {props.contacts.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {props.contacts.map((c) => (
                <li key={`${c.name}-${c.phone}`}>
                  {c.name}
                  {c.label ? `, ${c.label}` : ""}: {c.phone}{" "}
                  <a href={telHref(c.phone)} className="inline-flex min-h-[44px] items-center px-1 font-medium underline underline-offset-2">
                    Call
                  </a>{" "}
                  <a href={smsHref(c.phone)} className="inline-flex min-h-[44px] items-center px-1 font-medium underline underline-offset-2">
                    Text
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1">Your board hasn&rsquo;t listed a phone number in Walkup. Use the number you normally use for them.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
