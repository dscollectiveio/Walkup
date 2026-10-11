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

/**
 * "Rules · 3" in the filters row; the list opens inline beneath it. Rendered
 * as a fragment so the button sits at the right of a flex-wrap row and the
 * list takes the full width below it.
 */
export function RulesToggle({ rules, canEdit }: { rules: RuleRecord[]; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  if (rules.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="ml-auto text-[12px] text-mute underline-offset-2 hover:text-ink hover:underline"
      >
        Rules · <span className="figures">{rules.length}</span>
      </button>
      {open ? (
        <div className="basis-full rounded-lg border border-line bg-fill/40 px-3 py-1">
          <p className="py-2 text-[12px] text-mute">
            Pre-fill new transactions as they sync; a person still posts them. Saved when you answer yes to “Always
            file … as …?”.
          </p>
          <RulesList rules={rules} canEdit={canEdit} />
        </div>
      ) : null}
    </>
  );
}

function RulesList({ rules, canEdit }: { rules: RuleRecord[]; canEdit: boolean }) {
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
