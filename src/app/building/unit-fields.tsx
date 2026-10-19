import { UNIT_TYPES } from "@/lib/building/unit-types";
import { IntegerInput } from "@/components/integer-input";
import { BathroomsInput } from "@/components/bathrooms-input";
import { bathroomsValue, formatBathrooms } from "@/lib/building/bathrooms";

export interface UnitRecord {
  id: string;
  label: string;
  unit_type: string | null;
  sort_order: number;
  floor: number | null;
  notes: string | null;
  square_footage: number | null;
  bedroom_count: number | null;
  full_bathrooms: number | null;
  half_bathrooms: number | null;
}

/** "850 sq ft · 2 beds · 1.5 baths", or a note that nothing is on file. */
export function specsLine(u: UnitRecord): string {
  const parts: string[] = [];
  if (u.square_footage) parts.push(`${u.square_footage.toLocaleString("en-US")} sq ft`);
  if (u.bedroom_count !== null) parts.push(`${u.bedroom_count} bed${u.bedroom_count === 1 ? "" : "s"}`);
  const baths = bathroomsValue(u.full_bathrooms, u.half_bathrooms);
  if (baths !== null) parts.push(`${formatBathrooms(baths)} bath${baths === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" · ") : "No specs on file";
}

const input = "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink";
const label = "block text-[12px] font-medium text-ink";
const optional = <span className="ml-1 font-normal text-mute-soft">optional</span>;

/** The unit's own fields, for adding a unit or editing one. `unit` fills in the current values. */
export function UnitFields({ unit, idPrefix }: { unit?: UnitRecord; idPrefix: string }) {
  const id = (n: string) => `${idPrefix}-${n}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor={id("label")} className={label}>
          Label
        </label>
        <input id={id("label")} name="label" required placeholder="Unit 4" defaultValue={unit?.label} className={input} />
      </div>
      <div>
        <label htmlFor={id("type")} className={label}>
          Type of unit{optional}
        </label>
        <select id={id("type")} name="unit_type" defaultValue={unit?.unit_type ?? ""} className={input}>
          <option value="">Not set</option>
          {UNIT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={id("floor")} className={label}>
          Floor{optional}
        </label>
        <input id={id("floor")} name="floor" type="number" min="-5" max="200" step="1" placeholder="1" defaultValue={unit?.floor ?? ""} className={input} />
      </div>
      <div>
        <label htmlFor={id("sqft")} className={label}>
          Square footage{optional}
        </label>
        <IntegerInput id={id("sqft")} name="square_footage" defaultValue={unit?.square_footage} placeholder="1,250" className={input} />
      </div>
      <div>
        <label htmlFor={id("bed")} className={label}>
          Bedrooms{optional}
        </label>
        <input id={id("bed")} name="bedroom_count" type="number" min="0" step="1" defaultValue={unit?.bedroom_count ?? ""} className={input} />
      </div>
      <div>
        <label htmlFor={id("baths")} className={label}>
          Bathrooms{optional}
          <span className="ml-1 font-normal text-mute-soft">.5 for a half bath</span>
        </label>
        <BathroomsInput id={id("baths")} name="bathrooms" defaultValue={unit ? bathroomsValue(unit.full_bathrooms, unit.half_bathrooms) : null} className={input} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={id("notes")} className={label}>
          Notes{optional}
        </label>
        <textarea id={id("notes")} name="notes" rows={2} maxLength={1000} placeholder="Anything worth remembering about this unit" defaultValue={unit?.notes ?? ""} className={input} />
      </div>
    </div>
  );
}
