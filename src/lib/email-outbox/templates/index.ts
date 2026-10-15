import { parseFacts, type EmailKind } from "../facts";
import { renderAnnouncement } from "./announcement";
import { renderDuesReminder } from "./dues-reminder";
import { renderDuesUpcoming } from "./dues-upcoming";
import { renderLateFeeNotice } from "./late-fee-notice";
import { renderStatement } from "./statement";
import { InvalidFactsError, UnknownTemplateError, type RenderContext, type RenderExtra, type Rendered } from "./types";

export * from "./types";
export { statementFilename } from "./statement";

/** The template keys each kind may use, with the one version that exists. */
const KEYS: Record<EmailKind, string[]> = {
  dues_reminder: ["dues_reminder", "dues_upcoming"],
  late_fee_notice: ["late_fee_notice"],
  statement: ["statement"],
  annual_statement: ["statement"],
  announcement: ["announcement"],
};

/**
 * Pure: the same inputs always give the same message. The review page and the
 * sender both call this, so what the board approves is what is sent.
 */
export function render(
  kind: EmailKind,
  templateKey: string,
  templateVersion: number,
  facts: unknown,
  ctx: RenderContext,
  extra?: RenderExtra,
): Rendered {
  if (templateVersion !== 1 || !(KEYS[kind] ?? []).includes(templateKey)) {
    throw new UnknownTemplateError(kind, templateKey, templateVersion);
  }
  const parsed = parseFacts(kind, facts);
  if (!parsed.ok) throw new InvalidFactsError();
  const p = parsed.parsed;
  switch (p.kind) {
    case "dues_reminder":
      return templateKey === "dues_upcoming" ? renderDuesUpcoming(p.data, ctx) : renderDuesReminder(p.data, ctx);
    case "late_fee_notice":
      return renderLateFeeNotice(p.data, ctx);
    case "statement":
      return renderStatement(p.data, ctx, false);
    case "annual_statement":
      return renderStatement(p.data, ctx, true);
    case "announcement":
      if (!extra?.announcement) throw new InvalidFactsError();
      return renderAnnouncement(p.data, ctx, extra.announcement);
  }
}
