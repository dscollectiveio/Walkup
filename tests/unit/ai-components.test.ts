import { describe, expect, it } from "vitest";
import { statusNoteStyle } from "@/components/ai/ai-status-note";
import { aiWrittenText } from "@/components/ai/ai-written";
import { foundOnWebLines } from "@/components/ai/found-on-web";

describe("AiStatusNote style table (10.1)", () => {
  it("leading words, tones and retry per code", () => {
    expect(statusNoteStyle("not_configured")).toEqual({ tone: "neutral", lead: "By hand:", retry: false });
    expect(statusNoteStyle("quota")).toEqual({ tone: "warning", lead: "Limit reached:", retry: false });
    for (const c of ["refused", "bad_request", "too_long", "unsupported_file"] as const) {
      expect(statusNoteStyle(c)).toEqual({ tone: "warning", lead: "Couldn't do this:", retry: false });
    }
    for (const c of ["timeout", "busy", "unreachable", "bad_output", "incomplete", "unknown", "quota_unknown"] as const) {
      expect(statusNoteStyle(c)).toEqual({ tone: "warning", lead: "Couldn't finish:", retry: true });
    }
    expect(statusNoteStyle("rejected_key")).toEqual({ tone: "neutral", lead: "Unavailable:", retry: false });
  });
});

describe("AiWritten text (10.5)", () => {
  it("has one line per variant with defaults", () => {
    expect(aiWrittenText("draft")).toBe("Written by AI. Read and edit it before you send it.");
    expect(aiWrittenText("summary")).toBe("Written by AI from your documents. Check it against the original.");
    expect(aiWrittenText("summary", "your policy's details", "the policy")).toBe(
      "Written by AI from your policy's details. Check it against the policy.",
    );
    expect(aiWrittenText("triage")).toBe("Suggested by AI from the description. The board decides.");
    expect(aiWrittenText("reading")).toBe("Read by AI from your document. Check each value before you save it.");
  });
});

describe("FoundOnWeb lines (10.4)", () => {
  const fetchedAt = "2026-10-01T15:00:00Z";
  const now = Date.parse("2026-10-05T15:00:00Z");
  it("states when, how many sources, and that nothing is endorsed", () => {
    const l = foundOnWebLines({ sourceCount: 1, fetchedAt, scope: "item", now });
    expect(l.header).toBe("Found on the web, October 1, 2026 · 1 source");
    expect(l.disclaimer).toBe("Walkup didn't check this business and doesn't endorse it. Confirm details with them.");
    expect(l.stale).toBe(false);
    expect(l.partial).toBeNull();
    expect(l.ratings).toBeNull();
    const list = foundOnWebLines({ sourceCount: 3, fetchedAt, scope: "list", partial: true, ratingsFromWebOnly: true, now });
    expect(list.header).toContain("3 sources");
    expect(list.disclaimer).toContain("doesn't endorse any of them");
    expect(list.partial).toBe("Showing what Walkup could check before the search ran out of time. Search again for more.");
    expect(list.ratings).toBe("Ratings shown only where a source page states them.");
  });
  it("suggests searching again after 7 days", () => {
    expect(foundOnWebLines({ sourceCount: 1, fetchedAt, scope: "item", now: Date.parse("2026-10-09T15:00:01Z") }).stale).toBe(true);
  });
});
