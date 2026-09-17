"use client";

import { useState, useTransition } from "react";
import { deleteCategorizationRule } from "./actions";

export interface RuleRecord {
  id: string;
  pattern: string;
  kindLabel: string;
  target: string | null;
  auto_post: boolean;
}

export function RulesList({ rules, canEdit }: { rules: RuleRecord[]; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <ul className="divide-y divide-line text-[13px]">
      {rules.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div>
            <span className="text-ink">“{r.pattern}”</span>
            <span className="ml-2 text-[12px] text-mute">
              → {r.kindLabel}
              {r.target ? ` · ${r.target}` : ""}
            </span>
            {r.auto_post ? (
              <span className="ml-2 rounded-full bg-info-tint px-2 py-0.5 text-[11px] text-info-text">
                posts on sync
              </span>
            ) : null}
          </div>
          {canEdit ? (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const result = await deleteCategorizationRule(r.id);
                  if (result.error) setError(result.error);
                })
              }
              className="text-[12px] text-mute underline-offset-2 hover:underline disabled:opacity-50"
            >
              Remove
            </button>
          ) : null}
        </li>
      ))}
      {error ? <li className="py-2 text-[12px] text-bad-text">{error}</li> : null}
    </ul>
  );
}
