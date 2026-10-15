"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startInsuranceRead } from "../../import-actions";
import { btnGhost, btnPrimary, errorBlock } from "../../components/styles";

/** "Read it as a policy" / "Read it as a quote" (§8.1 legacy shim): starts the read only on a click, never on GET. */
export function ReadButtons({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<"policy" | "quote" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const read = (mode: "policy" | "quote") =>
    start(async () => {
      setWhich(mode);
      setError(null);
      const r = await startInsuranceRead({ documentId, mode });
      if ("error" in r) setError(r.error);
      else router.push(`/insurance/import/${r.readId}`);
    });
  return (
    <div className="space-y-2">
      {error ? <p className={errorBlock}>{error}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className={btnPrimary} disabled={pending} onClick={() => read("policy")}>
          {pending && which === "policy" ? "Starting…" : "Read it as a policy"}
        </button>
        <button type="button" className={btnGhost} disabled={pending} onClick={() => read("quote")}>
          {pending && which === "quote" ? "Starting…" : "Read it as a quote"}
        </button>
      </div>
    </div>
  );
}
