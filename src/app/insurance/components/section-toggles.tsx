"use client";

import { OPTIONAL_SECTIONS, SECTION_LABEL, type CoverageType, type SectionKey } from "@/lib/insurance/coverage";

/**
 * "This policy also includes" (§9.3.4 item 2): checkbox chips for the parts a
 * package of this kind may carry. 44 px targets.
 */
export function SectionToggles({
  coverage,
  included,
  onChange,
}: {
  coverage: CoverageType;
  included: SectionKey[];
  onChange: (next: SectionKey[]) => void;
}) {
  const optional = OPTIONAL_SECTIONS[coverage] ?? [];
  if (optional.length === 0) return null;
  return (
    <fieldset>
      <legend className="text-[12px] font-medium text-ink">This policy also includes</legend>
      <p className="mt-1 text-[12px] text-mute">
        Many master policies are packages that also include liability or D&amp;O. Tick what this one includes.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {optional.map((s) => {
          const on = included.includes(s);
          return (
            <label
              key={s}
              className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border px-3.5 text-[13px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink ${
                on ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-ink hover:bg-fill"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                onChange={(e) => onChange(e.target.checked ? [...included, s] : included.filter((x) => x !== s))}
              />
              <span aria-hidden="true">{on ? "✓" : "+"}</span>
              {SECTION_LABEL[s]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
