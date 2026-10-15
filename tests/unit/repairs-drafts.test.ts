import { describe, expect, it } from "vitest";
import {
  callScript, coiRequestDraft, emailDate, generalDraft, jobGoAheadDraft, notChosenDraft, ownerNoticeDraft,
  paperworkRequestDraft, quoteRequestDraft, w9RequestDraft, type Draft, type DraftContext,
} from "@/lib/repairs/drafts";
import { fitsMailto } from "@/lib/email/mailto";

const CTX: DraftContext = {
  association: { displayName: "2158 N Damen", legalName: "2158 N Damen Condominium Association", address: "2158 N Damen Ave, Chicago, IL 60647" },
  sender: { name: "Cy Board", phone: "312-555-0142" },
  contractor: { name: "Acme Plumbing", contactName: "Pat Lee" },
};
const NO_CONTACT: DraftContext = { ...CTX, contractor: { name: "Acme Plumbing", contactName: null }, sender: { name: "Cy Board", phone: null } };
const JOB = { reference: 12, title: "Leak in the back stairwell", description: "Water drips from the landing after rain.", where: "Shared area: back stairwell", photosAttached: 0 };

const SIGNOFF = "Thanks,\nCy Board\n312-555-0142\nBoard of 2158 N Damen";

describe("quoteRequestDraft", () => {
  it("builds the subject and body", () => {
    const d = quoteRequestDraft(CTX, JOB);
    expect(d.subject).toBe("Quote request: Leak in the back stairwell (#12), 2158 N Damen");
    expect(d.body).toBe([
      "Hi Pat,",
      "",
      "We're on the board of 2158 N Damen, 2158 N Damen Ave, Chicago, IL 60647, a small condominium building. We'd like a quote for this job:",
      "",
      "Leak in the back stairwell",
      "Where: Shared area: back stairwell",
      "Water drips from the landing after rain.",
      "",
      "Could you tell us:",
      "- whether you can take it on, and roughly when you could start",
      "- what you would charge, and what that includes",
      "- any deposit or payment terms",
      "- whether you carry liability insurance (we ask for a certificate before work starts)",
      "",
      "We're asking a few contractors, and nothing is approved until we confirm in writing. We can send photos if they would help.",
      "",
      SIGNOFF,
    ].join("\n"));
  });

  it("falls back to Hello and leaves out a missing phone, description and address", () => {
    const d = quoteRequestDraft({ ...NO_CONTACT, association: { ...CTX.association, address: null } }, { ...JOB, description: null });
    expect(d.body.startsWith("Hello,\n\nWe're on the board of 2158 N Damen, a small condominium building.")).toBe(true);
    expect(d.body).toContain("Where: Shared area: back stairwell\n\nCould you tell us:");
    expect(d.body.endsWith("Thanks,\nCy Board\nBoard of 2158 N Damen")).toBe(true);
  });

  it("words the photo line for 0, 1 and 3 photos", () => {
    expect(quoteRequestDraft(CTX, { ...JOB, photosAttached: 0 }).body).toContain("We can send photos if they would help.");
    expect(quoteRequestDraft(CTX, { ...JOB, photosAttached: 1 }).body).toContain("I've attached 1 photo.");
    expect(quoteRequestDraft(CTX, { ...JOB, photosAttached: 3 }).body).toContain("I've attached 3 photos.");
  });
});

describe("other contractor drafts", () => {
  it("go-ahead lists the agreed facts that exist", () => {
    const d = jobGoAheadDraft(CTX, {
      reference: 12, title: "Leak in the back stairwell", where: "Shared area: back stairwell", accessNotes: "Key in the lockbox, code from Cy",
      scheduledFor: "2026-10-22", scheduledWindow: "8 to 10am", amount: "4250.00", amountKind: "not_to_exceed", paymentTerms: "Half up front",
    });
    expect(d.subject).toBe("Go-ahead: Leak in the back stairwell (#12), 2158 N Damen");
    expect(d.body).toBe([
      "Hi Pat,",
      "",
      "Thank you for your quote. We'd like you to go ahead with this job:",
      "",
      "Leak in the back stairwell",
      "Where: Shared area: back stairwell",
      "Agreed price: $4,250 (not to exceed)",
      "Payment terms: Half up front",
      "Planned visit: Thursday, October 22, 2026, 8 to 10am",
      "Access: Key in the lockbox, code from Cy",
      "",
      "Please check with us before doing anything beyond what we agreed, and send us a current certificate of insurance before you start if we don't already have one.",
      "",
      SIGNOFF,
    ].join("\n"));
    const bare = jobGoAheadDraft(NO_CONTACT, {
      reference: 3, title: "Gutter", where: "Shared area", accessNotes: null, scheduledFor: null, scheduledWindow: null,
      amount: null, amountKind: null, paymentTerms: null,
    });
    expect(bare.body).not.toMatch(/Agreed price|Payment terms|Planned visit|Access:/);
    expect(jobGoAheadDraft(CTX, { reference: 3, title: "Gutter", where: "Shared area", accessNotes: null, scheduledFor: null, scheduledWindow: null,
      amount: "300.50", amountKind: "fixed", paymentTerms: null }).body).toContain("Agreed price: $300.50 (fixed price)");
  });

  it("not chosen", () => {
    expect(notChosenDraft(CTX, { title: "Roof repair" })).toEqual({
      subject: "Your quote for Roof repair",
      body: `Hi Pat,\n\nThank you for your quote for Roof repair. We've decided to go with another contractor this time, and we'll keep you in mind.\n\n${SIGNOFF}`,
    });
  });

  it("W-9 request with and without a form link", () => {
    const withUrl = w9RequestDraft(CTX, "https://www.irs.gov/pub/irs-pdf/fw9.pdf");
    expect(withUrl.subject).toBe("2158 N Damen: W-9 request");
    expect(withUrl.body).toContain("2158 N Damen Condominium Association needs a completed Form W-9 from you for our records before we can prepare a 1099-NEC. The form is here: https://www.irs.gov/pub/irs-pdf/fw9.pdf");
    expect(withUrl.body).toContain("You can reply to this email with it attached.");
    expect(w9RequestDraft(CTX, null).body).toContain("You can download the form from irs.gov (search for Form W-9).");
  });

  it("certificate request names the holder and address", () => {
    const d = coiRequestDraft(CTX);
    expect(d.subject).toBe("2158 N Damen: certificate of insurance");
    expect(d.body).toContain("Before any more work at 2158 N Damen, could you send us a current certificate of insurance showing your general liability (and workers' compensation, if you have employees)?");
    expect(d.body).toContain("Please name 2158 N Damen Condominium Association as the certificate holder, 2158 N Damen Ave, Chicago, IL 60647, and list the association, its board of directors, and its managing agent as additional insured parties.");
    expect(d.body).toContain("A PDF reply to this email is perfect.");
  });

  it("paperwork request with and without a W-9 URL", () => {
    const d = paperworkRequestDraft(CTX, "https://example.org/w9.pdf");
    expect(d.subject).toBe("2158 N Damen: paperwork before work starts");
    expect(d.body).toContain("Before work at 2158 N Damen, we need two things for our records:");
    expect(d.body).toContain("and the association, its board of directors, and its managing agent as additional insured parties");
    expect(d.body).toContain("- a completed Form W-9, so we can prepare a 1099-NEC (the form is here: https://example.org/w9.pdf)");
    expect(paperworkRequestDraft(CTX, null).body).toContain("- a completed Form W-9, so we can prepare a 1099-NEC (from irs.gov, search for Form W-9)");
  });

  it("general draft leaves line 3 for the board", () => {
    const d = generalDraft(NO_CONTACT, null);
    expect(d.subject).toBe("A question, 2158 N Damen");
    expect(d.body).toBe("Hello,\n\n\nThanks,\nCy Board\nBoard of 2158 N Damen");
    expect(generalDraft(CTX, "Invoice 114").subject).toBe("Invoice 114, 2158 N Damen");
  });
});

