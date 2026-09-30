import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PDFDocument } from "pdf-lib";
import { concatPdfs, coverSheet, enumerateFields, fillForm, isOfficialFormUrl, labeledPreview, sha256Hex } from "@/lib/tax/pdf";

/** A small fillable PDF standing in for an official form. */
async function fakeForm(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  form.createTextField("f1_1").addToPage(page, { x: 50, y: 700, width: 300, height: 20 });
  form.createTextField("f1_2").addToPage(page, { x: 50, y: 660, width: 300, height: 20 });
  form.createCheckBox("c1_1").addToPage(page, { x: 50, y: 620, width: 12, height: 12 });
  return pdf.save();
}

describe("official form PDFs", () => {
  it("enumerates every AcroForm field with its type", async () => {
    expect(await enumerateFields(await fakeForm())).toEqual([
      { name: "f1_1", type: "text" },
      { name: "f1_2", type: "text" },
      { name: "c1_1", type: "checkbox" },
    ]);
  });

  it("fills fields by exact name and ignores names that aren't on the form", async () => {
    const filled = await fillForm(await fakeForm(), { f1_1: "2158 N. Damen", c1_1: "true", not_a_field: "x" }, { flatten: false });
    const form = (await PDFDocument.load(filled)).getForm();
    expect(form.getTextField("f1_1").getText()).toBe("2158 N. Damen");
    expect(form.getTextField("f1_2").getText()).toBeUndefined();
    expect(form.getCheckBox("c1_1").isChecked()).toBe(true);
  });

  it("flattens for the signable packet", async () => {
    const flat = await fillForm(await fakeForm(), { f1_1: "x" }, { flatten: true });
    expect((await PDFDocument.load(flat)).getForm().getFields()).toHaveLength(0);
  });

  it("labels each field with its own name for the admin preview", async () => {
    const form = (await PDFDocument.load(await labeledPreview(await fakeForm()))).getForm();
    expect(form.getTextField("f1_2").getText()).toBe("f1_2");
  });

  it("puts a one-page cover sheet with the disclaimer in front of the form", async () => {
    const cover = await coverSheet({
      formLabel: "Form 1120-H",
      associationName: "2158 N. Damen",
      taxYear: 2026,
      dueOn: null,
      dueCitation: null,
      instructions: null,
      instructionsCitation: null,
      sourceUrl: "https://www.irs.gov/pub/irs-pdf/f1120h.pdf",
    });
    const packet = await concatPdfs([cover, await fakeForm()]);
    expect((await PDFDocument.load(packet)).getPageCount()).toBe(2);
  });

  it("only accepts official sources", () => {
    expect(isOfficialFormUrl("https://www.irs.gov/pub/irs-pdf/f1120h.pdf")).toBe(true);
    expect(isOfficialFormUrl("https://tax.illinois.gov/content/dam/forms/il-1120.pdf")).toBe(true);
    expect(isOfficialFormUrl("http://www.irs.gov/pub/irs-pdf/f1120h.pdf")).toBe(false);
    expect(isOfficialFormUrl("https://irs.gov.example.com/f1120h.pdf")).toBe(false);
    expect(isOfficialFormUrl("https://example.com/f1120h.pdf")).toBe(false);
  });

  it("checksums with SHA-256", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
