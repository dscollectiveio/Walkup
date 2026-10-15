import { toCents, fromCents } from "@/lib/tax/form1120h";
import { longDate, shortDate } from "@/lib/dates";
import { cleanHeaderText } from "../sanitize";
import { formatMoney, isPositive, sumMoney } from "../format";
import type { DuesFacts, UnitFacts } from "../facts";
import { accessBlock, compose, greeting, noteBlocks, p, signoff, type Block } from "./layout";
import type { RenderContext, Rendered } from "./types";

/**
 * THE NET RULE (one rule everywhere: the statement, the portal and these
 * emails). What a unit owes is its open charges minus payments not yet applied
 * to a charge, never below zero; what is past due is reduced the same way, as
 * the credit pays the oldest charges first.
 */
export function netOwed(u: Pick<UnitFacts, "owed" | "credit">): string {
  return fromCents(Math.max(toCents(u.owed) - toCents(u.credit), 0));
}
export function netOverdue(u: Pick<UnitFacts, "overdue" | "credit">): string {
  return fromCents(Math.max(toCents(u.overdue) - toCents(u.credit), 0));
}

/** The chargeable lines of one unit as aligned rows, ending in the net balance. */
export function unitRows(u: UnitFacts, todayIso: string): Block {
  const rows: { cells: string[]; strong?: boolean }[] = u.lines.map((l) => ({
    cells: [l.label, `due ${shortDate(l.due_on, todayIso)}`, formatMoney(l.balance)],
  }));
  // The facts list at most 12 open charges; make the rows add up to the total.
  const shown = u.lines.reduce((s, l) => s + toCents(l.balance), 0);
  const rest = toCents(u.owed) - shown;
  if (rest !== 0) rows.push({ cells: ["Other open charges", "", formatMoney(fromCents(rest))] });
  if (isPositive(u.credit)) {
    rows.push({ cells: ["Total of open charges", "", formatMoney(u.owed)] });
    rows.push({ cells: ["Payment not yet applied", "", `-${formatMoney(u.credit)}`] });
    rows.push({ cells: ["Balance", "", formatMoney(netOwed(u))], strong: true });
  } else {
    rows.push({ cells: ["Total", "", formatMoney(u.owed)], strong: true });
  }
  return { t: "rows", rows };
}

function overdueSentence(u: UnitFacts, many: boolean): string | null {
  const late = netOverdue(u);
  if (!isPositive(late) || !u.oldest_overdue_on) return null;
  const of = many ? `of the balance for ${u.label}` : "of this";
  return `${formatMoney(late)} ${of} is past due. The oldest unpaid charge was due on ${longDate(u.oldest_overdue_on)}.`;
}

function creditSentence(u: UnitFacts): string | null {
  return isPositive(u.credit)
    ? `The board's books also show a payment of ${formatMoney(u.credit)} for ${u.label} that has not been applied to a charge yet. It is already taken off the balance above.`
    : null;
}

export function renderDuesReminder(facts: DuesFacts, ctx: RenderContext): Rendered {
  const units = facts.units;
  const many = units.length > 1;
  const total = sumMoney(units.map((u) => netOwed(u)));
  const subject = cleanHeaderText(
    many
      ? `Dues reminder: ${formatMoney(total)} across ${units.length} units`
      : `Dues reminder: ${units[0].label} has a balance of ${formatMoney(netOwed(units[0]))}`,
    200,
  );

  const blocks: Block[] = [greeting(ctx)];
  if (!many) {
    const u = units[0];
    blocks.push(
      p(
        `This is a reminder from ${ctx.associationName}. As of ${longDate(ctx.todayIso)}, the board's books show a balance of ${formatMoney(netOwed(u))} for ${u.label}:`,
      ),
      unitRows(u, ctx.todayIso),
    );
    for (const s of [overdueSentence(u, false), creditSentence(u)]) if (s) blocks.push(p(s));
  } else {
    blocks.push(
      p(`This is a reminder from ${ctx.associationName}. As of ${longDate(ctx.todayIso)}, the board's books show these balances:`),
    );
    for (const u of units) {
      blocks.push(p(`For ${u.label}:`), unitRows(u, ctx.todayIso));
      for (const s of [overdueSentence(u, true), creditSentence(u)]) if (s) blocks.push(p(s));
    }
    blocks.push({ t: "rows", rows: [{ cells: ["Total across your units", formatMoney(total)], strong: true }] });
  }

  blocks.push(...noteBlocks(ctx), accessBlock(ctx));
  blocks.push(
    p(
      `If you've already paid, thank you. Your payment may not be recorded yet.${ctx.hasLogin ? " You can tell the board on the same page." : ""}`,
    ),
    signoff(ctx),
  );

  const { text, html } = compose(blocks, ctx, { category: "dues_reminders", unitLabels: units.map((u) => u.label) });
  return { subject, text, html };
}
