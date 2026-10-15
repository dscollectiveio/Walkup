import { describe, expect, it } from "vitest";
import { notConfiguredCopy, sendConfig } from "@/lib/email-outbox/config";
import { LEGAL_ADDRESS, legalAddressIsSet } from "@/lib/site-config";

const REAL = "1 Example Street, Chicago, IL 60601";

describe("sendConfig", () => {
  it("is ok with a key and a real address, with the default sender", () => {
    expect(sendConfig({ RESEND_API_KEY: "re_key" }, REAL)).toEqual({ ok: true, apiKey: "re_key", from: "notifications@walkuphoa.com" });
  });

  it("reports no_key when the key is missing or blank", () => {
    expect(sendConfig({}, REAL)).toEqual({ ok: false, reason: "no_key" });
    expect(sendConfig({ RESEND_API_KEY: "   " }, REAL)).toEqual({ ok: false, reason: "no_key" });
  });

  it("is switched off by EMAIL_SENDING_DISABLED=1 even with a key", () => {
    expect(sendConfig({ RESEND_API_KEY: "re_key", EMAIL_SENDING_DISABLED: "1" }, REAL)).toEqual({ ok: false, reason: "disabled" });
    expect(sendConfig({ RESEND_API_KEY: "re_key", EMAIL_SENDING_DISABLED: "0" }, REAL).ok).toBe(true);
  });

  it("fails closed while the legal address is a TODO placeholder", () => {
    expect(sendConfig({ RESEND_API_KEY: "re_key" }, "TODO(doug): DS Collective LLC postal address")).toEqual({ ok: false, reason: "no_legal_address" });
    expect(sendConfig({ RESEND_API_KEY: "re_key" }, "")).toEqual({ ok: false, reason: "no_legal_address" });
  });

  it("uses the repository's real LEGAL_ADDRESS constant, which is still a placeholder", () => {
    expect(LEGAL_ADDRESS.startsWith("TODO")).toBe(true);
    expect(legalAddressIsSet).toBe(false);
    expect(sendConfig({ RESEND_API_KEY: "re_key" })).toEqual({ ok: false, reason: "no_legal_address" });
  });

  it("takes a valid EMAIL_FROM_ADDRESS and ignores one that is not a plain address", () => {
    expect(sendConfig({ RESEND_API_KEY: "k", EMAIL_FROM_ADDRESS: "Alerts@Walkuphoa.com" }, REAL)).toMatchObject({ from: "alerts@walkuphoa.com" });
    expect(sendConfig({ RESEND_API_KEY: "k", EMAIL_FROM_ADDRESS: "Evil <x@y.test>, z@w.test" }, REAL)).toMatchObject({ from: "notifications@walkuphoa.com" });
  });

  it("says plainly why nothing sends, without an em dash", () => {
    expect(notConfiguredCopy("no_key")).toBe("Sending from Walkup isn't set up on this account, so emails are drafts you open in your own email app.");
    expect(notConfiguredCopy("disabled")).toBe(notConfiguredCopy("no_key"));
    expect(notConfiguredCopy("no_legal_address")).toBe("Walkup's mailing address isn't set yet, which every email must carry. Emails stay drafts until it is.");
    for (const r of ["no_key", "disabled", "no_legal_address"] as const) expect(notConfiguredCopy(r)).not.toMatch(/[–—]/);
  });
});
