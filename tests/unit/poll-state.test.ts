import { describe, expect, it } from "vitest";
import { elapsedSeconds, formatElapsed, pollPhase, STALE_AFTER_SECONDS } from "@/components/ai/poll-state";

const start = "2026-10-14T12:00:00.000Z";
const at = (seconds: number) => new Date(start).getTime() + seconds * 1000;

describe("pollPhase", () => {
  it("is idle when the server no longer says running", () => {
    expect(pollPhase(false, start, at(10), false)).toBe("idle");
    expect(pollPhase(false, start, at(1000), true)).toBe("idle");
  });
  it("polls until the deadline", () => {
    expect(pollPhase(true, start, at(0), false)).toBe("polling");
    expect(pollPhase(true, start, at(STALE_AFTER_SECONDS - 1), false)).toBe("polling");
  });
  it("refreshes once at the deadline, then stalls", () => {
    expect(pollPhase(true, start, at(STALE_AFTER_SECONDS), false)).toBe("finalRefresh");
    expect(pollPhase(true, start, at(STALE_AFTER_SECONDS + 6), true)).toBe("stalled");
  });
  it("can't spin forever without a start time", () => {
    expect(pollPhase(true, null, at(0), false)).toBe("finalRefresh");
    expect(pollPhase(true, null, at(0), true)).toBe("stalled");
  });
  it("honours a custom stale window", () => {
    expect(pollPhase(true, start, at(61), false, 60)).toBe("finalRefresh");
  });
});

describe("elapsed", () => {
  it("counts whole seconds, never negative", () => {
    expect(elapsedSeconds(start, at(65.9))).toBe(65);
    expect(elapsedSeconds(start, at(-5))).toBe(0);
    expect(elapsedSeconds(null, at(5))).toBe(0);
  });
  it("formats minutes with padded seconds", () => {
    expect(formatElapsed(45)).toBe("45 s");
    expect(formatElapsed(65)).toBe("1 min 05 s");
    expect(formatElapsed(720)).toBe("12 min 00 s");
  });
});
