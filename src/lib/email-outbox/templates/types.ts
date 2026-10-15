import type { EmailKind } from "../facts";

export interface RenderContext {
  /** associations.display_name */
  associationName: string;
  /** board_contact_name, or "The board" */
  replyToName: string;
  replyToEmail: string;
  /** First word of to_name, "there" when empty. */
  recipientFirstName: string;
  /** From email_claim: the recipient has a Walkup login. */
  hasLogin: boolean;
  siteUrl: string;
  unsubscribeUrl: string;
  legalEntity: string;
  legalAddress: string;
  boardNote: string | null;
  /** The building's today, YYYY-MM-DD. */
  todayIso: string;
}

export interface AttachmentSpec {
  kind: "statement_pdf";
  unitId: string;
  from: string;
  to: string;
  filename: string;
}

export interface Rendered {
  subject: string;
  text: string;
  html: string;
  attachments?: AttachmentSpec[];
}

export interface RenderExtra {
  announcement?: { title: string; body: string; hasAttachment: boolean };
}

export type { EmailKind };

export class UnknownTemplateError extends Error {
  constructor(kind: string, key: string, version: number) {
    super(`Unknown email template: ${kind}/${key}/v${version}`);
    this.name = "UnknownTemplateError";
  }
}

export class InvalidFactsError extends Error {
  constructor() {
    super("The saved details for this email could not be read.");
    this.name = "InvalidFactsError";
  }
}
