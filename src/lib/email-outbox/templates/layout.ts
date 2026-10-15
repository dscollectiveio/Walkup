import { escapeHtml } from "../sanitize";
import { CATEGORY_WORDS, type PreferenceKey } from "../facts";
import type { RenderContext } from "./types";

/**
 * One small document model that renders to both the plain-text part and the
 * HTML part, so the two can never disagree (money spec 4.2). No remote
 * images, no tracking pixels, no wrapped links.
 */

export type Block =
  | { t: "p"; text: string }
  | { t: "rows"; rows: { cells: string[]; strong?: boolean }[] }
  | { t: "pre"; text: string };

export interface FooterInfo {
  category: PreferenceKey;
  unitLabels: string[];
}

const NAVY = "#1B2A41";
const GREY = "#5f6b7a";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function p(text: string): Block {
  return { t: "p", text };
}

function listWords(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function footerLines(ctx: RenderContext, info: FooterInfo): string[] {
  const owner = info.unitLabels.length
    ? `has you down as an owner of ${listWords(info.unitLabels)}`
    : "has you down as an owner";
  const category = CATEGORY_WORDS[info.category];
  return [
    `You're getting this because the board of ${ctx.associationName} ${owner}.`,
    `Reply to this email to reach ${ctx.replyToName} at ${ctx.associationName}.`,
    "",
    `Stop ${category} or change your choices: ${ctx.unsubscribeUrl}`,
    "",
    `Sent by Walkup on behalf of ${ctx.associationName}. Walkup is operated by ${ctx.legalEntity}, ${ctx.legalAddress}.`,
    "Walkup does not collect or move money. Payment details are never sent by email.",
  ];
}

function renderRowsText(rows: { cells: string[]; strong?: boolean }[]): string {
  const cols = Math.max(...rows.map((r) => r.cells.length));
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) widths[c] = Math.max(...rows.map((r) => (r.cells[c] ?? "").length));
  return rows
    .map((r) => {
      const parts = widths.map((w, c) => {
        const cell = r.cells[c] ?? "";
        return c === cols - 1 ? cell.padStart(w) : cell.padEnd(w);
      });
      return `  ${parts.join("   ")}`.replace(/\s+$/, "");
    })
    .join("\n");
}

function linkify(escaped: string, siteUrl: string): string {
  const base = escapeHtml(siteUrl).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${base}[^\\s<]*`, "g");
  return escaped.replace(re, (url) => `<a href="${url}" style="color:${NAVY};">${url}</a>`);
}

function renderBlockHtml(b: Block, ctx: RenderContext): string {
  if (b.t === "p") {
    const body = linkify(escapeHtml(b.text), ctx.siteUrl).replace(/\n/g, "<br>");
    return `<p style="margin:0 0 16px;line-height:1.5;">${body}</p>`;
  }
  if (b.t === "pre") {
    return `<div style="margin:0 0 16px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(b.text)}</div>`;
  }
  const last = Math.max(...b.rows.map((r) => r.cells.length)) - 1;
  const rows = b.rows
    .map((r) => {
      const weight = r.strong ? "font-weight:bold;border-top:1px solid #d6dbe2;" : "";
      const cells = Array.from({ length: last + 1 }, (_, c) => {
        const align = c === last ? "right" : "left";
        return `<td style="padding:4px ${c === last ? "0" : "12px"} 4px 0;text-align:${align};${weight}">${escapeHtml(r.cells[c] ?? "")}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 16px;border-collapse:collapse;font-size:14px;">${rows}</table>`;
}

/** Joins the blocks and the footer into the two parts of the message. */
export function compose(blocks: Block[], ctx: RenderContext, info: FooterInfo): { text: string; html: string } {
  const text = [
    ...blocks.map((b) => (b.t === "rows" ? renderRowsText(b.rows) : b.text)),
    ["--", ...footerLines(ctx, info)].join("\n"),
  ].join("\n\n");

  const footerHtml = footerLines(ctx, info)
    .map((line) => {
      if (line === "") return "<br>";
      const escaped = escapeHtml(line);
      return `<div>${linkify(escaped, ctx.siteUrl)}</div>`;
    })
    .join("");

  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(ctx.associationName)}</title></head>` +
    `<body style="margin:0;padding:0;background:#ffffff;">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:${FONT};font-size:15px;color:#1f2937;">` +
    `<div style="font-size:16px;font-weight:bold;color:${NAVY};margin:0 0 20px;">${escapeHtml(ctx.associationName)}</div>` +
    blocks.map((b) => renderBlockHtml(b, ctx)).join("") +
    `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #d6dbe2;font-size:12px;line-height:1.5;color:${GREY};">` +
    `${footerHtml}</div>` +
    `</div></body></html>`;

  return { text, html };
}

// ---- Paragraphs shared by several templates -------------------------------------

export function greeting(ctx: RenderContext): Block {
  return p(`Hi ${ctx.recipientFirstName},`);
}

export function noteBlocks(ctx: RenderContext): Block[] {
  const note = ctx.boardNote?.trim();
  return note ? [p(`A note from the board: ${note}`)] : [];
}

/** How to pay: a pointer to Walkup for people with a login, to the board for the rest. Never an account number. */
export function accessBlock(ctx: RenderContext): Block {
  return ctx.hasLogin
    ? p(`You can see your statement and how to pay when you sign in at ${ctx.siteUrl}/owner`)
    : p(
        "To pay, use the details the board gave you, or reply to this email and we'll point you to them.\nPayment details are never sent by email. Only use the ones the board gave you.",
      );
}

export function signoff(ctx: RenderContext, thanks = true): Block {
  return p(`${thanks ? "Thanks,\n" : ""}${ctx.replyToName}\n${ctx.associationName}`);
}
