import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySvix } from "@/lib/email-outbox/svix";

const SECRET_BYTES = Buffer.from("walkup-test-signing-key-0123456789");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;
const NOW = 1_800_000_000_000; // ms
const TS = String(NOW / 1000);
const BODY = '{"type":"email.delivered","data":{"email_id":"re_123"}}';
const sign = (id: string, ts: string, body: string, key = SECRET_BYTES) => createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
const good = `v1,${sign("msg_1", TS, BODY)}`;
const base = { secret: SECRET, id: "msg_1", timestamp: TS, signature: good, body: BODY, now: NOW };

describe("verifySvix", () => {
  it("accepts a correctly signed body", () => {
    expect(verifySvix(base)).toBe(true);
  });

  it("accepts a vector signed outside this code, and rejects the same bytes in another order", () => {
    // Both literals came from the shell, not from createHmac in this file:
    //   printf '%s' 'msg_1.1800000000.<body>' | openssl dgst -sha256 -hmac 'walkup-test-signing-key-0123456789' -binary | base64
    //   printf '%s' 'walkup-test-signing-key-0123456789' | base64
    const secret = "whsec_d2Fsa3VwLXRlc3Qtc2lnbmluZy1rZXktMDEyMzQ1Njc4OQ==";
    const signature = "v1,KuCUe3ChV1McnGNvcKw5mkFz8sgamU9SRCrl12SHlXI=";
    const fixed = { secret, id: "msg_1", timestamp: "1800000000", signature, body: BODY, now: NOW };
    expect(verifySvix(fixed)).toBe(true);
    // a signature over timestamp.id.body (the wrong order) must not verify
    const swapped = `v1,${createHmac("sha256", SECRET_BYTES).update(`${TS}.msg_1.${BODY}`).digest("base64")}`;
    expect(verifySvix({ ...fixed, signature: swapped })).toBe(false);
    // and the key is the base64-decoded bytes, not the literal text after whsec_
    const literalKey = `v1,${createHmac("sha256", "d2Fsa3VwLXRlc3Qtc2lnbmluZy1rZXktMDEyMzQ1Njc4OQ==").update(`msg_1.${TS}.${BODY}`).digest("base64")}`;
    expect(verifySvix({ ...fixed, signature: literalKey })).toBe(false);
  });

  it("rejects a tampered body", () => {
    expect(verifySvix({ ...base, body: BODY.replace("delivered", "bounced") })).toBe(false);
  });

  it("rejects an old and a future timestamp but accepts the edge of the window", () => {
    const old = String(NOW / 1000 - 301);
    expect(verifySvix({ ...base, timestamp: old, signature: `v1,${sign("msg_1", old, BODY)}` })).toBe(false);
    const future = String(NOW / 1000 + 301);
    expect(verifySvix({ ...base, timestamp: future, signature: `v1,${sign("msg_1", future, BODY)}` })).toBe(false);
    const edge = String(NOW / 1000 - 300);
    expect(verifySvix({ ...base, timestamp: edge, signature: `v1,${sign("msg_1", edge, BODY)}` })).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(verifySvix({ ...base, id: null })).toBe(false);
    expect(verifySvix({ ...base, timestamp: null })).toBe(false);
    expect(verifySvix({ ...base, signature: null })).toBe(false);
    expect(verifySvix({ ...base, secret: undefined })).toBe(false);
    expect(verifySvix({ ...base, secret: "" })).toBe(false);
  });

  it("rejects the wrong secret and a different message id", () => {
    expect(verifySvix({ ...base, secret: `whsec_${Buffer.from("another-key").toString("base64")}` })).toBe(false);
    expect(verifySvix({ ...base, id: "msg_2" })).toBe(false);
  });

  it("accepts any valid entry in a multi-signature header and ignores other versions", () => {
    const bad = `v1,${Buffer.from("x".repeat(32)).toString("base64")}`;
    expect(verifySvix({ ...base, signature: `${bad} ${good}` })).toBe(true);
    expect(verifySvix({ ...base, signature: `${good} ${bad}` })).toBe(true);
    expect(verifySvix({ ...base, signature: `v2,${sign("msg_1", TS, BODY)}` })).toBe(false);
    expect(verifySvix({ ...base, signature: `${bad} v1a,${sign("msg_1", TS, BODY)}` })).toBe(false);
  });

  it("rejects a non-numeric timestamp and a signature of the wrong length", () => {
    expect(verifySvix({ ...base, timestamp: "abc" })).toBe(false);
    expect(verifySvix({ ...base, signature: "v1,AAAA" })).toBe(false);
    expect(verifySvix({ ...base, signature: "v1," })).toBe(false);
  });
});
