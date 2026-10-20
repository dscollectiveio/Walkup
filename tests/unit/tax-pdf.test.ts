import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("server-only", () => ({}));

import { PDFDocument } from "pdf-lib";
import {
  DRAFT_NOTICE,
  concatPdfs,
  coverSheet,
  draftCover,
  enumerateFields,
  fillForm,
  getTitle,
  isOfficialFormUrl,
  keepPages,
  labeledPreview,
  mirrorValues,
  prependCover,
  sha256Hex,
} from "@/lib/tax/pdf";

/** The official PDFs the suggested maps were authored against (public-domain US government works). */
const fixture = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/tax/${name}`, import.meta.url))));

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

const COPY_B_BOX_1A = "topmostSubform[0].CopyB[0].RightCol[0].f2_20[0]";
const COPY_2_BOX_1A = "topmostSubform[0].Copy2[0].RightCol[0].f2_20[0]";

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

  it("renders the draft cover for a CPA's editable copy, and keeps the form fillable behind it", async () => {
    expect(DRAFT_NOTICE).toBe("Draft from Walkup: figures not yet confirmed by the board. Not the official filing.");
    const cover = await draftCover({ formLabel: "Form 1120-H", associationName: "2158 N. Damen Condominium Association", taxYear: 2025 });
    expect((await PDFDocument.load(cover)).getPageCount()).toBe(1);

    const packet = await PDFDocument.load(await prependCover(cover, await fillForm(await fakeForm(), { f1_1: "2158 N. Damen" }, { flatten: false })));
    expect(packet.getPageCount()).toBe(2);
    expect(packet.getForm().getFields().map((f) => f.getName())).toEqual(["f1_1", "f1_2", "c1_1"]);
    expect(packet.getForm().getTextField("f1_1").getText()).toBe("2158 N. Damen");
  });

  it("reads the title the publisher wrote into the PDF", async () => {
    expect(await getTitle(fixture("f1120h-2025.pdf"))).toBe("2025 Form 1120-H");
    expect(await getTitle(fixture("f1099nec-2026.pdf"))).toBe("Form 1099-NEC (Rev. December 2026)");
    expect(await getTitle(await fakeForm())).toBeNull();
  });

  it("keeps only the listed 1-based pages and the fields on them, leaving the AcroForm intact", async () => {
    const kept = await keepPages(fixture("f1099nec-2026.pdf"), [4, 5, 6]);
    expect((await PDFDocument.load(kept, { ignoreEncryption: true })).getPageCount()).toBe(3);

    const names = (await enumerateFields(kept)).map((f) => f.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain(COPY_B_BOX_1A);
    expect(names).toContain(COPY_2_BOX_1A);
    // Copy A and Copy 1 went with their pages; a self-printed Copy A must never be filed.
    expect(names.some((n) => n.includes("CopyA[0]") || n.includes("Copy1[0]"))).toBe(false);

    // What's left still fills, and still flattens for the signable packet.
    const filled = await fillForm(kept, { [COPY_B_BOX_1A]: "1250.00" }, { flatten: false });
    expect((await PDFDocument.load(filled, { ignoreEncryption: true })).getForm().getTextField(COPY_B_BOX_1A).getText()).toBe("1250.00");
    const flat = await fillForm(kept, { [COPY_B_BOX_1A]: "1250.00" }, { flatten: true });
    expect((await PDFDocument.load(flat, { ignoreEncryption: true })).getForm().getFields()).toHaveLength(0);
  });

  it("keeps everything when every page is listed, and refuses to keep nothing", async () => {
    const all = await keepPages(fixture("f1120h-2025.pdf"), [1]);
    expect((await PDFDocument.load(all, { ignoreEncryption: true })).getPageCount()).toBe(1);
    expect(await enumerateFields(all)).toHaveLength(70);
    await expect(keepPages(await fakeForm(), [2])).rejects.toThrow("None of the listed pages exist");
    await expect(keepPages(await fakeForm(), [])).rejects.toThrow();
  });

  it("mirrors filled values onto their twin fields — Copy B to Copy 2 — without touching anything else", () => {
    const values = {
      "topmostSubform[0].CopyB[0].LeftCol[0].f2_2[0]": "2158 N. Damen Condominium Association",
      [COPY_B_BOX_1A]: "1250.00",
      "topmostSubform[0].Page1[0].f1_11[0]": "36-0000000",
    };
    const mirrored = mirrorValues(values, [{ from: "CopyB[0]", to: "Copy2[0]" }]);
    expect(mirrored).toEqual({
      ...values,
      "topmostSubform[0].Copy2[0].LeftCol[0].f2_2[0]": "2158 N. Damen Condominium Association",
      [COPY_2_BOX_1A]: "1250.00",
    });
    expect(Object.keys(values)).toHaveLength(3);
    // A twin that was filled in its own right keeps its own value; an empty or identity mirror does nothing.
    expect(mirrorValues({ "a.CopyB[0].x": "1", "a.Copy2[0].x": "2" }, [{ from: "CopyB[0]", to: "Copy2[0]" }])).toEqual({ "a.CopyB[0].x": "1", "a.Copy2[0].x": "2" });
    expect(mirrorValues(values, [])).toEqual(values);
    expect(mirrorValues(values, [{ from: "", to: "Copy2[0]" }, { from: "CopyB[0]", to: "CopyB[0]" }])).toEqual(values);
  });

  it("fills the recipient copies of the real 1099-NEC through mirror, fill and keepPages in the export order", async () => {
    const values = mirrorValues({ [COPY_B_BOX_1A]: "1250.00" }, [{ from: "CopyB[0]", to: "Copy2[0]" }]);
    const filled = await fillForm(fixture("f1099nec-2026.pdf"), values, { flatten: false });
    const recipient = await PDFDocument.load(await keepPages(filled, [4, 5, 6]), { ignoreEncryption: true });
    expect(recipient.getPageCount()).toBe(3);
    expect(recipient.getForm().getTextField(COPY_B_BOX_1A).getText()).toBe("1250.00");
    expect(recipient.getForm().getTextField(COPY_2_BOX_1A).getText()).toBe("1250.00");
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
