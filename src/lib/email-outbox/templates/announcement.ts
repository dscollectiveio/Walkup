import { cleanHeaderText } from "../sanitize";
import type { AnnouncementFacts } from "../facts";
import { compose, greeting, p, signoff, type Block } from "./layout";
import type { RenderContext, Rendered, RenderExtra } from "./types";

/**
 * The email carries the board's own words only when they hold nothing a
 * phisher needs from an official sender: no link, no address, no bare domain,
 * no long run of digits (an account or routing number). Otherwise the email
 * is the title and a line to read the notice in Walkup (REVIEW-2 #8). The
 * notice itself is unchanged on the Announcements page.
 */
export function emailableBody(body: string): string | null {
  const text = body ?? "";
  if (/(:\/\/|www\.|@)/i.test(text)) return null;
  if (/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|us|info|biz|app|xyz|online|site|link|click|top|club|shop|live|me|ly|gl)\b/i.test(text)) return null;
  // A run of eight or more digits (phone, account, routing number); a written date such as 2026-10-14 is fine.
  if (/\d(?:[\s.-]?\d){7,}/.test(text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ""))) return null;
  return text;
}

/** The body is the board's own words, plain text, no auto-linking. */
export function renderAnnouncement(
  _facts: AnnouncementFacts,
  ctx: RenderContext,
  extra: NonNullable<RenderExtra["announcement"]>,
): Rendered {
  const title = emailableBody(extra.title) ?? "a new notice";
  const subject = cleanHeaderText(`${ctx.associationName}: ${title}`, 200);
  const body = emailableBody(extra.body);
  const blocks: Block[] = [greeting(ctx)];
  if (body !== null) {
    blocks.push({ t: "pre", text: body });
    if (extra.hasAttachment) {
      blocks.push(
        p(ctx.hasLogin ? `This notice has a file with it. Sign in at ${ctx.siteUrl}/announcements to open it.` : "This notice has a file with it. Ask the board for the file."),
      );
    } else if (ctx.hasLogin) {
      blocks.push(p(`You can read this and earlier notices at ${ctx.siteUrl}/announcements`));
    }
  } else {
    blocks.push(p(`The board posted a notice: ${title}.`));
    blocks.push(
      p(ctx.hasLogin ? `Sign in at ${ctx.siteUrl}/announcements to read it.` : "Ask the board for the details."),
    );
  }
  blocks.push(signoff(ctx, false));
  const { text, html } = compose(blocks, ctx, { category: "announcements", unitLabels: [] });
  return { subject, text, html };
}
