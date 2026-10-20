"use client";

import { useState } from "react";
import { authButton } from "@/components/auth/auth-shell";
import { codesFileText } from "@/lib/security/recovery-codes-text";

/**
 * Shows a new set of recovery codes once. The codes live only in this
 * component's props: nothing is stored in the browser, and leaving the page
 * drops them.
 */
export function RecoveryCodesPanel({
  codes,
  doneLabel,
  onDone,
}: {
  codes: string[];
  doneLabel: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([codesFileText(codes)], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "walkup-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const small =
    "inline-flex min-h-[44px] items-center justify-center rounded-lg border border-line-strong bg-paper px-4 text-[14px] font-semibold text-ink hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-warning-line bg-warning-tint px-3.5 py-3 text-[13px] leading-relaxed text-warning-text">
        <p className="font-semibold">Store these somewhere safe.</p>
        <p className="mt-1">
          This is the only time they are shown. If you lose your authenticator app, one of these codes lets you back in.
          Each works once. Anyone who has them can get past your two-step sign-in, so keep them private, for example in
          a password manager.
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-paper p-4" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c} className="figures text-center text-[15px] font-semibold tracking-wider text-ink">
            {c}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={copy} className={small}>
          {copied ? "Copied" : "Copy codes"}
        </button>
        <button type="button" onClick={download} className={small}>
          Download as a text file
        </button>
      </div>

      <label className="flex items-start gap-2.5 text-[13px] text-ink">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <span>I have saved these codes somewhere safe.</span>
      </label>

      <button type="button" disabled={!saved} onClick={onDone} className={authButton}>
        {doneLabel}
      </button>
    </div>
  );
}
