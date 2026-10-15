"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AI_STALE_AFTER_SECONDS } from "@/lib/ai/jobs";
import { todayIso } from "@/lib/dates";
import { friendlyDbError } from "@/lib/insurance/errors";
import { runInsuranceRead } from "@/lib/insurance/read";
import { actionContext, isUuid, revalidateInsurance } from "./action-helpers";

/**
 * Starting and retrying a read of an insurance document (insurance-spec
 * §8.1). The read itself runs in after() (§7.1.7); these return at once and
 * the progress page polls. Only files filed as Insurance are read (decision
 * 7): checked here for the friendly copy, by the guard trigger on insert, and
 * again when the read runs.
 */

const BOARD_ONLY = "Only a board member can import insurance documents.";
const THREE_TRIES = "Walkup has tried three times. Enter the details by hand instead.";
const REUSE_DAYS = 30;
const RETRYABLE = new Set(["failed", "timed_out", "quota", "not_configured"]);

function scheduleRead(readId: string) {
  // The client is created here, in the action, where cookies() is available.
  const bg = createClient();
  after(async () => {
    try {
      await runInsuranceRead(await bg, readId);
    } catch (e) {
      console.error("insurance read crashed", e instanceof Error ? e.name : "unknown");
    }
    revalidateInsurance();
  });
}

export async function startInsuranceRead(input: {
  documentId: string; mode: "policy" | "quote"; quoteRequestId?: string; replacesPolicyId?: string;
}): Promise<{ ok: true; readId: string; reused: boolean } | { error: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  const { supabase, association } = ctx;
  if (!isUuid(input.documentId)) return { error: "That file was not found." };
  const mode = input.mode === "quote" ? "quote" : "policy";
  const quoteRequestId = isUuid(input.quoteRequestId) ? input.quoteRequestId : null;
  const replacesPolicyId = isUuid(input.replacesPolicyId) ? input.replacesPolicyId : null;

  const { data: doc } = await supabase
    .from("documents")
    .select("id, filename, document_categories(slug)")
    .eq("id", input.documentId)
    .maybeSingle();
  if (!doc) return { error: "That file was not found." };
  const cat = (doc as { document_categories: { slug: string } | { slug: string }[] | null }).document_categories;
  const slug = Array.isArray(cat) ? cat[0]?.slug : cat?.slug;
  if (slug !== "insurance") {
    return { error: "Walkup only reads files filed as Insurance. File this one as Insurance in Documents first." };
  }

  // Reuse any read of this file and mode from the last 30 days, in any state,
  // so re-uploading or re-clicking can't get round the cap of 3 attempts.
  const since = new Date(Date.now() - REUSE_DAYS * 86_400_000).toISOString();
  const { data: recent } = await supabase
    .from("insurance_document_reads")
    .select("id, state, quote_request_id, replaces_policy_id")
    .eq("association_id", association.id)
    .eq("document_id", input.documentId)
    .eq("mode", mode)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  const prior = (recent ?? [])[0] as { id: string; state: string; quote_request_id: string | null; replaces_policy_id: string | null } | undefined;
  if (prior) {
    if (prior.state === "done") {
      const patch: Record<string, string> = {};
      if (quoteRequestId && quoteRequestId !== prior.quote_request_id) patch.quote_request_id = quoteRequestId;
      if (replacesPolicyId && replacesPolicyId !== prior.replaces_policy_id) patch.replaces_policy_id = replacesPolicyId;
      if (Object.keys(patch).length) {
        const { error } = await supabase
          .from("insurance_document_reads")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", prior.id);
        if (error) return friendlyDbError(error, "Walkup couldn't update that reading. Try again.");
      }
    }
    // A queued read whose background run never started gets another go (the claim is atomic).
    if (prior.state === "queued") scheduleRead(prior.id);
    revalidateInsurance();
    return { ok: true, readId: prior.id, reused: true };
  }

  const { data: inserted, error } = await supabase
    .from("insurance_document_reads")
    .insert({
      association_id: association.id,
      document_id: input.documentId,
      mode,
      quote_request_id: quoteRequestId,
      replaces_policy_id: replacesPolicyId,
    })
    .select("id")
    .single();
  if (error || !inserted) return friendlyDbError(error ?? { message: "" }, "Walkup couldn't start reading that file. Try again.");
  const readId = (inserted as { id: string }).id;

  scheduleRead(readId);
  revalidateInsurance();
  return { ok: true, readId, reused: false };
}

export async function retryInsuranceRead(readId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  const { supabase } = ctx;
  if (!isUuid(readId)) return { error: "That reading was not found." };

  const { data } = await supabase
    .from("insurance_document_reads")
    .select("id, state, attempts, started_at, created_at, result, saved")
    .eq("id", readId)
    .maybeSingle();
  const read = data as {
    id: string; state: string; attempts: number; started_at: string | null; created_at: string;
    result: { policies?: { detailError?: string | null }[] } | null; saved: Record<string, unknown> | null;
  } | null;
  if (!read) return { error: "That reading was not found." };
  if (read.attempts >= 3) return { error: THREE_TRIES };
  // The progress page shows a run killed mid-way (running, or queued and never
  // started, past AI_STALE_AFTER_SECONDS) as timed out, so it can be retried too.
  const staleIso = new Date(Date.now() - AI_STALE_AFTER_SECONDS * 1000).toISOString();
  const stale =
    (read.state === "running" && !!read.started_at && read.started_at < staleIso) ||
    (read.state === "queued" && read.created_at < staleIso);
  // "Try reading the file again" on a package where some policy's details
  // failed: only while nothing from it has been saved or skipped, so the
  // saved map can't point at a different policy after the re-read.
  const partlyFailed =
    read.state === "done" &&
    (read.result?.policies ?? []).some((p) => p?.detailError) &&
    Object.keys(read.saved ?? {}).length === 0;
  if (!RETRYABLE.has(read.state) && !stale && !partlyFailed) {
    return { error: read.state === "unreadable" ? "Walkup can't read this file. Enter the details by hand." : "This reading is already running or finished." };
  }
  if (read.state === "quota" && read.started_at && todayIso() <= todayIso(new Date(read.started_at))) {
    return { error: "Walkup has read as many documents as it can for your building today. Try again tomorrow, or enter the details by hand." };
  }

  const { data: queued, error } = await supabase
    .from("insurance_document_reads")
    .update({ state: "queued", error: null, updated_at: new Date().toISOString() })
    .eq("id", readId)
    .eq("state", read.state)
    .lt("attempts", 3)
    .select("id");
  if (error) return friendlyDbError(error, "Walkup couldn't start reading again. Try again.");
  if (!queued || queued.length === 0) return { error: "This reading already started again." };

  scheduleRead(readId);
  revalidateInsurance();
  return { ok: true };
}

async function setSkipped(readId: string, index: number, skipped: boolean): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  if (!isUuid(readId) || !Number.isInteger(index) || index < 0) return { error: "Unknown item." };
  const { error } = await ctx.supabase.rpc("set_insurance_read_item_skipped", {
    p_read_id: readId, p_index: index, p_skipped: skipped,
  });
  if (error) return friendlyDbError(error, "Walkup couldn't change that. Try again.");
  revalidateInsurance();
  return { ok: true };
}

export async function skipReadItem(readId: string, index: number): Promise<{ ok: true } | { error: string }> {
  return setSkipped(readId, index, true);
}

export async function unskipReadItem(readId: string, index: number): Promise<{ ok: true } | { error: string }> {
  return setSkipped(readId, index, false);
}
