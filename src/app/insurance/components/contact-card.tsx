import { formatPhone, telHref } from "@/lib/insurance/format";
import { mailtoLink } from "@/lib/email/mailto";

export interface ContactCardContact {
  id: string;
  name: string;
  person_name: string | null;
  kind: string;
  email: string | null;
  phone: string | null;
  website_url?: string | null;
}

const KIND_LABEL: Record<string, string> = {
  agent: "Agent", agency: "Agency", broker: "Broker", insurer: "Insurer", adjuster: "Adjuster", other: "Contact",
};

/** One insurance contact: who, how to reach them, and the host's buttons underneath. */
export function ContactCard({ contact, children }: { contact: ContactCardContact; children?: React.ReactNode }) {
  const tel = contact.phone ? telHref(contact.phone) : null;
  return (
    <div className="space-y-3 text-[13px]">
      <div>
        <div className="font-medium text-ink">{contact.name}</div>
        <div className="mt-0.5 text-mute">
          {[KIND_LABEL[contact.kind] ?? "Contact", contact.person_name].filter(Boolean).join(" · ")}
        </div>
        <dl className="mt-2 space-y-1">
          {contact.phone ? (
            <div className="flex gap-2">
              <dt className="sr-only">Phone</dt>
              <dd>
                {tel ? (
                  <a href={tel} className="figures text-ink underline underline-offset-2">
                    {formatPhone(contact.phone)}
                  </a>
                ) : (
                  <span className="figures text-ink">{contact.phone}</span>
                )}
              </dd>
            </div>
          ) : null}
          {contact.email ? (
            <div className="flex gap-2">
              <dt className="sr-only">Email</dt>
              <dd className="min-w-0 break-all">
                <a href={mailtoLink(contact.email)} className="text-ink underline underline-offset-2">
                  {contact.email}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}
