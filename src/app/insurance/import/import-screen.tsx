"use client";

import Link from "next/link";
import { useState } from "react";
import { ImportUploader } from "../components/insurance-uploader";
import { inputClass, labelClass, linkClass } from "../components/styles";

/**
 * The upload half of /insurance/import (§9.3.1): "This is" Our policy / A
 * quote, and for a quote who it is from (which links an open request).
 */
export function ImportScreen({
  aiOn,
  contacts,
  manualCoverage,
}: {
  aiOn: boolean;
  contacts: { id: string; name: string; openRequestId: string | null }[];
  manualCoverage: string | null;
}) {
  const [mode, setMode] = useState<"policy" | "quote">("policy");
  const [from, setFrom] = useState("");
  const requestId = mode === "quote" ? contacts.find((c) => c.id === from)?.openRequestId ?? null : null;
  const qs = (params: Record<string, string | null>) => {
    const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
    return q ? `?${q}` : "";
  };
  const manualPolicy = `/insurance/policies/new${qs({ coverage: manualCoverage })}`;
  const manualQuote = `/insurance/quotes/new${qs({ coverage: manualCoverage, contact: from || null })}`;

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className={labelClass}>This is</legend>
        <div className="mt-1 inline-flex rounded-full border border-line bg-paper p-0.5">
          {(["policy", "quote"] as const).map((m) => (
            <label
              key={m}
              className={`inline-flex min-h-[44px] cursor-pointer items-center rounded-full px-4 text-[13px] font-medium has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink ${
                mode === m ? "bg-ink text-paper" : "text-mute hover:text-ink"
              }`}
            >
              <input type="radio" name="import-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
              {m === "policy" ? "Our policy" : "A quote"}
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "quote" ? (
        <div className="max-w-sm">
          <label htmlFor="quote-from" className={labelClass}>
            From
          </label>
          <select id="quote-from" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass}>
            <option value="">Someone else</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <ImportUploader
        key={`${mode}-${requestId ?? ""}`}
        aiOn={aiOn}
        mode={mode}
        quoteRequestId={requestId}
        stayOnImport
        manualHref={
          mode === "quote"
            ? `/insurance/quotes/new?document={id}${requestId ? `&request=${requestId}` : ""}`
            : `/insurance/policies/new?document={id}${manualCoverage ? `&coverage=${encodeURIComponent(manualCoverage)}` : ""}`
        }
      />
      <p className="text-[12px] text-mute">
        {aiOn
          ? "Which pages? The declarations page is usually the first 1 to 3 pages. A whole renewal package works too: Walkup finds each policy in it. Taking photos? Add every page of the declarations in one go."
          : "Upload your declarations page to keep it on file, then enter the key figures. It takes about 5 minutes."}
      </p>
      <p className="text-[13px]">
        <Link href={mode === "quote" ? manualQuote : manualPolicy} className={linkClass}>
          {mode === "quote" ? "Or enter a quote by hand" : "Or enter a policy by hand"}
        </Link>
      </p>
    </div>
  );
}
