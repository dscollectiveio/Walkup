import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AiNotConfiguredError } from "@/lib/ai/client";
import { aiFailure, classifyAiError, COUNTED_FAILURES, describeParseError, type AiErrorCode } from "@/lib/ai/errors";

const ALL: AiErrorCode[] = [
  "not_configured", "quota", "quota_unknown", "refused", "timeout", "busy", "unreachable", "rejected_key",
  "bad_request", "too_long", "bad_output", "incomplete", "unsupported_file", "unknown",
];

describe("aiFailure copy", () => {
  it("has plain-English text for every code, without em dashes", () => {
    for (const code of ALL) {
      const f = aiFailure(code, "contractor_search");
      expect(f.ok).toBe(false);
      expect(f.code).toBe(code);
      expect(f.reason.length).toBeGreaterThan(10);
      expect(f.reason).not.toMatch(/[—–]/);
      expect(f.counted).toBe(COUNTED_FAILURES.has(code));
      expect(f.configured).toBe(code !== "not_configured");
      expect(f.quota === true).toBe(code === "quota");
    }
  });
  it("fixed sentences", () => {
    expect(aiFailure("not_configured").reason).toBe("AI help isn't available on this Walkup account, so this part is by hand.");
    expect(aiFailure("busy").reason).toBe("The AI service is busy right now. Try again in a few minutes.");
    expect(aiFailure("incomplete").reason).toBe("The search stopped before it finished. Try again.");
  });
  it("quota names the label and limit per scope", () => {
    expect(aiFailure("quota", "insurance_market", { scope: "building", limit: 6 }).reason).toBe(
      "Your building has used today's insurer and agency searches (6 a day). It resets at midnight.",
    );
    expect(aiFailure("quota", "contractor_search", { scope: "attempts", limit: 24 }).reason).toBe(
      "Walkup tried contractor searches too many times today after errors, so it's paused until midnight.",
    );
    expect(aiFailure("quota", "ticket_triage", { scope: "person", limit: 10 }).reason).toBe(
      "You've reached today's limit for problem triage. It resets at midnight.",
    );
    // A bare number is the building limit; no number falls back to the kind's limit.
    expect(aiFailure("quota", "contractor_search", 12).reason).toContain("(12 a day)");
    expect(aiFailure("quota", "coi_read").reason).toContain("reading insurance certificates (25 a day)");
  });
  it("bad_request and too_long depend on the kind", () => {
    expect(aiFailure("bad_request", "insurance_read").reason).toContain("couldn't read this file");
    expect(aiFailure("bad_request", "contractor_search").reason).toContain("web search couldn't run");
    expect(aiFailure("bad_request", "insurance_draft").reason).toContain("Use the template instead");
    expect(aiFailure("bad_request", "ticket_triage").reason).toBe("The AI couldn't finish this. You can do this part by hand.");
    expect(aiFailure("too_long", "bid_read").reason).toContain("too long for the AI to read in one go");
    expect(aiFailure("too_long", "insurance_market").reason).toContain("narrower description");
    expect(aiFailure("too_long", "contractor_draft").reason).toContain("The draft came out too long");
    expect(aiFailure("too_long").reason).toBe("This was too long for the AI to finish. You can do this part by hand.");
  });
  it("counted mirrors ai_usage_counts", () => {
    expect([...COUNTED_FAILURES].sort()).toEqual(["bad_request", "refused", "too_long"]);
  });
});

describe("classifyAiError", () => {
  const headers = new Headers();
  // The API's error body, as the SDK receives it.
  const body = (type: string, message: string) => ({ type: "error", error: { type, message } });
  it("maps SDK errors to codes", () => {
    expect(classifyAiError(new Anthropic.RateLimitError(429, {}, "slow down", headers)).code).toBe("busy");
    expect(classifyAiError(new Anthropic.InternalServerError(529, {}, "overloaded", headers)).code).toBe("busy");
    expect(
      classifyAiError(new Anthropic.InternalServerError(500, { error: { type: "overloaded_error" } }, "x", headers, "overloaded_error")).code,
    ).toBe("busy");
    expect(classifyAiError(new Anthropic.InternalServerError(500, {}, "boom", headers)).code).toBe("unreachable");
    expect(classifyAiError(new Anthropic.APIConnectionError({ message: "down" })).code).toBe("unreachable");
    expect(classifyAiError(new Anthropic.APIConnectionTimeoutError()).code).toBe("timeout");
    expect(classifyAiError(new Anthropic.APIUserAbortError()).code).toBe("timeout");
    expect(classifyAiError(new Anthropic.APIError(413, {}, "too big", headers)).code).toBe("too_long");
    expect(classifyAiError(new Anthropic.BadRequestError(400, body("invalid_request_error", "prompt is too long: 300000 tokens > 200000 maximum"), undefined, headers, "invalid_request_error")).code).toBe("too_long");
    expect(classifyAiError(new Anthropic.BadRequestError(400, {}, "invalid param", headers)).code).toBe("bad_request");
    expect(classifyAiError(new Anthropic.AnthropicError("parse failed")).code).toBe("bad_output");
    expect(classifyAiError(new AiNotConfiguredError()).code).toBe("not_configured");
    expect(classifyAiError(new Error("???")).code).toBe("unknown");
  });
  it("an aborted deadline signal wins", () => {
    const c = new AbortController();
    c.abort();
    expect(classifyAiError(new Anthropic.APIConnectionError({ message: "x" }), c.signal).code).toBe("timeout");
  });
  it("alerts the operator on a rejected key", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(classifyAiError(new Anthropic.AuthenticationError(401, {}, "bad key", headers)).code).toBe("rejected_key");
    expect(classifyAiError(new Anthropic.PermissionDeniedError(403, {}, "nope", headers)).code).toBe("rejected_key");
    expect(spy).toHaveBeenCalledWith("[walkup-ai] rejected_key", 401);
    spy.mockRestore();
  });
  it("detail carries status and type, redacted and capped", () => {
    const { detail } = classifyAiError(
      new Anthropic.BadRequestError(400, undefined, `bad 123-45-6789 ${"x".repeat(600)}`, headers, "invalid_request_error"),
    );
    expect(detail.startsWith("400 invalid_request_error 400 bad [redacted]")).toBe(true);
    expect(detail.length).toBeLessThanOrEqual(500);
  });
});

describe("describeParseError", () => {
  it("gives only the name for a JSON error that quotes model output", () => {
    let err: unknown;
    try {
      JSON.parse('{"ssn": 123-45-6789');
    } catch (e) {
      err = e;
    }
    expect(describeParseError(err)).toBe("SyntaxError");
  });
  it("gives paths and codes only for a zod error", () => {
    const schema = z.object({ fields: z.array(z.object({ value: z.string() })) });
    const r = schema.safeParse({ fields: [{ value: 123456789 }] });
    expect(r.success).toBe(false);
    const out = describeParseError(r.error);
    expect(out).toBe("ZodError fields.0.value:invalid_type");
    expect(out).not.toContain("123456789");
  });
});
