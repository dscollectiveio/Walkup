import "server-only";
import { AI_MODEL, aiConfigured } from "@/lib/ai/client";
import { aiFailure } from "@/lib/ai/errors";
import { AI_STALE_AFTER_SECONDS } from "@/lib/ai/jobs";
import { claimAiCall, finishAiCall, type AiClaim } from "@/lib/ai/usage";
import { loadRedactionTerms, webResearch } from "@/lib/ai/web-research";
import { todayIso } from "@/lib/dates";
import { LINE_COVERAGE, type LineKey } from "./coverage";
import { runCoverageCheck } from "./coverage-check";
import {
  AgencyItem, ITEM_GUIDANCE, InsurerItem, agencyTask, finalizeMarketItems, insurerTask, marketInputs,
  marketUserLocation, queryKey, verifyAgency, verifyInsurer, type MarketInputs,
} from "./market-verify";
import {
  addressMissingCopy, adminNames, currentAssociation, isBoard, isBoardAdmin, loadCheckInput, unitCount,
  type InsuranceAssociation, type Supabase,
} from "./queries";
import { linesInForce } from "./status";

/**
 * Marketplace research (insurance-spec §7.3.5). A search takes 40 to 200
 * seconds, so it runs like a read: runMarketResearch() does steps 1 to 4
 * (inputs, cache, quota claim, row claim) and returns at once; the action
 * hands the returned job to after(finishMarketResearch), which runs the web
 * research, verifies every item against what the search actually returned
 * (decision 5) and stores the result. The previous results stay visible
 * meanwhile and after a failure.
 *
 * Re-exports the pure helpers so callers can import them from here.
 */

export { marketInputs, marketUserLocation, queryKey } from "./market-verify";

export type MarketKind = "agencies" | "insurers";

export const MARKET_COPY = {
  notConfigured: "Searching the web isn't set up on this Walkup. You can still add agencies yourself.",
  boardOnly: "Only board members can search for insurers or write to agents.",
  recent: "Searched within the last day. Showing those results.",
  running: "A search is already running.",
  noAssociation: "No association is visible to you.",
} as const;

const DAY_MS = 86_400_000;
const CACHE_DAYS = 30;

export interface MarketJob {
  kind: MarketKind;
  associationId: string;
  stateCode: string;
  inputs: MarketInputs;
  key: string;
  claim: AiClaim;
  startedAt: string;
}

export type MarketStart =
  | { ok: true; state: "cached"; notice?: string }
  | { ok: true; state: "running" }
  | { ok: true; state: "started"; job: MarketJob }
  | { error: string; configured?: boolean; quota?: boolean };

interface CacheRow {
  id: string;
  query_key: string | null;
  fetched_at: string | null;
  expires_at: string | null;
  ai_state: string;
  ai_started_at: string | null;
}

/** Coverage types to search for: lines in force, plus lines named by open gap or ask findings (§7.3.1). */
export async function marketCoverages(supabase: Supabase, association: InsuranceAssociation, today = todayIso()): Promise<string[]> {
  const input = await loadCheckInput(supabase, association, today);
  const inForce = input.policies.filter((p) => p.status === "active");
  const lines = new Set<LineKey>();
  const covered = linesInForce(inForce);
  for (const [line, cover] of Object.entries(covered) as [LineKey, unknown][]) if (cover) lines.add(line);
  for (const f of runCoverageCheck(input).findings) {
    if (!f.dismissed && f.line && (f.severity === "gap" || f.severity === "ask")) lines.add(f.line);
  }
  const coverages = new Set<string>(inForce.map((p) => p.coverage));
  for (const l of lines) coverages.add(LINE_COVERAGE[l]);
  return [...coverages];
}

