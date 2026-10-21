import { CollapsibleCard } from "@/components/collapsible-card";
import { btnPrimary } from "@/components/repairs/styles";

interface Item {
  key: string;
  title: string;
  done: boolean;
  doneText: string;
  todoText: string;
  action: { label: string; href: string };
}

/**
 * "Before this tab works for you": the three things the forms, dates and checks below depend on, each a
 * plain done or to-do line with the one link that does it. Nothing here is optional: until the EIN is on
 * file, the income is classified and the W-9s are in, the 1120-H check and the 1099s can't be trusted.
 */
export function SetupChecklist({
  ein,
  incomeAccounts,
  unconfirmedIncome,
  missingW9,
}: {
  ein: boolean;
  incomeAccounts: number;
  unconfirmedIncome: number;
  missingW9: string[];
}) {
  const items: Item[] = [
    {
      key: "ein",
      title: "The association's EIN",
      done: ein,
      doneText: "On file.",
      todoText: "Every federal form asks for the employer identification number.",
      action: { label: "Add your EIN", href: "/building" },
    },
    {
      key: "income",
      title: "Income classified",
      done: unconfirmedIncome === 0,
      doneText: incomeAccounts === 0 ? "No income recorded this year yet." : `All ${incomeAccounts} income ${incomeAccounts === 1 ? "account is" : "accounts are"} confirmed.`,
      todoText: `${unconfirmedIncome} income ${unconfirmedIncome === 1 ? "account needs" : "accounts need"} a board member to say whether it is owner income. The 1120-H check can't run until then.`,
      action: { label: "Classify your income", href: "#income" },
    },
    {
      key: "w9",
      title: "W-9s from the contractors you paid",
      done: missingW9.length === 0,
      doneText: "Every contractor paid at or above the 1099 threshold has one on file.",
      todoText:
        missingW9.length > 0
          ? `Missing from ${missingW9.slice(0, 3).join(", ")}${missingW9.length > 3 ? ` and ${missingW9.length - 3} more` : ""}. Their 1099-NEC needs the taxpayer ID from the W-9, so ask now rather than in January.`
          : "",
      action: { label: "Open Contractors", href: "/repairs?view=contractors" },
    },
  ];
  const open = items.filter((i) => !i.done).length;

  return (
    <section id="setup-first" className="scroll-mt-20">
      <CollapsibleCard
        title="Do these first"
        hint={
          open === 0
            ? "All set. Everything below can be trusted."
            : "These need to be done before this tab works well. The forms, dates and checks below depend on them."
        }
      >
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <li
              key={i.key}
              className={`-mx-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 ${i.done ? "" : "bg-bad-tint"}`}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                    i.done ? "bg-moss text-paper" : "border border-warning-line bg-warning-tint text-warning-text"
                  }`}
                >
                  {i.done ? "✓" : "!"}
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-ink">
                    {i.title} <span className="sr-only">{i.done ? "(done)" : "(to do)"}</span>
                  </p>
                  <p className="text-[12px] text-mute">{i.done ? i.doneText : i.todoText}</p>
                </div>
              </div>
              {i.done ? null : (
                <a href={i.action.href} className={`${btnPrimary} shrink-0`}>
                  {i.action.label}
                </a>
              )}
            </li>
          ))}
        </ul>
      </CollapsibleCard>
    </section>
  );
}
