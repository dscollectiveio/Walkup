"use client";

import { useRouter } from "next/navigation";
import { DraftEmail } from "@/components/email/draft-email";
import { markSentByHand } from "@/app/dues/email-actions";

export interface ManualDraft {
  id: string;
  email: string;
  name: string;
  subject: string;
  body: string;
  sent: boolean;
  /** Statement PDFs to download and attach. */
  pdfs: { label: string; href: string }[];
}

/**
 * Sending from Walkup is not set up (or is off): each draft opens in the board
 * member's own mail app and "Mark as sent" records it, so the history, the
 * weekly limit and "last reminded" stay true either way.
 */
export function ManualDrafts({ drafts }: { drafts: ManualDraft[] }) {
  const router = useRouter();
  return (
    <ul className="space-y-4">
      {drafts.map((d) => (
        <li key={d.id} className="space-y-2">
          <DraftEmail
            to={[d.email]}
            subject={d.subject}
            body={d.body}
            title={d.name}
            sentAt={d.sent ? new Date().toISOString() : null}
            note={d.pdfs.length ? "The PDF can't ride along in a mail link. Download it and attach it." : undefined}
            onMarkSent={async () => {
              const res = await markSentByHand(d.id);
              if ("error" in res) return res;
              router.refresh();
              return { ok: true };
            }}
          />
          {d.pdfs.length ? (
            <div className="flex flex-wrap gap-2">
              {d.pdfs.map((p) => (
                <a
                  key={p.href}
                  href={p.href}
                  className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink hover:bg-fill"
                >
                  {p.label}
                </a>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
