"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface BuildingUnit {
  id: string;
  label: string;
  ownerName: string | null;
  status: "current" | "behind" | "vacant" | "hidden";
  owedLabel: string | null;
}

const RAIL: Record<BuildingUnit["status"], string> = {
  current: "var(--color-moss)",
  behind: "var(--color-rust)",
  vacant: "var(--color-line-strong)",
  hidden: "var(--color-line-strong)",
};

const STATUS_WORD: Record<BuildingUnit["status"], string> = {
  current: "up to date",
  behind: "behind",
  vacant: "no owner on file",
  hidden: "not shown to you",
};

const STATUS_TAG: Record<BuildingUnit["status"], string> = {
  current: "text-good-text",
  behind: "text-bad-text",
  vacant: "text-mute-soft",
  hidden: "text-mute-soft",
};

/**
 * The three-flat as a cross-section: one floor per unit, lowest unit at the
 * bottom, a stoop below and a cornice above — the stair from the mark,
 * drawn at building scale. Floors are generated from the unit list (2–6
 * scale into a fixed height; beyond six the list stands alone), and every
 * floor is a real keyboard target that opens the unit's payment history.
 * Status is never carried by the rail color alone — the word and the amount
 * sit right on the floor.
 */
export function Building({
  units,
  duesLine,
}: {
  units: BuildingUnit[];
  duesLine: string | null;
}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(null);

  const drawable = units.length >= 2 && units.length <= 6;

  const W = 280;
  const H = 240;
  const corniceY = 6;
  const corniceH = 12;
  const floorsTop = corniceY + corniceH + 2;
  const stoopH = 22;
  const floorsHeight = H - floorsTop - stoopH - 2;
  const floorH = drawable ? floorsHeight / units.length : 0;

  // Lowest unit at the bottom: row i (top-down) shows the (n-1-i)th unit.
  const topDown = [...units].reverse();

  function open(id: string) {
    router.push(`/units/${id}`);
  }

  return (
    <section className="rounded-xl border border-line bg-paper">
      <header className="border-b border-line px-5 py-4">
        <h2 className="font-semibold tracking-tight text-ink">The building</h2>
        <p className="mt-1 text-[13px] text-mute">Click a floor to see its payment history.</p>
      </header>

      <div className="space-y-4 px-5 py-4">
        {drawable ? (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="mx-auto w-full max-w-[260px]"
            role="group"
            aria-label={`Cross-section of the building, ${units.length} units`}
          >
            {/* Cornice */}
            <rect x="14" y={corniceY} width={W - 28} height={corniceH} rx="2" fill="var(--color-fill)" stroke="var(--color-line-strong)" />

            {topDown.map((u, i) => {
              const y = floorsTop + i * floorH;
              const active = activeId === u.id;
              return (
                <g
                  key={u.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${u.label}${u.ownerName ? `, ${u.ownerName}` : ""} — ${
                    u.owedLabel ?? STATUS_WORD[u.status]
                  }`}
                  className="cursor-pointer outline-none"
                  onClick={() => open(u.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open(u.id);
                    }
                  }}
                  onMouseEnter={() => setActiveId(u.id)}
                  onMouseLeave={() => setActiveId(null)}
                  onFocus={() => setActiveId(u.id)}
                  onBlur={() => setActiveId(null)}
                >
                  <rect
                    x="20"
                    y={y}
                    width={W - 40}
                    height={floorH - 3}
                    fill={active ? "var(--color-fill)" : "var(--color-paper)"}
                    stroke={active ? "var(--color-slate)" : "var(--color-line)"}
                    strokeWidth={active ? 2 : 1}
                  />
                  <rect x="20" y={y} width="5" height={floorH - 3} fill={RAIL[u.status]} />
                  <text x="36" y={y + floorH / 2 - 4} fontSize="11" fontWeight="500" fill="var(--color-ink)">
                    {u.label}
                  </text>
                  <text
                    x="36"
                    y={y + floorH / 2 + 9}
                    fontSize="9.5"
                    fill={u.status === "behind" ? "var(--color-bad-text)" : "var(--color-mute)"}
                    style={u.status === "behind" ? { fontFamily: "var(--font-serif)", fontWeight: 600 } : undefined}
                  >
                    {u.owedLabel ?? STATUS_WORD[u.status]}
                  </text>
                </g>
              );
            })}

            {/* Stoop — the mark's stair, at building scale */}
            <rect x="108" y={H - stoopH} width="64" height="9" rx="1.5" fill="var(--color-fill)" stroke="var(--color-line-strong)" />
            <rect x="116" y={H - stoopH + 9} width="48" height="9" rx="1.5" fill="var(--color-fill)" stroke="var(--color-line-strong)" />
          </svg>
        ) : null}

        <div>
          <ul className="divide-y divide-line">
            {units.map((u) => (
              <li key={u.id}>
                <Link
                  href={`/units/${u.id}`}
                  onMouseEnter={() => setActiveId(u.id)}
                  onMouseLeave={() => setActiveId(null)}
                  className={`flex items-center justify-between gap-3 rounded px-2 py-2.5 transition-colors ${
                    activeId === u.id ? "bg-fill" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span className="text-[13px] font-medium text-ink">{u.label}</span>
                    {u.ownerName ? (
                      <span className="ml-2 text-[12px] text-mute">{u.ownerName}</span>
                    ) : null}
                  </span>
                  <span className={`shrink-0 text-[12px] ${STATUS_TAG[u.status]}`}>
                    {u.status === "behind" && u.owedLabel ? (
                      <span className="figures">{u.owedLabel}</span>
                    ) : (
                      STATUS_WORD[u.status]
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {duesLine ? (
            <p className="mt-3 border-t border-line pt-3 text-[11px] text-mute">{duesLine}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
