interface StatCell {
  label: string;
  value: string | null; // null renders an em-dash
  note: string;
}

/** Three quiet numbers under the showcase cards. A missing value is an
 * em-dash with an honest note, never a fabricated zero. */
export function StatStrip({ cells }: { cells: StatCell[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {cells.map((c) => (
        <div key={c.label} className="rounded-xl border border-line bg-paper px-5 py-4">
          <div className="text-[11px] text-mute">{c.label}</div>
          <div className="figures mt-1 text-[20px] text-ink">
            {c.value ?? <span className="text-line-strong">—</span>}
          </div>
          <div className="mt-0.5 text-[11px] text-mute-soft">{c.note}</div>
        </div>
      ))}
    </div>
  );
}
