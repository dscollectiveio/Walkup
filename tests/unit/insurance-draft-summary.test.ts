import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const runStructured = vi.fn();
vi.mock("@/lib/ai/structured", () => ({ runStructured: (...args: unknown[]) => runStructured(...args) }));

import { aiFailure } from "@/lib/ai/errors";
import { DRAFT_NOTICE, draftEmail } from "@/lib/insurance/draft";
import { DRAFT_SYSTEM, draftFacts } from "@/lib/insurance/emails";
import { SUMMARY_COPY, writePolicySummary } from "@/lib/insurance/summary";
import { SUMMARY_SYSTEM } from "@/lib/insurance/summary-check";

const ok = <T,>(data: T) => ({ ok: true, data, meta: { model: "claude-opus-5-5", fellBack: false, durationMs: 1 } });

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  runStructured.mockReset();
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

const longBody = (middle: string) =>
  `Hello {{agent_name}},\n\nWe're the board of a small condominium, {{building_description}}, and we'd like a quote for the coverage below. Could you tell us how much notice you need before our renewal?\n\n${middle}\n\nIf you need anything else to quote, please let us know.\n\nThank you,\n{{sender_name}}\n{{sender_contact}}`;

const values = {
  agent_name: "Pat",
  association_name: "2158 N. Damen Condominium Association",
  building_description: "a 3-unit condominium in Chicago",
  details_block: "THE ASSOCIATION\nUnits: 3",
  sender_name: "Doug Smart",
  sender_contact: "doug@example.com",
};
const facts = draftFacts("quote_request", { contactKind: "agency", isCurrentAgent: false, coverages: ["property"], renewalKnown: false, findingLines: [] });
const base = { supabase: {} as never, associationId: "assoc-1", kind: "quote_request" as const, facts, values };

describe("draftEmail (insurance)", () => {
  it("the model sees only the kind, the placeholders and the facts, never the values", async () => {
    runStructured.mockResolvedValue(ok({ subject: "Quote request for our building", body: longBody("{{details_block}}") }));
    const r = await draftEmail(base);
    const call = runStructured.mock.calls[0][0];
    expect(call).toMatchObject({ kind: "insurance_draft", system: DRAFT_SYSTEM, effort: "low", maxTokens: 1500, timeoutMs: 45_000 });
    expect(call.content).toContain('"kind":"quote_request"');
    expect(call.content).toContain("{{details_block}}");
    for (const v of Object.values(values)) expect(call.content).not.toContain(v);
    expect(r.draftedBy).toBe("model");
    expect(r.body).toContain("Hello Pat,");
    expect(r.body).toContain("THE ASSOCIATION");
    expect(r.body).not.toContain("{{");
  });

  it("a draft that fails the guard (a digit) falls back to the template", async () => {
    runStructured.mockResolvedValue(ok({ subject: "Quote request", body: longBody("{{details_block}} We have 3 units.") }));
    const r = await draftEmail(base);
    expect(r).toMatchObject({ draftedBy: "template", notice: DRAFT_NOTICE.template });
    expect(r.subject).toBe("Insurance quote request: 2158 N. Damen Condominium Association");
  });

  it("quota gives the quota notice; not configured never calls the model", async () => {
    runStructured.mockResolvedValue(aiFailure("quota", "insurance_draft", 40));
    expect((await draftEmail(base)).notice).toBe(DRAFT_NOTICE.quota);
    delete process.env.ANTHROPIC_API_KEY;
    runStructured.mockClear();
    const r = await draftEmail(base);
    expect(runStructured).not.toHaveBeenCalled();
    expect(r).toMatchObject({ draftedBy: "template", notice: DRAFT_NOTICE.template });
    expect(r.body).toContain("Hello Pat,");
  });

  it("a placeholder value can itself be a placeholder, filled later per contact", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await draftEmail({ ...base, values: { ...values, agent_name: "{{agent_name}}" } });
    expect(r.body.startsWith("Hello {{agent_name}},")).toBe(true);
  });

  it("the prompts keep their rules", () => {
    expect(DRAFT_SYSTEM).toContain("Never accept, bind, purchase or cancel coverage");
    expect(DRAFT_SYSTEM).not.toContain("—");
    expect(SUMMARY_SYSTEM).toContain("Never use the words should, recommend, best, cheaper or advice.");
  });
});

