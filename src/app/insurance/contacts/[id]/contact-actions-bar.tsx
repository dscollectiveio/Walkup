"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { archiveContact } from "../../contact-actions";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { ContactDialog, type ContactDialogValue } from "../../components/contact-dialog";
import { btnGhost, btnPrimary } from "../../components/styles";

/** The contact page's board buttons (§9.11): Edit, Write, Ask for a quote, Archive or Restore. */
export function ContactActionsBar({ contact, archived }: { contact: ContactDialogValue; archived: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      {!archived ? (
        <>
          {contact.email ? (
            <Link href={`/insurance?view=quotes&new=1&contact=${contact.id}`} className={btnPrimary}>
              Ask for a quote
            </Link>
          ) : null}
          <Link href={`/insurance/emails/new?kind=other&contact=${contact.id}`} className={btnGhost}>
            Write
          </Link>
          <button type="button" className={btnGhost} onClick={() => setEditing(true)}>
            Edit
          </button>
        </>
      ) : null}
      <button type="button" className={btnGhost} onClick={() => setConfirm(true)}>
        {archived ? "Restore" : "Archive"}
      </button>
      <ContactDialog
        open={editing}
        contact={contact}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={confirm}
        title={archived ? "Restore this contact?" : "Archive this contact?"}
        body={
          archived
            ? "It comes back to your contacts list."
            : "It leaves your contacts list and request choices. Its emails, requests and quotes stay. You can restore it."
        }
        confirmLabel={archived ? "Restore" : "Archive"}
        pendingLabel="Saving…"
        onConfirm={async () => {
          const r = await archiveContact(contact.id, !archived);
          if ("ok" in r) router.refresh();
          return r;
        }}
        onClose={() => setConfirm(false)}
      />
    </div>
  );
}
