"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { trackPremium } from "./policy-actions";

/** Puts the premium on the bills list, one bill per policy, so it shows under "Coming up" (§6.6, §9.1 item 3). */
export function TrackPremium({
  policyId,
  categories,
  defaultCategoryId,
}: {
  policyId: string;
  categories: { id: string; name: string }[];
  defaultCategoryId: string | null;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(defaultCategoryId ?? "");
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) return <p className="text-[12px] text-good-text">Added to your bills. It shows under &ldquo;Coming up&rdquo; before it&rsquo;s due.</p>;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor={`premium-cat-${policyId}`} className="block text-[12px] font-medium text-ink">Paid from</label>
        <select
          id={`premium-cat-${policyId}`}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="mt-1 min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 text-[13px] text-ink"
        >
          <option value="">Choose…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <button
        type="button"
        disabled={!accountId || pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await trackPremium(policyId, accountId);
            if ("error" in r) setError(r.error);
            else {
              setDone(true);
              router.refresh();
            }
          })
        }
        className="min-h-[44px] rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-50"
      >
        {pending ? "Adding…" : "Track the premium as a bill"}
      </button>
      {error ? <span className="w-full text-[12px] text-bad-text">{error}</span> : null}
    </div>
  );
}
