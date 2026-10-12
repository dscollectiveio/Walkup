import "server-only";
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFRadioGroup,
  PDFRawStream,
  PDFTextField,
  StandardFonts,
  decodePDFRawStream,
  rgb,
  type PDFField,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";

// Official forms only: every function here works on the PDF the IRS or
// Illinois published, filling its own AcroForm fields by name. Nothing here
// draws, recreates, or approximates a form — the cover sheets are the only
// pages Walkup generates, and they say so.

export interface PdfField {
  name: string;
  type: "text" | "checkbox" | "radio" | "dropdown" | "other";
}

export async function enumerateFields(bytes: Uint8Array): Promise<PdfField[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return pdf.getForm().getFields().map((f) => ({
    name: f.getName(),
    type:
      f instanceof PDFTextField ? "text"
      : f instanceof PDFCheckBox ? "checkbox"
      : f instanceof PDFRadioGroup ? "radio"
      : f instanceof PDFDropdown ? "dropdown"
      : "other",
  }));
}

const TRUTHY = new Set(["true", "yes", "x", "1", "on"]);

/** Fill fields by exact AcroForm name. Names not on the form are ignored, never guessed at. */
export async function fillForm(
  bytes: Uint8Array,
  values: Record<string, string>,
  opts: { flatten: boolean },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();
  const byName = new Map(form.getFields().map((f) => [f.getName(), f]));
  for (const [name, value] of Object.entries(values)) {
    const field = byName.get(name);
    if (!field || value === "") continue;
    if (field instanceof PDFTextField) {
      const max = field.getMaxLength();
      field.setText(max !== undefined ? value.slice(0, max) : value);
    } else if (field instanceof PDFCheckBox) {
      if (TRUTHY.has(value.trim().toLowerCase())) field.check();
      else field.uncheck();
    } else if (field instanceof PDFRadioGroup) {
      if (field.getOptions().includes(value)) field.select(value);
    } else if (field instanceof PDFDropdown) {
      if (field.getOptions().includes(value)) field.select(value);
    }
  }
  if (opts.flatten) form.flatten();
  return pdf.save();
}

/**
 * The IRS carries each copy of a 1099 as its own set of fields (CopyB[0],
 * Copy2[0], …). At export, every filled value whose name contains `from` is
 * also written to the twin name with `to`, so the recipient's Copy 2 says
 * what Copy B says. A twin that was filled in its own right is left alone.
 * Pure; the field map itself names only one copy.
 */
export function mirrorValues(values: Record<string, string>, mirror: { from: string; to: string }[]): Record<string, string> {
  const out = { ...values };
  for (const { from, to } of mirror) {
    if (!from || from === to) continue;
    for (const [name, value] of Object.entries(values)) {
      if (!name.includes(from)) continue;
      const twin = name.split(from).join(to);
      if (!(twin in out)) out[twin] = value;
    }
  }
  return out;
}

/**
 * Keep only the listed pages (1-based, as the admin wrote them), e.g. the
 * recipient copies of a 1099. Pages are removed from this document rather
 * than copied into a new one — copying drops the AcroForm. Fields whose
 * every box sat on a dropped page go too, so nothing is left pointing at a
 * page that isn't there and the result can still be flattened. Refuses to
 * produce an empty document.
 */
export async function keepPages(bytes: Uint8Array, pages1Based: number[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const count = pdf.getPageCount();
  const keep = new Set(pages1Based.filter((p) => Number.isInteger(p) && p >= 1 && p <= count).map((p) => p - 1));
  if (keep.size === 0) throw new Error("None of the listed pages exist in this PDF.");
  if (keep.size === count) return pdf.save();

  const pages = pdf.getPages();
  type Widget = ReturnType<PDFField["acroField"]["getWidgets"]>[number];
  const pageIndexOf = (widget: Widget): number => {
    const byP = pages.findIndex((p) => p.ref === widget.P());
    if (byP >= 0) return byP;
    const ref = pdf.context.getObjectRef(widget.dict);
    const page = ref ? pdf.findPageForAnnotationRef(ref) : undefined;
    return page ? pages.indexOf(page) : -1;
  };
  const form = pdf.getForm();
  for (const field of form.getFields()) {
    const widgets = field.acroField.getWidgets();
    // A box whose page can't be placed is kept — never drop what can't be accounted for.
    const onKeptPage = widgets.some((w) => {
      const i = pageIndexOf(w);
      return i < 0 || keep.has(i);
    });
    if (widgets.length === 0 || onKeptPage) continue;
    try {
      form.acroForm.removeField(field.acroField);
    } catch {
      // Leave it; its page is going anyway.
    }
  }
  for (let i = count - 1; i >= 0; i--) if (!keep.has(i)) pdf.removePage(i);
  return pdf.save();
}

/** The document title the publisher wrote in ("2025 Form 1120-H"), from the Info dictionary, else the XMP metadata; null when there is none. */
export async function getTitle(bytes: Uint8Array): Promise<string | null> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const info = pdf.getTitle()?.trim();
  if (info) return info;
  try {
    const ref = pdf.catalog.get(PDFName.of("Metadata"));
    const stream = ref ? pdf.context.lookup(ref) : undefined;
    if (!(stream instanceof PDFRawStream)) return null;
    const xml = new TextDecoder().decode(decodePDFRawStream(stream).decode());
    const m = xml.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/);
    const title = m?.[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
    return title || null;
  } catch {
    return null;
  }
}

/**
 * Every text field filled with its own name, so a human can check the field
 * map against the printed form before activating a template.
 */
