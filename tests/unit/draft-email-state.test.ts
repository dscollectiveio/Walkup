import { describe, expect, it } from "vitest";
import {
  blankSegments,
  blanksMessage,
  draftChanged,
  invalidMessage,
  nextPromptState,
  otherAppLabel,
  otherApps,
  parseMailApp,
  primaryState,
} from "@/components/email/draft-email-state";

describe("primaryState", () => {
  it("opens in the remembered app when it fits and has no blanks", () => {
    expect(primaryState(0, true, "mailto")).toEqual({ label: "Open in your email app", style: "primary", action: "link" });
    expect(primaryState(0, true, "gmail")).toEqual({ label: "Open in Gmail", style: "primary", action: "link" });
    expect(primaryState(0, true, "outlook").label).toBe("Open in Outlook.com");
  });
  it("copies and opens when the draft is long", () => {
    expect(primaryState(0, false, "gmail")).toEqual({ label: "Copy and open", style: "primary", action: "copyAndOpen" });
  });
  it("reads 'Open anyway' in ghost style while blanks remain", () => {
    expect(primaryState(2, true, "mailto")).toEqual({ label: "Open anyway", style: "ghost", action: "link" });
    expect(primaryState(1, false, "mailto")).toEqual({ label: "Open anyway", style: "ghost", action: "copyAndOpen" });
  });
});

describe("mail app helpers", () => {
  it("parses the remembered value with a mailto default", () => {
    expect(parseMailApp("gmail")).toBe("gmail");
    expect(parseMailApp("outlook")).toBe("outlook");
    expect(parseMailApp("yahoo")).toBe("mailto");
    expect(parseMailApp(null)).toBe("mailto");
  });
  it("lists the other two apps", () => {
    expect(otherApps("mailto")).toEqual(["gmail", "outlook"]);
    expect(otherApps("gmail")).toEqual(["mailto", "outlook"]);
  });
  it("labels other apps for copy-and-open when long", () => {
    expect(otherAppLabel("gmail", true)).toBe("Open in Gmail");
    expect(otherAppLabel("gmail", false)).toBe("Copy and open in Gmail");
  });
});

describe("nextPromptState (Did you send it?)", () => {
  const can = { canMark: true, sent: false };
  it("asks after an open and a return to the page", () => {
    const a = nextPromptState("idle", "opened", can);
    expect(a).toBe("awaiting");
    expect(nextPromptState(a, "visible", can)).toBe("asking");
  });
  it("doesn't ask on a return without an open", () => {
    expect(nextPromptState("idle", "visible", can)).toBe("idle");
  });
  it("'Not yet' and marking hide it until the next open", () => {
    expect(nextPromptState("asking", "notYet", can)).toBe("idle");
    expect(nextPromptState("asking", "marked", can)).toBe("idle");
    expect(nextPromptState("asking", "opened", can)).toBe("asking");
  });
  it("never asks when it can't mark or it's already sent", () => {
    expect(nextPromptState("idle", "opened", { canMark: false, sent: false })).toBe("idle");
    expect(nextPromptState("awaiting", "visible", { canMark: true, sent: true })).toBe("idle");
  });
});

describe("copy helpers", () => {
  it("counts blanks", () => {
    expect(blanksMessage([])).toBeNull();
    expect(blanksMessage(["[x]"])).toBe("Fill in 1 blank before sending: [x].");
    expect(blanksMessage(["[preferred dates]", "[best phone number]"])).toBe(
      "Fill in 2 blanks before sending: [preferred dates], [best phone number].",
    );
  });
  it("lists unreadable addresses", () => {
    expect(invalidMessage([])).toBeNull();
    expect(invalidMessage(["bob@acme", "x"])).toBe("Couldn't read: bob@acme, x");
  });
  it("detects edits", () => {
    const a = { to: "a@x.com", cc: "", bcc: "", subject: "S", body: "B" };
    expect(draftChanged(a, { ...a })).toBe(false);
    expect(draftChanged(a, { ...a, body: "B2" })).toBe(true);
    expect(draftChanged(a, { ...a, bcc: "b@x.com" })).toBe(true);
  });
  it("splits text into blank and plain segments", () => {
    expect(blankSegments("Hi [name], see [check: $5].")).toEqual([
      { text: "Hi ", blank: false },
      { text: "[name]", blank: true },
      { text: ", see ", blank: false },
      { text: "[check: $5]", blank: true },
      { text: ".", blank: false },
    ]);
  });
});
