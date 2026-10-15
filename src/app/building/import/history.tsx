"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KIND_LABEL, type ImportKind } from "@/lib/import/kinds";
import { undoImport } from "./actions";
import { BTN_SECONDARY, ErrorNote, Pill, longDate } from "./ui";

export interface HistoryRow {
  id: string;
  kind: ImportKind;
  filename: string;
  status: "uploaded" | "validated" | "committed" | "undone" | "cancelled";
  rowCount: number;
  created: number | null;
  who: string;
  when: string;
}

const STATUS_WORDS: Record<HistoryRow["status"], { label: string; tone: "good" | "neutral" | "warning" }> = {
  committed: { label: "Imported", tone: "good" },
  undone: { label: "Undone", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  uploaded: { label: "Not finished", tone: "warning" },
  validated: { label: "Not finished", tone: "warning" },
};

export function History({ rows, canUndo }: { rows: HistoryRow[]; canUndo: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [pending, start] = useTransition();

  if (rows.length === 0) return <p className="py-6 text-center text-[13px] text-mute">Nothing imported yet.</p>;

  const undo = (id: string) =>
    start(async () => {
      const r = await undoImport(id);
      if ("error" in r) {
        setError({ id, message: r.error });
        return;
      }
      setError(null);
      setConfirming(null);
      router.refresh();
    });

  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id} className="py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">
                {KIND_LABEL[r.kind]} <Pill tone={STATUS_WORDS[r.status].tone}>{STATUS_WORDS[r.status].label}</Pill>
              </p>
              <p className="mt-0.5 break-words text-[12px] text-mute">
                {r.filename} · {r.rowCount.toLocaleString("en-US")} rows · {r.who} · {longDate(r.when)}
                {r.status === "committed" && r.created !== null ? ` · ${r.created.toLocaleString("en-US")} created` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {r.status === "committed" || r.status === "undone" ? (
                <Link href={`/building/import/${r.id}?step=done`} className={`${BTN_SECONDARY} !min-h-[36px] !px-3`}>
                  See it
                </Link>
              ) : null}
              {r.status === "committed" && canUndo && confirming !== r.id ? (
                <button type="button" onClick={() => setConfirming(r.id)} className={`${BTN_SECONDARY} !min-h-[36px] !px-3`}>
                  Undo
                </button>
              ) : null}
            </div>
          </div>
          {confirming === r.id ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink">
              <span>This reverses the entries. Both stay in the ledger history. Undo?</span>
              <button type="button" disabled={pending} onClick={() => undo(r.id)} className={`${BTN_SECONDARY} !min-h-[36px] !px-3`}>
                {pending ? "Undoing..." : "Yes, undo"}
              </button>
              <button type="button" disabled={pending} onClick={() => setConfirming(null)} className={`${BTN_SECONDARY} !min-h-[36px] !px-3`}>
                Keep it
              </button>
            </div>
          ) : null}
          {error?.id === r.id ? (
            <div className="mt-2">
              <ErrorNote>{error.message}</ErrorNote>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
