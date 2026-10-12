// Lists every AcroForm field in an official PDF, with the page it sits on,
// and the file's SHA-256 — the facts a suggested field map is authored
// against (src/lib/tax/suggested/, DECISIONS #33). The output is what
// tests/fixtures/tax/*-fields.json holds, so tests/unit/tax-suggested.test.ts
// can prove every mapped name exists without loading the PDF each time.
//
// Node and pdf-lib only; nothing is drawn, filled or altered.
//
//   node scripts/enumerate-pdf-fields.mjs <pdf> [--json out.json]
//
// Prints { file, sha256, title, pageCount, fields: [{ name, type, page, maxLength }] }
// as JSON. `page` is 1-based; a field whose widgets sit on several pages also
// lists them all under `pages`. Re-run against a fresh download when the IRS
// republishes a form — a changed sha256 means the map must be re-checked.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFRadioGroup, PDFTextField } from "pdf-lib";

const args = process.argv.slice(2);
const jsonFlag = args.indexOf("--json");
const outPath = jsonFlag === -1 ? null : args[jsonFlag + 1];
const pdfPath = args.find((a, i) => a !== "--json" && i !== jsonFlag + 1);

if (!pdfPath || (jsonFlag !== -1 && !outPath)) {
  console.error("usage: node scripts/enumerate-pdf-fields.mjs <pdf> [--json out.json]");
  process.exit(2);
}

const bytes = readFileSync(pdfPath);
const sha256 = createHash("sha256").update(bytes).digest("hex");

// Official IRS PDFs are encrypted for "no changes"; pdf-lib still reads them
// the same way src/lib/tax/pdf.ts does.
const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
const pages = pdf.getPages();
const pageIndexByRef = new Map(pages.map((p, i) => [p.ref.toString(), i]));

const typeOf = (field) =>
  field instanceof PDFTextField ? "text"
  : field instanceof PDFCheckBox ? "checkbox"
  : field instanceof PDFRadioGroup ? "radio"
  : field instanceof PDFDropdown ? "dropdown"
  : "other";

/** 0-based page index of one widget, or null when the PDF doesn't say. */
function pageOf(widget) {
  const byP = widget.P();
  if (byP && pageIndexByRef.has(byP.toString())) return pageIndexByRef.get(byP.toString());
  const widgetRef = pdf.context.getObjectRef(widget.dict);
  if (!widgetRef) return null;
  const page = pdf.findPageForAnnotationRef(widgetRef);
  return page ? pages.indexOf(page) : null;
}

const fields = pdf.getForm().getFields().map((field) => {
  const found = [...new Set(field.acroField.getWidgets().map(pageOf).filter((i) => i !== null))].sort((a, b) => a - b);
  const maxLength = field instanceof PDFTextField ? field.getMaxLength() : undefined;
  return {
    name: field.getName(),
    type: typeOf(field),
    page: found.length ? found[0] + 1 : null,
    ...(found.length > 1 ? { pages: found.map((i) => i + 1) } : {}),
    maxLength: maxLength ?? null,
  };
});

const result = {
  file: basename(pdfPath),
  sha256,
  title: pdf.getTitle() ?? null,
  pageCount: pages.length,
  fields,
};

const text = JSON.stringify(result, null, 2) + "\n";
if (outPath) writeFileSync(outPath, text);
process.stdout.write(text);
