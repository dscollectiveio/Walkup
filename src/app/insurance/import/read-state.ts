// How a read row looks to the board (insurance-spec §9.3): its state once a
// killed run is accounted for, what has been saved or skipped, and the chip
// in the "Reading now and recently" list. Pure.

import { AI_STALE_AFTER_SECONDS } from "@/lib/ai/jobs";
import type { StoredRead } from "@/lib/insurance/read-schema";
import type { ChipTone } from "../components/status-chip";

export type ReadState = "queued" | "running" | "done" | "failed" | "unreadable" | "not_configured" | "quota" | "timed_out";

export interface ReadRow {
  id: string;
  document_id: string;
  mode: "policy" | "quote";
  state: ReadState;
  method: string | null;
  attempts: number;
  result: StoredRead | null;
  saved: Record<string, { policy_id?: string; quote_id?: string; skipped?: boolean }> | null;
  error: string | null;
  started_at: string | null;
  created_at: string;
  quote_request_id: string | null;
  replaces_policy_id: string | null;
  documents: { filename: string } | { filename: string }[] | null;
}

export const READ_SELECT =
  "id, document_id, mode, state, method, attempts, result, saved, error, started_at, created_at, quote_request_id, replaces_policy_id, documents(filename)";

export function readFilename(r: Pick<ReadRow, "documents">): string {
  const d = Array.isArray(r.documents) ? r.documents[0] : r.documents;
  return d?.filename ?? "this file";
}

/**
 * The state to show. A run still "running" past AI_STALE_AFTER_SECONDS was
 * killed (maxDuration is 300 s), and a read "queued" that long never started:
 * both show as timed out, and retryInsuranceRead accepts them.
 */
export function effectiveState(r: Pick<ReadRow, "state" | "started_at" | "created_at">, nowMs = Date.now()): ReadState {
  const staleMs = AI_STALE_AFTER_SECONDS * 1000;
  if (r.state === "running" && r.started_at && nowMs - Date.parse(r.started_at) > staleMs) return "timed_out";
  if (r.state === "queued" && nowMs - Date.parse(r.created_at) > staleMs) return "timed_out";
  return r.state;
}

export type ItemState = { kind: "open" } | { kind: "saved"; policyId?: string; quoteId?: string } | { kind: "skipped" };

export function itemState(r: Pick<ReadRow, "saved">, index: number): ItemState {
  const e = r.saved?.[String(index)];
  if (e?.policy_id) return { kind: "saved", policyId: e.policy_id };
  if (e?.quote_id) return { kind: "saved", quoteId: e.quote_id };
  if (e?.skipped) return { kind: "skipped" };
  return { kind: "open" };
}

export function itemCounts(r: Pick<ReadRow, "saved" | "result">): { total: number; open: number; saved: number; skipped: number } {
  const total = r.result?.policies?.length ?? 0;
  let open = 0;
  let saved = 0;
  let skipped = 0;
  for (let i = 0; i < total; i++) {
    const s = itemState(r, i);
    if (s.kind === "open") open++;
    else if (s.kind === "saved") saved++;
    else skipped++;
  }
  return { total, open, saved, skipped };
}

/** The list chip (§9.3.1): Reading… / Ready to review / Couldn't read / Saved / Partly saved. */
export function readChip(r: ReadRow, nowMs = Date.now()): { tone: ChipTone; text: string } {
  const state = effectiveState(r, nowMs);
  if (state === "queued" || state === "running") return { tone: "info", text: "Reading…" };
  if (state !== "done") return { tone: "bad", text: "Couldn't read" };
  const c = itemCounts(r);
  if (c.total === 0) return { tone: "neutral", text: "Nothing found" };
  if (c.open > 0 && c.saved > 0) return { tone: "warning", text: "Partly saved" };
  if (c.open > 0) return { tone: "warning", text: "Ready to review" };
  if (c.saved > 0) return c.skipped > 0 ? { tone: "good", text: "Partly saved" } : { tone: "good", text: "Saved" };
  return { tone: "neutral", text: "Skipped" };
}

/** Whether the read can be tried again, by its state and attempts (§8.1). */
export function canRetry(r: Pick<ReadRow, "attempts">, state: ReadState): boolean {
  return r.attempts < 3 && (state === "failed" || state === "timed_out" || state === "quota" || state === "not_configured");
}
