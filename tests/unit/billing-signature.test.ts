import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signStripePayload, verifyStripeSignature } from "@/lib/billing/stripe-signature";

const SECRET = "whsec_test_secret_value";
const BODY = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
const NOW = 1_800_000_000_000;
const T = Math.floor(NOW / 1000);

describe("verifyStripeSignature", () => {
  it("accepts a valid signature, including among several v1 entries and a v0", () => {
    const header = signStripePayload(SECRET, BODY, T);
    expect(verifyStripeSignature({ secret: SECRET, header, body: BODY, now: NOW })).toBe(true);
    const sig = header.split("v1=")[1];
    const multi = `t=${T},v1=${"0".repeat(64)},v1=${sig},v0=${"1".repeat(64)}`;
    expect(verifyStripeSignature({ secret: SECRET, header: multi, body: BODY, now: NOW })).toBe(true);
  });

  it("matches Stripe's scheme: HMAC-SHA256 of `${t}.${body}` keyed with the whsec string as is", () => {
    const sig = createHmac("sha256", SECRET).update(`${T}.${BODY}`).digest("hex");
    expect(verifyStripeSignature({ secret: SECRET, header: `t=${T},v1=${sig}`, body: BODY, now: NOW })).toBe(true);
  });

  it("refuses a tampered body, a wrong secret and a forged signature", () => {
    const header = signStripePayload(SECRET, BODY, T);
    expect(verifyStripeSignature({ secret: SECRET, header, body: BODY + " ", now: NOW })).toBe(false);
    expect(verifyStripeSignature({ secret: "whsec_other", header, body: BODY, now: NOW })).toBe(false);
    expect(verifyStripeSignature({ secret: SECRET, header: `t=${T},v1=${"a".repeat(64)}`, body: BODY, now: NOW })).toBe(false);
  });

  it("refuses a stale or future timestamp outside five minutes", () => {
    const old = signStripePayload(SECRET, BODY, T - 301);
    expect(verifyStripeSignature({ secret: SECRET, header: old, body: BODY, now: NOW })).toBe(false);
    const future = signStripePayload(SECRET, BODY, T + 301);
    expect(verifyStripeSignature({ secret: SECRET, header: future, body: BODY, now: NOW })).toBe(false);
    const edge = signStripePayload(SECRET, BODY, T - 299);
    expect(verifyStripeSignature({ secret: SECRET, header: edge, body: BODY, now: NOW })).toBe(true);
  });

  it("refuses missing pieces and malformed headers", () => {
    const header = signStripePayload(SECRET, BODY, T);
    expect(verifyStripeSignature({ secret: undefined, header, body: BODY, now: NOW })).toBe(false);
    expect(verifyStripeSignature({ secret: SECRET, header: null, body: BODY, now: NOW })).toBe(false);
    expect(verifyStripeSignature({ secret: SECRET, header: "garbage", body: BODY, now: NOW })).toBe(false);
    expect(verifyStripeSignature({ secret: SECRET, header: `v1=${header.split("v1=")[1]}`, body: BODY, now: NOW })).toBe(false);
    expect(verifyStripeSignature({ secret: SECRET, header: `t=abc,v1=${header.split("v1=")[1]}`, body: BODY, now: NOW })).toBe(false);
    expect(verifyStripeSignature({ secret: SECRET, header: `t=${T},v1=short`, body: BODY, now: NOW })).toBe(false);
  });
});
