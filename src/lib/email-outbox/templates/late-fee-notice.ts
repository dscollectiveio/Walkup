import { longDate } from "@/lib/dates";
import { cleanHeaderText } from "../sanitize";
import { formatMoney, isPositive } from "../format";
import type { LateFeeFacts } from "../facts";
import { netOwed } from "./dues-reminder";
import { accessBlock, compose, greeting, noteBlocks, p, signoff, type Block } from "./layout";
import type { RenderContext, Rendered } from "./types";

/**
 * A letter about a fee the board already posted. It never says why the fee
 * was allowed, what law applies or what happens next (money spec 7.3).
 */
export function renderLateFeeNotice(facts: LateFeeFacts, ctx: RenderContext): Rendered {
  const u = facts.units[0];
  const subject = cleanHeaderText(`Late fee on ${u.label}`, 200);
  const blocks: Block[] = [
    greeting(ctx),
    p(`${ctx.associationName} charged a late fee of ${formatMoney(facts.fee_amount)} to ${u.label} on ${longDate(facts.fee_charged_on)}.`),
    p(`Your balance for ${u.label}, including that fee, is ${formatMoney(netOwed(u))}${isPositive(u.credit) ? `, after a payment of ${formatMoney(u.credit)} not yet applied to a charge` : ""}.`),
    ...noteBlocks(ctx),
    p("If you think the fee was charged by mistake, reply to this email and tell us why."),
    accessBlock(ctx),
    signoff(ctx),
  ];
  const { text, html } = compose(blocks, ctx, { category: "dues_reminders", unitLabels: [u.label] });
  return { subject, text, html };
}
