"use client";

import Link from "next/link";
import { useCallback, useSyncExternalStore } from "react";
import type { ChecklistItem } from "@/lib/insurance/emails";
import { ImportUploader } from "../../components/insurance-uploader";
import { btnGhost, linkClass } from "../../components/styles";

/**
 * After the board records its choice of a quote (insurance-spec §9.10a,
 * §10.5): "Next steps for switching insurers", built from the board's own
 * data, and the reminder to upload the declarations the insurer issues.
 * Ticks are a convenience kept in this browser only (localStorage per
 * policy); nothing about them is shared or required.
 */

const EVENT = "walkup:switching-checklist";
const storageKey = (policyId: string) => `walkup.insurance.switching.${policyId}`;
const memory = new Map<string, string>();

function read(policyId: string): string {
  try {
    return window.localStorage.getItem(storageKey(policyId)) ?? memory.get(policyId) ?? "[]";
  } catch {
    return memory.get(policyId) ?? "[]";
  }
}

function write(policyId: string, keys: string[]) {
  const v = JSON.stringify(keys);
  memory.set(policyId, v);
  try {
    window.localStorage.setItem(storageKey(policyId), v);
  } catch {
    // kept in memory for this page view
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

function parse(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function SwitchingChecklist({ policyId, items }: { policyId: string; items: ChecklistItem[] }) {
  const raw = useSyncExternalStore(subscribe, () => read(policyId), () => "[]");
  const done = new Set(parse(raw));
  const toggle = useCallback(
    (key: string, on: boolean) => {
      const next = new Set(parse(read(policyId)));
      if (on) next.add(key);
      else next.delete(key);
      write(policyId, [...next]);
    },
    [policyId],
  );
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="switching-title" className="rounded-xl border border-line bg-paper px-5 py-4">
      <h2 id="switching-title" className="eyebrow text-mute">
        Next steps for switching insurers
      </h2>
      <p className="mt-1.5 text-[13px] text-mute">Tick each one when it&rsquo;s done. The ticks are kept in this browser only.</p>
      <ul className="mt-3 divide-y divide-line">
        {items.map((it) => (
          <li key={it.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <label className="flex min-h-[44px] flex-1 items-center gap-3 text-[13px] text-ink">
              <input type="checkbox" checked={done.has(it.key)} onChange={(e) => toggle(it.key, e.target.checked)} />
              <span className={done.has(it.key) ? "text-mute line-through" : undefined}>{it.text}</span>
            </label>
            {it.action ? (
              <Link href={it.action.href} className={btnGhost}>
                {it.action.label}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** §10.5 step 7: the policy still carries the quote's figures; the issued declarations update this policy (§10.7). */
export function IssuedDeclarationsBanner({ policyId, aiOn }: { policyId: string; aiOn: boolean }) {
  return (
    <section className="space-y-3 border-l-[3px] border-info bg-info-tint px-5 py-4">
      <p className="text-[13px] text-info-text">When the insurer issues the policy, upload its declarations to replace the quote figures.</p>
      {aiOn ? (
        <ImportUploader
          aiOn
          mode="policy"
          label="Upload the declarations"
          readHref={(readId) => `/insurance/import/${readId}?update=${policyId}`}
        />
      ) : (
        <p className="text-[13px]">
          Keep the declarations on file under Documents below, then{" "}
          <Link href={`/insurance/policies/${policyId}/edit`} className={linkClass}>
            edit the policy
          </Link>{" "}
          to match them.
        </p>
      )}
    </section>
  );
}
