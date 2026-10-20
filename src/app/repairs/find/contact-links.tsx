import { telHref } from "@/components/repairs/emergency-banner";
import { mailtoLink } from "@/lib/email/mailto";
import { safeHttpUrl } from "@/lib/security/safe-url";

const link = "inline-flex min-h-[24px] max-w-full items-center text-[12px] font-medium text-ink underline underline-offset-2 hover:text-ink-mid";

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Website";
  }
}

/**
 * The ways to reach a contractor, all live links: the number dials, the email
 * opens a message, the website opens in a new tab. Anything extra (a Google or
 * source link) comes in as children.
 */
export function ContactLinks({
  phone,
  email,
  website,
  children,
}: {
  phone: string | null;
  email: string | null;
  website: string | null;
  children?: React.ReactNode;
}) {
  const site = website ? safeHttpUrl(website) : null;
  const none = !phone && !email && !site && !children;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 xl:flex-col xl:items-center xl:gap-x-0">
      {phone ? (
        <a href={telHref(phone)} className={link}>
          {phone}
        </a>
      ) : null}
      {email ? (
        <a href={mailtoLink(email)} title={email} className={`${link} xl:truncate`}>
          {email}
        </a>
      ) : null}
      {site ? (
        <a href={site} target="_blank" rel="noopener noreferrer nofollow" className={link}>
          {host(site)}
        </a>
      ) : null}
      {children}
      {none ? <span className="text-[12px] text-mute">No contact details</span> : null}
    </div>
  );
}