/** A fake client for one policy row; records updates and their filters. */
function summarySupabase(row: Record<string, unknown> | null) {
  const updates: { patch: Record<string, unknown>; or: string | null }[] = [];
  const supabase = {
    from: () => {
      let patch: Record<string, unknown> | null = null;
      let or: string | null = null;
      const b = {
        select: () => b,
        eq: () => b,
        or: (f: string) => {
          or = f;
          return b;
        },
        update: (p: Record<string, unknown>) => {
          patch = p;
          return b;
        },
        maybeSingle: async () => ({ data: row, error: null }),
        then: (resolve: (v: unknown) => unknown) => {
          if (patch) updates.push({ patch, or });
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return b;
    },
  };
  return { supabase: supabase as never, updates };
}

const policy = {
  id: "pol-1", association_id: "assoc-1", coverage: "property", carrier_name: "West Bend Mutual",
  effective_from: "2026-03-01", effective_to: "2027-03-01", annual_premium: "3766.00", payment_schedule: "annual",
  building_limit: "2400000.00", property_deductible: "5000.00", archived_at: null, replaced_at: null,
  replaced_by_policy_id: null, renewal_reminder_days: 60, included_sections: ["property", "property_deductibles"],
  summary_source: null, policy_number: "CPP 1234567", named_insured: "2158 N. Damen Condominium Association",
};

describe("writePolicySummary", () => {
  it("stores a checked summary from the policy's own lines, never names or numbers that identify it", async () => {
    runStructured.mockResolvedValue(ok({ summary: "This is a master policy with West Bend Mutual. The building is insured for $2,400,000, with a $5,000 deductible." }));
    const { supabase, updates } = summarySupabase(policy);
    const r = await writePolicySummary(supabase, "pol-1");
    expect(r.ok).toBe(true);
    const call = runStructured.mock.calls[0][0];
    expect(call).toMatchObject({ kind: "insurance_summary", system: SUMMARY_SYSTEM, effort: "low", maxTokens: 2000, timeoutMs: 60_000 });
    expect(call.content).toContain("Building: $2,400,000");
    expect(call.content).not.toContain("CPP 1234567");
    expect(call.content).not.toContain("Damen");
    expect(updates[0].patch).toMatchObject({ summary_source: "model", summary_error: null });
    expect(updates[0].or).toBe("summary_source.is.null,summary_source.neq.board");
  });

  it("retries once with the reasons, then stores nothing and records check_failed", async () => {
    runStructured.mockResolvedValue(ok({ summary: "The building is insured for $1 million. You should raise it." }));
    const { supabase, updates } = summarySupabase(policy);
    const r = await writePolicySummary(supabase, "pol-1");
    expect(r).toMatchObject({ ok: false, code: "check_failed", reason: SUMMARY_COPY.failed });
    expect(runStructured).toHaveBeenCalledTimes(2);
    expect(runStructured.mock.calls[1][0].content).toContain("Your previous summary was rejected because: ");
    expect(updates).toEqual([{ patch: { summary_error: "check_failed" }, or: "summary_source.is.null,summary_source.neq.board" }]);
  });

  it("never overwrites a board-written summary unless forced", async () => {
    const { supabase, updates } = summarySupabase({ ...policy, summary_source: "board" });
    expect((await writePolicySummary(supabase, "pol-1")).ok).toBe(false);
    expect(runStructured).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    runStructured.mockResolvedValue(ok({ summary: "This is a master policy with West Bend Mutual." }));
    const forced = summarySupabase({ ...policy, summary_source: "board" });
    expect((await writePolicySummary(forced.supabase, "pol-1", { force: true })).ok).toBe(true);
    expect(forced.updates[0].or).toBeNull();
  });

  it("quota and not configured set summary_error and leave the text alone", async () => {
    runStructured.mockResolvedValue(aiFailure("quota", "insurance_summary", 20));
    const q = summarySupabase(policy);
    expect(await writePolicySummary(q.supabase, "pol-1")).toMatchObject({ ok: false, code: "quota", quota: true });
    expect(q.updates[0].patch).toEqual({ summary_error: "quota" });
    delete process.env.ANTHROPIC_API_KEY;
    const n = summarySupabase(policy);
    expect(await writePolicySummary(n.supabase, "pol-1")).toMatchObject({ ok: false, code: "not_configured", configured: false });
    expect(n.updates[0].patch).toEqual({ summary_error: "not_configured" });
  });
});
