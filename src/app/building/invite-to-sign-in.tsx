"use client";

import { useState, useTransition } from "react";
import { DraftEmail } from "@/components/email/draft-email";
import { inviteEmailBody, inviteEmailSubject } from "@/lib/owner/invite-email";
import { createOwnerInvite } from "./owner-invite-actions";

/**
 * "Invite to sign in" for a person with no login (owner-portal-spec 5.3).
 * Mount it in the person row. After the invite is made it offers the link and a
 * draft email the board sends from their own mail app.
 */
export function InviteToSignIn({
  personId,
  associationName,
  boardContactName,
}: {
  personId: string;
  associationName: string;
  boardContactName: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ url: string; email: string | null; fullName: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function create() {
    setError(null);
    start(async () => {
      const r = await createOwnerInvite(personId);
      if ("error" in r) setError(r.error);
      else setMade({ url: `${window.location.origin}/invite/${r.token}`, email: r.email, fullName: r.fullName });
    });
  }

  if (!made) {
    return (
      <div>
        <button
          type="button"
          onClick={create}
          disabled={pending}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-60"
        >
          {pending ? "Making the invite..." : "Invite to sign in"}
        </button>
        {error ? (
          <p role="alert" className="mt-1 text-[13px] text-bad-text">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p role="status" className="text-[13px] text-good-text">
        Invite made. It works once and expires in 7 days.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 break-all rounded bg-fill px-2 py-1 text-[12px] text-ink">{made.url}</code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(made.url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
          className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink hover:bg-fill"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <DraftEmail
        to={made.email ? [made.email] : []}
        subject={inviteEmailSubject(associationName)}
        body={inviteEmailBody({ fullName: made.fullName, associationName, inviteUrl: made.url, boardContactName })}
        title="Email to send with the link"
      />
    </div>
  );
}
