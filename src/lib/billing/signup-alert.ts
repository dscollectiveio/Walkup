import { escapeHtml } from "@/lib/email-outbox/sanitize";
import { SITE_URL } from "@/lib/site-config";

/**
 * The note to the platform admins (Doug) when a new building signs up (migration 0086). Plain, with the same words
 * in text and HTML. It is written to the company's own staff, not to a customer, so it carries no unsubscribe link.
 * No em dashes.
 */

export interface SignupPerson {
  name: string;
  email: string | null;
  roles: string[];
}

export interface SignupAlertInput {
  displayName: string;
  city: string | null;
  stateCode: string | null;
  createdAt: string;
  people: SignupPerson[];
}

const ROLE_LABEL: Record<string, string> = {
  board_admin: "Board admin",
  board_member: "Board member",
  accountant: "Accountant",
  property_manager: "Property manager",
  attorney: "Attorney",
  observer: "Observer",
};

export function renderSignupAlert(input: SignupAlertInput): { subject: string; text: string; html: string } {
  const where = [input.city, input.stateCode].filter(Boolean).join(", ");
  const when = new Date(input.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" });
  const subject = `New Walkup signup: ${input.displayName}`;
  const lines = input.people.map((p) => `${p.name}${p.email ? ` <${p.email}>` : ""}, ${p.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ")}`);
  const link = `${SITE_URL}/admin/buildings`;
  const body = [
    `A new building signed up: ${input.displayName}${where ? ` (${where})` : ""}.`,
    `Created ${when} Central time.`,
    lines.length ? `Who is in it so far:\n${lines.map((l) => `  ${l}`).join("\n")}` : "Nobody has a role in it yet.",
    `See every building and who is involved: ${link}`,
  ];
  const text = body.join("\n\n");
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#ffffff;"><div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:15px;color:#1f2937;">` +
    body
      .map((p) => `<p style="margin:0 0 16px;line-height:1.5;">${escapeHtml(p).replace(/\n/g, "<br>").replace(/ {2}/g, "&nbsp;&nbsp;").replace(/https:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#1B2A41;">${u}</a>`)}</p>`)
      .join("") +
    `</div></body></html>`;
  return { subject, text, html };
}
