"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ImportKind } from "@/lib/import/kinds";
import { removeUnfinishedUpload } from "../actions";
import { BTN_PRIMARY, ErrorNote } from "../ui";

/** The file could not be read: take it away and start the upload again. */
export function RemoveAndRetry({ documentId, kind }: { documentId: string; kind: ImportKind }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={pending}
        className={BTN_PRIMARY}
        onClick={() =>
          start(async () => {
            const r = await removeUnfinishedUpload(documentId);
            if ("error" in r) {
              // A file that was already in Documents is not ours to remove.
              setError(r.error);
              return;
            }
            router.push(`/building/import/new?kind=${kind}`);
          })
        }
      >
        {pending ? "Removing..." : "Remove this file and upload another"}
      </button>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </div>
  );
}
