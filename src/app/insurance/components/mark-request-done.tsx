"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeOwnerRequest } from "../owner-request-actions";
import { btnGhost } from "./styles";

/** "Mark done" on the owner-requests banner (§9.1 item 0). */
export function MarkRequestDone({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={btnGhost}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await closeOwnerRequest(requestId, "done");
            if ("error" in r) setError(r.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Saving…" : "Mark done"}
      </button>
      {error ? <p className="w-full text-[12px] text-bad-text">{error}</p> : null}
    </>
  );
}
