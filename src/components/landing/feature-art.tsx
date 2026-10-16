import type { ReactNode } from "react";

/**
 * Small, quiet pictures of Walkup's screens for the landing page's feature
 * cards. Drawn in code (never a screenshot of real data) with the same
 * made-up example building as the hero. Decorative: hidden from screen
 * readers, and the card's words say everything the picture shows. The panel
 * is a light "screen" in both themes, like a photo of the product.
 */

export type FeatureArtKind = "books" | "dues" | "budget" | "statements" | "tax" | "repairs";

const INK = "#1B2A41";
const MUTE = "text-[#5B6475]";

function Pill({ tone, children }: { tone: "good" | "warn" | "bad" | "info"; children: ReactNode }) {
  const cls = {
    good: "bg-[#e8f3ec] text-[#1f6b45]",
    warn: "bg-[#f8efdb] text-[#8a5f22]",
    bad: "bg-[#f7ebe6] text-[#7a2519]",
    info: "bg-[#eaeff7] text-[#1d3560]",
  }[tone];
  return <span className={`whitespace-nowrap rounded-full px-1.5 py-px text-[9px] font-semibold ${cls}`}>{children}</span>;
}

function Bar({ pct, color, mark }: { pct: number; color: string; mark?: number }) {
  return (
    <div className="relative h-1.5 rounded-full bg-[#ece5d6]">
      <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: color }} />
      {mark ? <div className="absolute -top-0.5 h-2.5 w-px bg-[#1B2A41]" style={{ left: `${mark}%` }} /> : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="mb-5 h-[148px] overflow-hidden rounded-lg border border-[#E3DED3] bg-white text-[#1B2A41] shadow-[0_8px_24px_-12px_rgba(27,42,65,0.25)] transition-transform duration-500 ease-out group-hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold text-white" style={{ background: INK }}>
        <span className="flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
          <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#D9A441]" />
        </span>
        {title}
      </div>
      <div className="space-y-1.5 p-3">{children}</div>
    </div>
  );
}

const Row = ({ children }: { children: ReactNode }) => <div className="flex items-center justify-between gap-2 text-[10.5px]">{children}</div>;

export function FeatureArt({ kind }: { kind: FeatureArtKind }) {
  switch (kind) {
    case "books":
      return (
        <Panel title="Bank feed">
          {[
            ["ComEd", "Utilities", "-$212.40"],
            ["Unit 3 Zelle", "Dues", "+$475.00"],
            ["GreenScape LLC", "Landscaping", "-$390.00"],
          ].map(([who, cat, amt]) => (
            <Row key={who}>
              <span className="min-w-0 flex-1 truncate font-medium">{who}</span>
              <Pill tone="info">{cat}</Pill>
              <span className="w-14 text-right font-semibold tabular-nums">{amt}</span>
            </Row>
          ))}
        </Panel>
      );
    case "dues":
      return (
        <Panel title="HOA dues">
          {(
            [
              ["Unit 1", "Up to date", "good"],
              ["Unit 2", "Up to date", "good"],
              ["Unit 3", "$475 owed", "bad"],
              ["Unit 4", "Up to date", "good"],
            ] as const
          ).map(([u, label, tone]) => (
            <Row key={u}>
              <span className="font-medium">{u}</span>
              <Pill tone={tone}>{label}</Pill>
            </Row>
          ))}
        </Panel>
      );
    case "budget":
      return (
        <Panel title="Budget">
          {(
            [
              ["Insurance", 76, "#2d4a7c"],
              ["Landscaping", 88, "#d9a441"],
              ["Utilities", 52, "#2f7a5c"],
            ] as const
          ).map(([n, pct, c]) => (
            <div key={n}>
              <div className="mb-0.5 flex justify-between text-[10px]">
                <span className="font-medium">{n}</span>
                <span className={`tabular-nums ${MUTE}`}>{pct}%</span>
              </div>
              <Bar pct={pct} color={c} />
            </div>
          ))}
        </Panel>
      );
    case "statements":
      return (
        <Panel title="Financial statements">
          {[
            ["Dues income", "$5,700"],
            ["Insurance", "-$1,285"],
            ["Utilities", "-$604"],
          ].map(([k, v]) => (
            <Row key={k}>
              <span>{k}</span>
              <span className="tabular-nums">{v}</span>
            </Row>
          ))}
          <div className="flex items-center justify-between border-t border-[#E3DED3] pt-1.5 text-[10.5px] font-semibold">
            <span>Net income</span>
            <span className="flex items-center gap-1.5 tabular-nums">
              $3,811
              <span className="rounded border border-[#cdc6b6] px-1 py-px text-[8.5px]">PDF</span>
            </span>
          </div>
        </Panel>
      );
    case "tax":
      return (
        <Panel title="Taxes">
          <Row>
            <span className="font-semibold">Form 1120-H</span>
            <Pill tone="good">You qualify</Pill>
          </Row>
          <div>
            <div className="mb-0.5 flex justify-between text-[10px]">
              <span>Member income</span>
              <span className={`tabular-nums ${MUTE}`}>100% (needs 60%)</span>
            </div>
            <Bar pct={100} color="#2f7a5c" mark={60} />
          </div>
          <div>
            <div className="mb-0.5 flex justify-between text-[10px]">
              <span>Spent on the building</span>
              <span className={`tabular-nums ${MUTE}`}>100% (needs 90%)</span>
            </div>
            <Bar pct={100} color="#2f7a5c" mark={90} />
          </div>
        </Panel>
      );
    case "repairs":
      return (
        <Panel title="Repairs and upkeep">
          {(
            [
              ["Roof leak, Unit 4", "Urgent", "bad"],
              ["Gutter cleaning", "Upkeep", "warn"],
              ["Hallway light", "Done", "good"],
            ] as const
          ).map(([t, label, tone]) => (
            <Row key={t}>
              <span className="min-w-0 flex-1 truncate font-medium">{t}</span>
              <Pill tone={tone}>{label}</Pill>
            </Row>
          ))}
        </Panel>
      );
  }
}
