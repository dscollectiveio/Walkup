"use client";

import { useState } from "react";
import { PREVIEW_LABEL, PREVIEW_NOTES } from "@/lib/access/preview";

/** "See what they see": pick a role to read which tabs it gets and what it can and can't do. */
export function RolePreview({ tabsByRole }: { tabsByRole: Record<string, string[]> }) {
  const roles = Object.keys(tabsByRole);
  const [role, setRole] = useState(roles[0] ?? "");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="preview-role" className="text-[12px] font-medium text-ink">
          See what this role sees
        </label>
        <select
          id="preview-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="min-h-[36px] rounded-lg border border-line-strong bg-paper px-3 text-[16px] text-ink sm:text-[13px]"
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {PREVIEW_LABEL[r] ?? r}
            </option>
          ))}
        </select>
      </div>
      {role ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-mute">Tabs</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {(tabsByRole[role] ?? []).map((t) => (
                <li key={t} className="rounded-full border border-line-strong bg-paper px-3 py-1 text-[12px] text-ink">
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-mute">What they can do</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[13px] text-ink">
              {(PREVIEW_NOTES[role] ?? []).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
