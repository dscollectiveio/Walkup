import Link from "next/link";
import { Card } from "@/components/ui";
import type { Viewer } from "@/lib/owner/viewer";
import { ProfileForm } from "@/app/owner/profile/profile-form";
import { ROLE_WORDS, dtClass, ddClass, linkClass } from "./shared";

/**
 * Profile: the person's record and what their roles let them do. Name and
 * email are the board's record (owner-portal-spec 6.8), so a board member
 * fixes them under Building Info and anyone else asks the board; phone and
 * mailing address are the person's own to change here.
 */
export function ProfileTab({
  viewer,
  email,
  phone,
  mailingAddress,
}: {
  viewer: Viewer;
  email: string;
  phone: string;
  mailingAddress: string;
}) {
  const contact = viewer.boardContact;
  return (
    <>
      <Card navy title="Your details" hint="Name and email are how the board knows you. Phone and address are yours to keep current.">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <div>
            <dt className={dtClass}>Name</dt>
            <dd className={ddClass}>{viewer.fullName || "Not on file"}</dd>
          </div>
          <div>
            <dt className={dtClass}>Email</dt>
            <dd className={`${ddClass} break-all`}>{email || "Not on file"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[12px] text-mute">
          {viewer.isBoard ? (
            <>
              Name or email wrong? Edit yourself under{" "}
              <Link href="/building" className={linkClass}>
                Building Info
              </Link>
              .
            </>
          ) : (
            <>Name or email wrong? Ask {contact.name ?? "the board"} to change it.</>
          )}
        </p>
        <div className="mt-5 border-t border-line pt-5">
          <ProfileForm phone={phone} mailingAddress={mailingAddress} />
        </div>
      </Card>

      <Card navy title={viewer.roles.length === 1 ? "Your role" : "Your roles"} hint={`What you can do in ${viewer.associationName}.`}>
        {viewer.roles.length === 0 ? (
          <p className="text-[13px] text-mute">You have no active role here. Ask the board if that&rsquo;s a mistake.</p>
        ) : (
          <ul className="divide-y divide-line">
            {viewer.roles.map((r) => (
              <li key={r} className="py-3 first:pt-0 last:pb-0">
                <p className="text-[15px] font-semibold text-ink">{ROLE_WORDS[r].name}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-mute">{ROLE_WORDS[r].what}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[12px] text-mute">
          {viewer.isBoardAdmin ? (
            <>
              You give and take away roles under{" "}
              <Link href="/building" className={linkClass}>
                Building Info
              </Link>
              .
            </>
          ) : (
            <>Roles are given by a board admin{contact.name ? `, such as ${contact.name}` : ""}.</>
          )}
        </p>
      </Card>

      {!viewer.isBoard && (contact.name || contact.email || contact.phone) ? (
        <Card navy title="Your board contact" hint="For anything about the building, your dues or this account.">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
            {contact.name ? (
              <div>
                <dt className={dtClass}>Name</dt>
                <dd className={ddClass}>{contact.name}</dd>
              </div>
            ) : null}
            {contact.email ? (
              <div>
                <dt className={dtClass}>Email</dt>
                <dd className={`${ddClass} break-all`}>
                  <a href={`mailto:${contact.email}`} className={linkClass}>
                    {contact.email}
                  </a>
                </dd>
              </div>
            ) : null}
            {contact.phone ? (
              <div>
                <dt className={dtClass}>Phone</dt>
                <dd className={ddClass}>
                  <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className={linkClass}>
                    {contact.phone}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        </Card>
      ) : null}
    </>
  );
}
