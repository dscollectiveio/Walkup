export interface AmendmentHistoryEntry {
  id: string;
  effectiveFrom: string;
  reason: string | null;
  lines: { unitLabel: string; percentage: number }[];
}

/** Plain, read-only. No client state — history doesn't change once recorded. */
export function AmendmentHistory({ amendments }: { amendments: AmendmentHistoryEntry[] }) {
  if (amendments.length === 0) {
    return <p className="text-[12px] text-mute-soft">No ownership amendments recorded yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {amendments.map((a) => (
        <li key={a.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[12px] font-medium text-ink">Effective {a.effectiveFrom}</span>
            {a.reason ? <span className="text-[11px] text-mute">{a.reason}</span> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mute">
            {a.lines.map((l) => (
              <span key={l.unitLabel}>
                {l.unitLabel} <span className="figures text-ink">{l.percentage}%</span>
              </span>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