/** Steps 1 to 4. Nothing is searched here. */
export async function runMarketResearch(supabase: Supabase, kind: MarketKind, opts: { force?: boolean } = {}): Promise<MarketStart> {
  const association = await currentAssociation(supabase);
  if (!association) return { error: MARKET_COPY.noAssociation };
  const associationId = association.id;
  if (!(await isBoard(supabase, associationId))) return { error: MARKET_COPY.boardOnly };
  if (!aiConfigured()) return { error: MARKET_COPY.notConfigured, configured: false };

  const [units, coverages] = await Promise.all([unitCount(supabase, associationId), marketCoverages(supabase, association)]);
  const inputs = marketInputs(association, units, coverages);
  if (!inputs) {
    const [admin, names] = await Promise.all([isBoardAdmin(supabase, associationId), adminNames(supabase, associationId)]);
    return { error: addressMissingCopy(admin, names) };
  }
  const key = queryKey(kind, inputs);

  // 2-3. The cache.
  const { data: existing } = await supabase
    .from("insurance_market_research")
    .select("id, query_key, fetched_at, expires_at, ai_state, ai_started_at")
    .eq("association_id", associationId)
    .eq("kind", kind)
    .maybeSingle();
  const row = (existing ?? null) as CacheRow | null;
  const now = Date.now();
  if (row && row.query_key === key && row.fetched_at && row.expires_at) {
    if (!opts.force && new Date(row.expires_at).getTime() > now) return { ok: true, state: "cached" };
    if (opts.force && now - new Date(row.fetched_at).getTime() < DAY_MS) {
      return { ok: true, state: "cached", notice: MARKET_COPY.recent };
    }
  }
  const staleIso = new Date(now - AI_STALE_AFTER_SECONDS * 1000).toISOString();
  if (row && row.ai_state === "running" && row.ai_started_at && row.ai_started_at >= staleIso) {
    return { ok: true, state: "running" };
  }

  // Quota first (Foundation 5.3): a building at its limit hears so at once.
  const claimed = await claimAiCall(supabase, associationId, "insurance_market");
  if (!claimed.ok) return { error: claimed.reason, configured: claimed.configured, ...(claimed.quota ? { quota: true } : {}) };

  // 4. Claim the row (insert it the first time).
  const startedAt = new Date().toISOString();
  const running = { ai_state: "running", ai_started_at: startedAt, ai_finished_at: null, ai_error: null, pending_inputs: inputs, pending_key: key };
  let got = false;
  if (!row) {
    const { error } = await supabase.from("insurance_market_research").insert({ association_id: associationId, kind, ...running });
    got = !error;
    if (error && error.code !== "23505") console.error("market research insert failed", error.code);
  }
  if (!got) {
    const { data } = await supabase
      .from("insurance_market_research")
      .update(running)
      .eq("association_id", associationId)
      .eq("kind", kind)
      .or(`ai_state.neq.running,ai_started_at.lt.${staleIso}`)
      .select("id");
    got = Array.isArray(data) && data.length > 0;
  }
  if (!got) {
    await finishAiCall(supabase, claimed.claim, { model: AI_MODEL, input_tokens: 0, output_tokens: 0, ok: false, error_code: "not_started" });
    return { ok: true, state: "running" };
  }

  return {
    ok: true,
    state: "started",
    job: { kind, associationId, stateCode: inputs.state, inputs, key, claim: claimed.claim, startedAt },
  };
}

/** Steps 5 to 7, in after(). Never throws. */
export async function finishMarketResearch(supabase: Supabase, job: MarketJob): Promise<void> {
  const fail = async (code: string) => {
    const { error } = await supabase
      .from("insurance_market_research")
      .update({ ai_state: "failed", ai_finished_at: new Date().toISOString(), ai_error: code.slice(0, 500), pending_inputs: null, pending_key: null })
      .eq("association_id", job.associationId)
      .eq("kind", job.kind)
      .eq("ai_started_at", job.startedAt);
    if (error) console.error("market research fail write failed", error.code);
  };

  try {
    const redact = await loadRedactionTerms(supabase, job.associationId);
    const where = { state: job.inputs.state, stateName: job.inputs.stateName };
    const common = {
      kind: "insurance_market" as const,
      supabase,
      associationId: job.associationId,
      redact,
      itemGuidance: ITEM_GUIDANCE,
      claim: job.claim,
      maxSearches: 5,
      userLocation: marketUserLocation(job.inputs),
      timeoutMs: 240_000,
    };
    const r = job.kind === "agencies"
      ? await webResearch({ ...common, task: agencyTask(job.inputs), itemSchema: AgencyItem, nameOf: (i) => i.name, verify: (i, ctx) => verifyAgency(i, ctx) })
      : await webResearch({ ...common, task: insurerTask(job.inputs), itemSchema: InsurerItem, nameOf: (i) => i.name, verify: (i, ctx) => verifyInsurer(i, ctx, where) });
    if (!r.ok) {
      await fail(r.code === "quota_unknown" ? "quota" : r.code);
      return;
    }

    const items = finalizeMarketItems(
      r.result.items as (typeof r.result.items[number] & { key: string; name: string; state?: string | null })[],
      job.kind === "agencies" ? job.stateCode : null,
    );
    const fetchedAt = new Date().toISOString();
    const { error } = await supabase
      .from("insurance_market_research")
      .update({
        query_key: job.key,
        inputs: job.inputs,
        items,
        sources: r.result.sources,
        fetched_at: fetchedAt,
        expires_at: new Date(Date.now() + CACHE_DAYS * DAY_MS).toISOString(),
        ai_state: "done",
        ai_finished_at: fetchedAt,
        ai_error: null,
        pending_inputs: null,
        pending_key: null,
      })
      .eq("association_id", job.associationId)
      .eq("kind", job.kind)
      .eq("ai_started_at", job.startedAt);
    if (error) console.error("market research write failed", error.code);
  } catch (e) {
    console.error("market research failed", e instanceof Error ? e.name : "unknown");
    await fail(aiFailure("unknown").code);
  }
}
