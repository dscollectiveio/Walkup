import Link from "next/link";
import type { BoardContact } from "@/lib/owner/viewer-types";

/**
 * Who owners write to (owner-portal-spec 6.6): the board contact's name, a
 * mailto link and a tel link, or "Ask a board member." A board admin also
 * gets a muted link to set it.
 */
export function ContactLine({ contact, canEdit = false }: { contact: BoardContact | null; canEdit?: boolean }) {
  const has = Boolean(contact && (contact.name || contact.email || contact.phone));
  return (
    <div className="text-[14px] text-ink">
      {has && contact ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium">{contact.name ?? "The board"}</span>
          {contact.email ? (
            <a href={`mailto:${contact.email}`} className="inline-flex min-h-[44px] items-center underline underline-offset-2">
              Write to the board
            </a>
          ) : null}
          {contact.phone ? (
            <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-[44px] items-center underline underline-offset-2">
              Call {contact.phone}
            </a>
          ) : null}
        </p>
      ) : (
        <p>Ask a board member.</p>
      )}
      {canEdit && !has ? (
        <p className="mt-1 text-[12px] text-mute">
          <Link href="/building#contact" className="underline underline-offset-2">
            Add the board contact
          </Link>
        </p>
      ) : null}
    </div>
  );
}
