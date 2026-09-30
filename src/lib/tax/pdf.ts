import "server-only";
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFRadioGroup, PDFTextField, StandardFonts, rgb } from "pdf-lib";

// Official forms only: every function here works on the PDF the IRS or
// Illinois published, filling its own AcroForm fields by name. Nothing here
// draws, recreates, or approximates a form — the cover sheet is the only page
// Walkup generates, and it says so.

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
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.11, 0.12, 0.15);
  const mute = rgb(0.43, 0.45, 0.52);
  let y = 740;
  const line = (text: string, opts: { size?: number; f?: typeof font; color?: typeof ink; gap?: number } = {}) => {
    const size = opts.size ?? 11;
    for (const l of wrap(text, Math.floor(512 / (size * 0.5)))) {
      page.drawText(l, { x: 50, y, size, font: opts.f ?? font, color: opts.color ?? ink });
      y -= size + 4;
    }
    y -= opts.gap ?? 6;
  };

  line(`${input.formLabel} — ${input.taxYear}`, { size: 18, f: bold, gap: 2 });
  line(input.associationName, { color: mute, gap: 18 });

  line("Due", { f: bold, gap: 0 });
  line(input.dueOn ? `${input.dueOn}${input.dueCitation ? ` (${input.dueCitation})` : ""}` : "Not on file — confirm the due date with your CPA.", { gap: 14 });

  line("What to sign, attach, and where to mail it", { f: bold, gap: 0 });
  line(
    input.instructions
      ? `${input.instructions}${input.instructionsCitation ? `\nSource: ${input.instructionsCitation}` : ""}`
      : "Not on file for this form. Follow the official instructions, or ask your CPA.",
    { gap: 14 },
  );

  line("The form that follows", { f: bold, gap: 0 });
  line(`The official form as published at ${input.sourceUrl}, filled from your records. Walkup does not redraw or alter forms.`, { gap: 20 });

  line(COVER_DISCLAIMER, { f: bold });
  return pdf.save();
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
