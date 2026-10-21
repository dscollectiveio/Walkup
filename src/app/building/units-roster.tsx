"use client";

import { useState } from "react";
import { UnitCard, type Resident } from "./unit-card";
import { specsLine, type UnitRecord } from "./unit-fields";
import { unitTypeLabel } from "@/lib/building/unit-types";
import { UnitDocumentsPanel } from "./unit-documents-panel";
import { BOARD_UNIT_DOCUMENT_COPY } from "@/lib/owner/unit-documents";

export interface RosterUnit {
  unit: UnitRecord;
  residents: Resident[];
  share: number | null;
}

const W = 280;
const ROW_H = 64;
const CORNICE_Y = 6;
const CORNICE_H = 12;
const FLOORS_TOP = CORNICE_Y + CORNICE_H + 2;
const STOOP_H = 22;

/**
 * Rows of the building, top row first. When every unit has a floor, units on
 * the same floor share a row (side by side) and floors stack, highest on top:
 * three units on floor 1 are one flat row, floors 1 to 4 are four stacked
 * rows. When any floor is missing, every unit gets its own row, stacked.
 */
export function buildingRows(units: RosterUnit[]): RosterUnit[][] {
  const floors = units.map((u) => u.unit.floor);
  if (floors.some((f) => f === null || f === undefined)) return [...units].reverse().map((u) => [u]);
  const byFloor = new Map<number, RosterUnit[]>();
  for (const u of units) {
    const f = u.unit.floor as number;
    byFloor.set(f, [...(byFloor.get(f) ?? []), u]);
  }
  return [...byFloor.entries()].sort((a, b) => b[0] - a[0]).map(([, row]) => row);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The building as a cross-section next to its roster, like the dashboard's:
 * one floor per unit, lowest unit at the bottom. Hovering (or focusing) a
 * floor lights its row and fills the panel below with that unit's details;
 * hovering a row lights its floor. Clicking a floor opens its row. Two to six
 * units are drawn; beyond that the list stands alone.
 */
export function UnitsRoster({
  units,
  open,
  onToggle,
  onOpen,
  people,
  canEdit,
  canDelete,
  canEditRoles,
}: {
  units: RosterUnit[];
  open: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  people: { id: string; full_name: string }[];
  canEdit: boolean;
  canDelete: boolean;
  canEditRoles: boolean;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const drawable = units.length >= 2 && units.length <= 6;
  const rows = drawable ? buildingRows(units) : [];
  const H = FLOORS_TOP + rows.length * ROW_H + STOOP_H + 2;
  // The unit that is open in the list is "selected": it stays lit on the building and fills the
  // panel below until another floor is hovered.
  const selectedId = units.find((u) => open.has(u.unit.id))?.unit.id ?? null;
  const active = units.find((u) => u.unit.id === (activeId ?? selectedId)) ?? null;

  function jumpTo(id: string) {
    onOpen(id);
    requestAnimationFrame(() => document.getElementById(`unit-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  const list = (
    <div className="min-w-0 flex-1 space-y-2">
    {canEdit && units.length > 0 ? (
      <details className="rounded-lg border border-line bg-paper">
        <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-medium text-ink">{BOARD_UNIT_DOCUMENT_COPY.addTitle}</summary>
        <div className="border-t border-line px-4 py-3">
          <UnitDocumentsPanel units={units.map((r) => ({ id: r.unit.id, label: r.unit.label }))} />
        </div>
      </details>
    ) : null}
    <ul className="space-y-2">
      {units.map((r) => (
        <UnitCard
          key={r.unit.id}
          unit={r.unit}
          residents={r.residents}
          people={people}
          share={r.share}
          canEdit={canEdit}
          canDelete={canDelete}
          canEditRoles={canEditRoles}
          expanded={open.has(r.unit.id)}
          onToggle={() => onToggle(r.unit.id)}
          onOpen={() => onOpen(r.unit.id)}
          highlighted={activeId === r.unit.id}
          onHover={(h) => setActiveId(h ? r.unit.id : null)}
        />
      ))}
    </ul>
    </div>
  );

  if (!drawable) return list;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="mx-auto w-full max-w-[260px] shrink-0 space-y-3 lg:sticky lg:top-20">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="group" aria-label={`Cross-section of the building, ${units.length} units`}>
          <rect x="14" y={CORNICE_Y} width={W - 28} height={CORNICE_H} rx="2" fill="var(--color-fill)" stroke="var(--color-line-strong)" />
          {rows.flatMap((row, i) => {
            const y = FLOORS_TOP + i * ROW_H;
            const gap = 3;
            const cellW = (W - 40 - gap * (row.length - 1)) / row.length;
            const narrow = row.length >= 3;
            return row.map((r, j) => {
              const x = 20 + j * (cellW + gap);
              const lit = activeId === r.unit.id;
              const selected = selectedId === r.unit.id;
              const owners = r.residents.map((p) => p.fullName).join(", ");
              const chars = Math.max(4, Math.floor((cellW - 18) / (narrow ? 4.6 : 5.4)));
              return (
                <g
                  key={r.unit.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${r.unit.label}${owners ? `, ${owners}` : ""}`}
                  className="cursor-pointer outline-none"
                  onClick={() => jumpTo(r.unit.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      jumpTo(r.unit.id);
                    }
                  }}
                  onMouseEnter={() => setActiveId(r.unit.id)}
                  onMouseLeave={() => setActiveId(null)}
                  onFocus={() => setActiveId(r.unit.id)}
                  onBlur={() => setActiveId(null)}
                >
                  <rect
                    x={x}
                    y={y}
                    width={cellW}
                    height={ROW_H - 3}
                    style={{
                      // Selected: a soft wash of the brand's gold with a gold edge. Hovered: the quiet grey it always had.
                      fill: selected
                        ? "color-mix(in srgb, var(--color-brass) 20%, var(--color-paper))"
                        : lit
                          ? "var(--color-fill)"
                          : "var(--color-paper)",
                      stroke: selected ? "var(--color-brass)" : lit ? "var(--color-slate)" : "var(--color-line)",
                      strokeWidth: selected || lit ? 2 : 1,
                      transition: "fill 300ms ease, stroke 300ms ease",
                    }}
                  />
                  <rect x={x} y={y} width="5" height={ROW_H - 3} fill={r.residents.length ? "var(--color-moss)" : "var(--color-line-strong)"} />
                  <text x={x + 13} y={y + ROW_H / 2 - 4} fontSize={narrow ? 10 : 11} fontWeight="500" fill="var(--color-ink)">
                    {clip(r.unit.label, chars)}
                  </text>
                  <text x={x + 13} y={y + ROW_H / 2 + 9} fontSize={narrow ? 8.5 : 9.5} fill="var(--color-mute)">
                    {owners ? clip(owners, chars) : narrow ? "no owner" : "no owner on file"}
                  </text>
                </g>
              );
            });
          })}
          <rect x="108" y={H - STOOP_H} width="64" height="9" rx="1.5" fill="var(--color-fill)" stroke="var(--color-line-strong)" />
          <rect x="116" y={H - STOOP_H + 9} width="48" height="9" rx="1.5" fill="var(--color-fill)" stroke="var(--color-line-strong)" />
        </svg>

        <div aria-live="polite" className="min-h-[104px] rounded-lg border border-line bg-fill/40 px-3 py-2.5 text-[12px]">
          {active ? (
            <div className="space-y-1">
              <p className="text-[13px] font-bold text-ink">
                {active.unit.label}
                {unitTypeLabel(active.unit.unit_type) ? (
                  <span className="ml-2 font-normal text-mute">{unitTypeLabel(active.unit.unit_type)}</span>
                ) : null}
              </p>
              <p className="text-mute">{specsLine(active.unit)}</p>
              <p className="text-ink">
                {active.residents.length
                  ? active.residents.map((x) => x.fullName).join(", ")
                  : "No one is in this unit yet"}
              </p>
              {active.share !== null ? <p className="text-mute">{`${+active.share.toFixed(2)}% share`}</p> : null}
            </div>
          ) : (
            <p className="text-mute">Hover a floor to see its details. Click it to open the unit.</p>
          )}
        </div>
      </div>
      {list}
    </div>
  );
}
