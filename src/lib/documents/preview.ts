/** What the Viewing section can show inline for a stored file, by its recorded type. */
export type PreviewKind = "pdf" | "image" | "text";

export function previewKind(mime: string | null | undefined): PreviewKind | null {
  const m = (mime ?? "").toLowerCase().split(";")[0].trim();
  if (m === "application/pdf") return "pdf";
  if (m === "image/png" || m === "image/jpeg") return "image";
  if (m === "text/plain" || m === "text/csv") return "text";
  return null;
}

/** A summary as bullets: one per sentence, longest-first lists left alone when it is already a list. */
export function summaryBullets(summary: string): string[] {
  const lines = summary
    .split(/\n+/)
    .map((l) => l.replace(/^\s*[-*•]\s+/, "").trim())
    .filter(Boolean);
  const parts = lines.length > 1 ? lines : summary.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [summary.trim()];
}
