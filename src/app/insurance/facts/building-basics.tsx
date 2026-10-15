"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CONSTRUCTION_TYPES } from "@/lib/insurance/facts";
import { saveBuildingBasics } from "../facts-actions";
import { btnGhost, errorBlock, inputClass, labelClass } from "../components/styles";
import { Toast } from "../components/toast";

/**
 * "From Building Info" (§9.8 item 0): year built, construction, stories and
 * roof year, which board members edit here through a narrow RPC. Accountants
 * see them read-only.
 */
export function BuildingBasics({
  initial,
  canEdit,
}: {
  initial: { yearBuilt: number | null; constructionType: string | null; stories: number | null; roofReplacedYear: number | null };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stamp, setStamp] = useState(0);
  const num = (v: FormDataEntryValue | null) => {
    const t = String(v ?? "").trim();
    return t === "" ? null : Number(t);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          setError(null);
          const r = await saveBuildingBasics({
            yearBuilt: num(fd.get("year_built")),
            constructionType: String(fd.get("construction_type") ?? "") || null,
            stories: num(fd.get("stories")),
            roofReplacedYear: num(fd.get("roof_replaced_year")),
          });
          if ("error" in r) setError(r.error);
          else {
            setStamp(Date.now());
            router.refresh();
          }
        });
      }}
      className="space-y-4"
    >
      <fieldset disabled={!canEdit || pending} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="basics-year" className={labelClass}>
            Year built
          </label>
          <input id="basics-year" name="year_built" inputMode="numeric" defaultValue={initial.yearBuilt ?? ""} className={`${inputClass} figures`} />
        </div>
        <div>
          <label htmlFor="basics-construction" className={labelClass}>
            Construction
          </label>
          <select id="basics-construction" name="construction_type" defaultValue={initial.constructionType ?? ""} className={inputClass}>
            <option value="">Not sure</option>
            {CONSTRUCTION_TYPES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="basics-stories" className={labelClass}>
            Stories
          </label>
          <input id="basics-stories" name="stories" inputMode="numeric" defaultValue={initial.stories ?? ""} className={`${inputClass} figures`} />
        </div>
        <div>
          <label htmlFor="basics-roof" className={labelClass}>
            Roof last replaced
          </label>
          <input id="basics-roof" name="roof_replaced_year" inputMode="numeric" defaultValue={initial.roofReplacedYear ?? ""} className={`${inputClass} figures`} />
        </div>
      </fieldset>
      <p className="text-[12px] text-mute">Also shown in Building Info.</p>
      {error ? <p className={errorBlock}>{error}</p> : null}
      {canEdit ? (
        <button type="submit" className={btnGhost} disabled={pending}>
          {pending ? "Saving…" : "Save building details"}
        </button>
      ) : null}
      <Toast message={stamp ? "Saved." : null} stamp={stamp} />
    </form>
  );
}
