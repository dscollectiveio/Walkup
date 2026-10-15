"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { EmailAnnouncementButton } from "@/components/email/email-announcement-button";
import { deleteAnnouncementDraft, setAnnouncementPinned, setAnnouncementStatus } from "./actions";

const small =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-60";

/** The board's actions on one announcement: Edit, Email, Pin, Archive, Restore, Delete (a draft, with a confirm). */
export function BoardRowActions({
  id,
  status,
  pinned,
}: {
  id: string;
  status: "draft" | "published" | "archived";
  pinned: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function run(fn: () => Promise<{ ok: true } | { error: string }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if ("error" in r) setError(r.error);
      setConfirmDelete(false);
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {status !== "archived" ? (
          <Link href={`/announcements/${id}/edit`} className={small}>
            Edit
          </Link>
        ) : null}
        {status === "published" ? (
          <button type="button" className={small} disabled={pending} onClick={() => run(() => setAnnouncementPinned(id, !pinned))}>
            {pinned ? "Unpin" : "Pin"}
          </button>
        ) : null}
        {status === "published" ? <EmailAnnouncementButton announcementId={id} /> : null}
        {status === "published" ? (
          <button type="button" className={small} disabled={pending} onClick={() => run(() => setAnnouncementStatus(id, "archived"))}>
            Archive
          </button>
        ) : null}
        {status === "archived" ? (
          <button type="button" className={small} disabled={pending} onClick={() => run(() => setAnnouncementStatus(id, "published"))}>
            Restore
          </button>
        ) : null}
        {status === "draft" && !confirmDelete ? (
          <button type="button" className={small} onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        ) : null}
      </div>
      {status === "draft" && confirmDelete ? (
        <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Confirm delete">
          <span className="text-[13px] text-ink">Delete this draft?</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => deleteAnnouncementDraft(id))}
            className="inline-flex min-h-[44px] items-center rounded-md border border-bad-line bg-paper px-4 text-[13px] font-medium text-bad-text hover:bg-bad-tint disabled:opacity-60"
          >
            Yes, delete
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirmDelete(false)} className={small}>
            Keep it
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-bad-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
