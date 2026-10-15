import { fromCents, toCents } from "@/lib/tax/form1120h";
import { periodLabel } from "@/lib/statements/period";
import { cleanHeaderText, safeFilename } from "../sanitize";
import { formatBalanceWords, formatMoney, isZero } from "../format";
import type { StatementFacts, StatementUnitFacts } from "../facts";
import { compose, greeting, noteBlocks, p, signoff, type Block } from "./layout";
import type { AttachmentSpec, RenderContext, Rendered } from "./types";

function summaryRows(u: StatementUnitFacts): Block {
  const rows: { cells: string[]; strong?: boolean }[] = [
    { cells: ["Balance at the start", formatBalanceWords(u.opening)] },
    { cells: ["Charged", formatMoney(u.charges)] },
    { cells: ["Paid", formatMoney(u.payments)] },
  ];
  if (!isZero(u.adjustments)) rows.push({ cells: ["Waived or written off", formatMoney(u.adjustments)] });
  rows.push({ cells: ["Balance at the end", formatBalanceWords(u.closing)] });
  return { t: "rows", rows };
}

function closingSentence(u: StatementUnitFacts): string {
  const closing = toCents(u.closing);
  if (closing > 0) return "The balance at the end is what is owed.";
  if (closing < 0) return `You have a credit of ${formatMoney(fromCents(-closing))} on account.`;
  return "Nothing is owed at the end of this period.";
}

export function statementFilename(unitLabel: string, from: string, to: string, annual: boolean): string {
  return `${safeFilename(`${annual ? "Annual statement" : "Statement"} ${unitLabel} ${periodLabel(from, to)}`)}.pdf`;
}

export function renderStatement(facts: StatementFacts, ctx: RenderContext, annual: boolean): Rendered {
  const units = facts.units;
  const many = units.length > 1;
  const labels = units.map((u) => u.label);
  const first = units[0];
  const period = periodLabel(first.from, first.to);

  const subject = cleanHeaderText(
    annual
      ? `Annual statement for ${labels.join(" and ")}, ${period}`
      : `Statement for ${labels.join(" and ")}, ${period}`,
    200,
  );

  const blocks: Block[] = [greeting(ctx)];
  if (!many) {
    blocks.push(p(`Your ${annual ? "annual " : ""}statement for ${first.label} for ${period} is attached as a PDF.`), summaryRows(first), p(closingSentence(first)));
  } else {
    blocks.push(p(`Your ${annual ? "annual " : ""}statements for ${labels.join(" and ")} for ${period} are attached as PDFs.`));
    for (const u of units) blocks.push(p(`${u.label}:`), summaryRows(u), p(closingSentence(u)));
  }
  if (annual) blocks.push(p(`This is a record of your account with ${ctx.associationName}. It is not a tax document.`));
  blocks.push(...noteBlocks(ctx));
  if (ctx.hasLogin) blocks.push(p(`You can see this and your earlier statements when you sign in at ${ctx.siteUrl}/owner/statement`));
  blocks.push(signoff(ctx));

  const attachments: AttachmentSpec[] = units.map((u) => ({
    kind: "statement_pdf",
    unitId: u.unit_id,
    from: u.from,
    to: u.to,
    filename: statementFilename(u.label, u.from, u.to, annual),
  }));

  const { text, html } = compose(blocks, ctx, { category: "statements", unitLabels: labels });
  return { subject, text, html, attachments };
}
