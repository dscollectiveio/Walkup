import { longDate, shortDate } from "@/lib/dates";
import { cleanHeaderText } from "../sanitize";
import { formatMoney, sumMoney } from "../format";
import type { DuesFacts } from "../facts";
import { accessBlock, compose, greeting, noteBlocks, p, signoff, type Block } from "./layout";
import type { RenderContext, Rendered } from "./types";

/** The standing "before dues are due" rule's email: the earliest charge not yet due. Produced only by the rule. */
export function renderDuesUpcoming(facts: DuesFacts, ctx: RenderContext): Rendered {
  const upcoming = facts.units.flatMap((u) =>
    u.lines.filter((l) => l.due_on >= ctx.todayIso).map((l) => ({ unit: u.label, ...l })),
  );
  if (upcoming.length === 0) {
    // The ledger moved on between the rule and the send; email_facts_current checks owed and overdue, not dates.
    // Fall back to the plain reminder wording rather than inventing a date.
    throw new Error("no upcoming charge in the saved details");
  }
  const first = upcoming.reduce((a, b) => (b.due_on < a.due_on ? b : a)).due_on;
  const onFirst = upcoming.filter((l) => l.due_on === first);
  const amount = sumMoney(onFirst.map((l) => l.balance));
  const subject = cleanHeaderText(`Dues reminder: ${formatMoney(amount)} due ${shortDate(first, ctx.todayIso)}`, 200);

  const byUnit = new Map<string, string[]>();
  for (const l of onFirst) byUnit.set(l.unit, [...(byUnit.get(l.unit) ?? []), l.balance]);
  const sentences = [...byUnit.entries()].map(
    ([unit, bals]) => `${unit} has ${formatMoney(sumMoney(bals))} due on ${longDate(first)}.`,
  );

  const blocks: Block[] = [
    greeting(ctx),
    p(`A friendly heads-up from ${ctx.associationName}: ${sentences.join(" ")}`),
    ...noteBlocks(ctx),
    accessBlock(ctx),
    signoff(ctx),
  ];
  const { text, html } = compose(blocks, ctx, { category: "dues_reminders", unitLabels: facts.units.map((u) => u.label) });
  return { subject, text, html };
}