export async function labeledPreview(bytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();
  for (const f of form.getFields()) {
    if (f instanceof PDFTextField) {
      const name = f.getName().replace(/^topmostSubform\[0\]\./, "");
      const max = f.getMaxLength();
      f.setText(max !== undefined ? name.slice(0, max) : name);
      try {
        f.setFontSize(5);
      } catch {
        // Some fields carry a fixed appearance; the name still shows.
      }
    }
  }
  return pdf.save();
}

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if ((line + " " + word).trim().length > max) {
        out.push(line.trim());
        line = word;
      } else line += ` ${word}`;
    }
    out.push(line.trim());
  }
  return out;
}

export const COVER_DISCLAIMER =
  "The board is responsible for reviewing these figures before filing. Walkup fills forms from your records and does not file them.";

export const DRAFT_NOTICE = "Draft from Walkup — figures not yet confirmed by the board. Not the official filing.";

/** One US-letter page of plain text, in the same type as every Walkup cover. */
async function textPage(): Promise<{ pdf: PDFDocument; line: (text: string, opts?: { size?: number; bold?: boolean; mute?: boolean; gap?: number }) => void }> {
  const pdf = await PDFDocument.create();
  const page: PDFPage = pdf.addPage([612, 792]);
  const font: PDFFont = await pdf.embedFont(StandardFonts.Helvetica);
  const bold: PDFFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink: RGB = rgb(0.11, 0.12, 0.15);
  const mute: RGB = rgb(0.43, 0.45, 0.52);
  let y = 740;
  const line = (text: string, opts: { size?: number; bold?: boolean; mute?: boolean; gap?: number } = {}) => {
    const size = opts.size ?? 11;
    for (const l of wrap(text, Math.floor(512 / (size * 0.5)))) {
      page.drawText(l, { x: 50, y, size, font: opts.bold ? bold : font, color: opts.mute ? mute : ink });
      y -= size + 4;
    }
    y -= opts.gap ?? 6;
  };
  return { pdf, line };
}

/** One plain page in front of the official form: what to sign, attach, and mail, and by when — with where that comes from. */
export async function coverSheet(input: {
  formLabel: string;
  associationName: string;
  taxYear: number;
  dueOn: string | null;
  dueCitation: string | null;
  instructions: string | null;
  instructionsCitation: string | null;
  sourceUrl: string;
}): Promise<Uint8Array> {
  const { pdf, line } = await textPage();

  line(`${input.formLabel} — ${input.taxYear}`, { size: 18, bold: true, gap: 2 });
  line(input.associationName, { mute: true, gap: 18 });

  line("Due", { bold: true, gap: 0 });
  line(input.dueOn ? `${input.dueOn}${input.dueCitation ? ` (${input.dueCitation})` : ""}` : "Not on file — confirm the due date with your CPA.", { gap: 14 });

  line("What to sign, attach, and where to mail it", { bold: true, gap: 0 });
  line(
    input.instructions
      ? `${input.instructions}${input.instructionsCitation ? `\nSource: ${input.instructionsCitation}` : ""}`
      : "Not on file for this form. Follow the official instructions, or ask your CPA.",
    { gap: 14 },
  );

  line("The form that follows", { bold: true, gap: 0 });
  line(`The official form as published at ${input.sourceUrl}, filled from your records. Walkup does not redraw or alter forms.`, { gap: 20 });

  line(COVER_DISCLAIMER, { bold: true });
  return pdf.save();
}

/**
 * The page in front of an editable PDF while the form is still a draft or
 * in review: a CPA gets the figures to work on, and nobody mistakes the
 * packet for the filing.
 */
export async function draftCover(input: { formLabel: string; associationName: string; taxYear: number }): Promise<Uint8Array> {
  const { pdf, line } = await textPage();

  line(`${input.formLabel} — ${input.taxYear}`, { size: 18, bold: true, gap: 2 });
  line(input.associationName, { mute: true, gap: 18 });

  line(DRAFT_NOTICE, { size: 14, bold: true, gap: 12 });
  line(
    "These figures come from the association's records in Walkup. The board hasn't confirmed every line yet, and nothing has been filed. " +
      "The fields on the pages that follow can be edited; please change what needs changing and send it back.",
    { gap: 14 },
  );

  line("The form that follows", { bold: true, gap: 0 });
  line("The official form as published by the IRS or the State of Illinois, filled from the records. Walkup does not redraw or alter forms.", { gap: 20 });

  line(COVER_DISCLAIMER, { bold: true });
  return pdf.save();
}

/**
 * Cover and form in one PDF. The cover's pages are copied into the form's
 * document, not the other way round, so the form keeps its fillable fields —
 * what the editable packet for a CPA is for. For a flattened packet,
 * concatPdfs does the same job.
 */
export async function prependCover(coverBytes: Uint8Array, formBytes: Uint8Array): Promise<Uint8Array> {
  const form = await PDFDocument.load(formBytes, { ignoreEncryption: true });
  const cover = await PDFDocument.load(coverBytes, { ignoreEncryption: true });
  const pages = await form.copyPages(cover, cover.getPageIndices());
  pages.forEach((pg, i) => form.insertPage(i, pg));
  return form.save();
}

export async function concatPdfs(parts: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const p of parts) {
    const doc = await PDFDocument.load(p, { ignoreEncryption: true });
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((pg) => out.addPage(pg));
  }
  return out.save();
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Official sources only. */
export function isOfficialFormUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && /^(www\.)?(irs\.gov|tax\.illinois\.gov|ilsos\.gov)$/.test(u.hostname);
  } catch {
    return false;
  }
}