describe("ownerNoticeDraft", () => {
  const base = { contractorName: "Acme Plumbing", title: "Leak in the back stairwell", where: "Shared area: back stairwell", date: "2026-10-22", window: "8 to 10am", serviceOff: null, needsUnitAccess: false };

  it("says who, when and where", () => {
    const d = ownerNoticeDraft(CTX, base);
    expect(d.subject).toBe("2158 N Damen: contractor visit on Thursday, October 22, 2026");
    expect(d.body).toBe(
      "Hello,\n\nAcme Plumbing will be at 2158 N Damen on Thursday, October 22, 2026, 8 to 10am to work on: Leak in the back stairwell (Shared area: back stairwell).\n\nThanks,\nCy Board\nBoard of 2158 N Damen",
    );
  });

  it("adds the service-off and access lines only when they apply", () => {
    const d = ownerNoticeDraft(CTX, { ...base, contractorName: null, window: null, serviceOff: { what: "water", from: "9am", to: "noon" }, needsUnitAccess: true });
    expect(d.body).toBe([
      "Hello,",
      "",
      "A contractor will be at 2158 N Damen on Thursday, October 22, 2026 to work on: Leak in the back stairwell (Shared area: back stairwell).",
      "Water will be off from 9am to noon.",
      "We need access to your unit. Reply if that time doesn't work.",
      "",
      "Thanks,",
      "Cy Board",
      "Board of 2158 N Damen",
    ].join("\n"));
  });
});

describe("drafts in general", () => {
  it("call script", () => {
    expect(callScript({ title: "Leak", where: "Inside Unit 2" })).toBe(
      "Job: Leak. Where: Inside Unit 2. Ask: can you take it on, when could you come, what would you charge, any deposit, and do you carry liability insurance?",
    );
  });

  it("writes dates out in full", () => {
    expect(emailDate("2026-10-22")).toBe("Thursday, October 22, 2026");
    expect(emailDate("nope")).toBe("nope");
  });

  it("no em dash anywhere, and typical bodies fit in a mail link", () => {
    const all: Draft[] = [
      quoteRequestDraft(CTX, { ...JOB, photosAttached: 2 }),
      jobGoAheadDraft(CTX, { reference: 12, title: JOB.title, where: JOB.where, accessNotes: "Side gate", scheduledFor: "2026-10-22", scheduledWindow: "8 to 10am", amount: "4250.00", amountKind: "estimate", paymentTerms: "Net 30" }),
      notChosenDraft(CTX, { title: JOB.title }),
      w9RequestDraft(CTX, "https://www.irs.gov/pub/irs-pdf/fw9.pdf"),
      coiRequestDraft(CTX),
      paperworkRequestDraft(CTX, "https://www.irs.gov/pub/irs-pdf/fw9.pdf"),
      generalDraft(CTX, null),
      ownerNoticeDraft(CTX, { contractorName: "Acme", title: JOB.title, where: JOB.where, date: "2026-10-22", window: "8 to 10am", serviceOff: { what: "heat", from: "9am", to: "1pm" }, needsUnitAccess: true }),
    ];
    for (const d of all) {
      expect(`${d.subject}\n${d.body}`).not.toMatch(/—/);
      expect(fitsMailto(d.subject, d.body)).toBe(true);
    }
    expect(callScript({ title: "x", where: "y" })).not.toMatch(/—/);
  });
});
