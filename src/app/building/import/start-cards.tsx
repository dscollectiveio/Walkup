import Link from "next/link";
import { KIND_LABEL, templateUrl, type ImportKind } from "@/lib/import/kinds";
import { BTN_PRIMARY, BTN_SECONDARY } from "./ui";

const CARDS: { title: string; sentence: string; kinds: { kind: ImportKind; label: string }[] }[] = [
  {
    title: "Units and owners",
    sentence: "Each unit, who owns it, how to reach them, their share and their dues. Start here.",
    kinds: [{ kind: "units_owners", label: "Upload your file" }],
  },
  {
    title: "Contractors",
    sentence: "The people you hire. Tax ID numbers are never imported.",
    kinds: [{ kind: "contractors", label: "Upload your file" }],
  },
  {
    title: "Opening balances",
    sentence: "What the association had and owed on the day your Walkup books begin, and what each unit owed.",
    kinds: [
      { kind: "opening_accounts", label: "Account balances" },
      { kind: "opening_units", label: "What each unit owed" },
    ],
  },
  {
    title: "Past transactions",
    sentence: "Last year's deposits and payments, so reports and the tax forms have history.",
    kinds: [{ kind: "transactions", label: "Upload your file" }],
  },
];

export function StartCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {CARDS.map((card) => (
        <section key={card.title} className="flex flex-col rounded-xl border border-line bg-paper p-5">
          <h2 className="text-[15px] font-bold text-ink">{card.title}</h2>
          <p className="mt-1 flex-1 text-[13px] leading-relaxed text-mute">{card.sentence}</p>
          <div className="mt-4 space-y-3">
            {card.kinds.map(({ kind, label }) => (
              <div key={kind} className="space-y-2">
                {card.kinds.length > 1 ? <p className="text-[12px] font-medium text-ink">{KIND_LABEL[kind]}</p> : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/building/import/new?kind=${kind}`} className={BTN_PRIMARY}>
                    {label}
                  </Link>
                  <span className="text-[12px] text-mute">Download template:</span>
                  <a href={templateUrl(kind, "csv")} className={`${BTN_SECONDARY} !min-h-[36px] !px-3`} download>
                    CSV
                  </a>
                  <a href={templateUrl(kind, "xlsx")} className={`${BTN_SECONDARY} !min-h-[36px] !px-3`} download>
                    Excel
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
