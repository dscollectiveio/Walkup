import { Check } from "lucide-react";
import { PREVIEW_FEATURES, PREVIEW_LABEL, PREVIEW_LIMITS, PREVIEW_NOTES } from "@/lib/access/preview";

/**
 * "See what a role sees" as a table: the roles across the top, the features (the sidebar's tabs) down the left, a
 * check where the role gets that feature, with a few words where it is a smaller version. Under it, a row of plain
 * notes on what each role can and can't do. Whether a role has a feature comes from the real sidebar (navFor), so a
 * change to the sidebar shows here without an edit.
 */
export function RolePreview({ tabsByRole }: { tabsByRole: Record<string, string[]> }) {
  const roles = Object.keys(tabsByRole);
  const features = PREVIEW_FEATURES;
  const has = (role: string, hrefs: string[]) => (tabsByRole[role] ?? []).some((h) => hrefs.includes(h));

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <caption className="sr-only">Which tabs each role gets, and what each role can do</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-44 border-b border-line-strong bg-paper px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-mute">
              Feature
            </th>
            {roles.map((r) => (
              <th key={r} scope="col" className="border-b border-line-strong bg-fill px-2 py-2 text-center text-[12px] font-semibold text-ink">
                {PREVIEW_LABEL[r] ?? r}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {features.map((f) => (
            <tr key={f.label} className="border-b border-line">
              <th scope="row" className="sticky left-0 z-10 bg-paper px-3 py-2 text-left font-medium text-ink">
                {f.label}
              </th>
              {roles.map((r) => (
                <td key={r} className="px-2 py-2 text-center">
                  {has(r, f.hrefs) ? (
                    <>
                      <Check size={16} strokeWidth={2.4} aria-hidden="true" className="mx-auto text-good" />
                      <span className="sr-only">Yes</span>
                      {PREVIEW_LIMITS[r]?.[f.label] ? (
                        <span className="mt-0.5 block text-[10px] leading-tight text-mute">{PREVIEW_LIMITS[r][f.label]}</span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true" className="text-mute-soft">
                        &ndash;
                      </span>
                      <span className="sr-only">No</span>
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
          <tr className="align-top">
            <th scope="row" className="sticky left-0 z-10 bg-paper px-3 py-3 text-left font-medium text-ink">
              What they can do
            </th>
            {roles.map((r) => (
              <td key={r} className="px-2 py-3 text-left text-[12px] leading-snug text-ink">
                <ul className="list-disc space-y-1.5 pl-4">
                  {(PREVIEW_NOTES[r] ?? []).map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
