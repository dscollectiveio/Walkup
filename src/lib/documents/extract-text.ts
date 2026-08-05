import "server-only";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import { redactTaxIds } from "./redact";

/**
 * Get the readable text out of a stored file.
 *
 * Native text layers only. There is deliberately no OCR yet: a photographed
 * page needs one, but adding an OCR engine is its own decision with its own
 * dependency and cost, and guessing at a scan's contents is worse than saying
 * plainly that nothing was read. An unreadable file returns a reason rather
 * than an empty string, so the UI can distinguish "no text in this file" from
 * "not looked at yet".
 *
 * Redaction happens here, at the boundary, so no caller can accidentally
 * handle un-redacted text (see redact.ts).
 */

export type ExtractionOutcome =
  | { ok: true; text: string; redactedCount: number }
  | { ok: false; reason: string };

const TEXTUAL = new Set(["text/plain", "text/csv"]);

export async function extractDocumentText(
  mimeType: string | null,
  bytes: Uint8Array,
): Promise<ExtractionOutcome> {
  const clean = (raw: string): ExtractionOutcome => {
    const collapsed = raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (collapsed.length === 0) {
      return { ok: false, reason: "This file has no text layer to read." };
    }
    const { text, count } = redactTaxIds(collapsed);
    return { ok: true, text, redactedCount: count };
  };

  if (mimeType === "application/pdf") {
    try {
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractPdfText(pdf, { mergePages: true });
      const merged = Array.isArray(text) ? text.join("\n\n") : text;
      if (!merged.trim()) {
        return {
          ok: false,
          reason:
            "This PDF is a scan with no text layer. Reading it would need OCR, which Walkup doesn't do yet.",
        };
      }
      return clean(merged);
    } catch (cause) {
      return { ok: false, reason: `This PDF couldn't be read: ${(cause as Error).message}` };
    }
  }

  if (mimeType && TEXTUAL.has(mimeType)) {
    return clean(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
  }

  if (mimeType?.startsWith("image/")) {
    return {
      ok: false,
      reason: "Reading a photograph would need OCR, which Walkup doesn't do yet.",
    };
  }

  return {
    ok: false,
    reason: "Walkup can't read inside this kind of file yet. It's stored and downloadable.",
  };
}
