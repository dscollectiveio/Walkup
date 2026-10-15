"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DirectUpload } from "@/components/upload/direct-upload";
import { KIND_LABEL, templateUrl, type ImportKind } from "@/lib/import/kinds";
import { markImportUpload } from "../actions";
import { ErrorNote, HELP } from "../ui";

export function UploadStep({ kind }: { kind: ImportKind }) {
  const router = useRouter();
  const [keepCopy, setKeepCopy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-paper p-5">
        <DirectUpload
          purpose="document"
          categorySlug="other"
          read={false}
          multiple={false}
          maxFiles={1}
          accept=".csv,.xlsx"
          label="Choose a file"
          help="Excel (.xlsx) or CSV, up to 5 MB and 5,000 rows. Only the columns you match in the next step are kept."
          onUploaded={(docs) => {
            const first = docs.find((d) => d.documentId);
            if (!first?.documentId) return;
            const documentId = first.documentId;
            void (async () => {
              const r = await markImportUpload(documentId);
              if ("error" in r) {
                setError(r.error);
                return;
              }
              router.push(`/building/import/new?kind=${kind}&doc=${documentId}${keepCopy ? "&keep=1" : ""}`);
            })();
          }}
        />
        {error ? (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-line bg-paper p-5">
        <label className="flex items-start gap-3 text-[13px] text-ink">
          <input
            type="checkbox"
            checked={keepCopy}
            onChange={(e) => setKeepCopy(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-ink,#1f2a44)]"
          />
          <span>
            Keep a copy of this file in the Document Hub (board only)
            <span className={`${HELP} block`}>The copy would include columns Walkup doesn&rsquo;t import.</span>
          </span>
        </label>
      </div>

      <p className="text-[13px] text-mute">
        Not sure how it should look?{" "}
        <a href={templateUrl(kind, "xlsx")} className="font-medium text-ink underline underline-offset-2" download>
          Download the {KIND_LABEL[kind].toLowerCase()} template
        </a>{" "}
        (or{" "}
        <a href={templateUrl(kind, "csv")} className="font-medium text-ink underline underline-offset-2" download>
          as a CSV
        </a>
        ).{" "}
        <Link href="/building/import" className="font-medium text-ink underline underline-offset-2">
          Back to Import
        </Link>
      </p>
    </div>
  );
}
