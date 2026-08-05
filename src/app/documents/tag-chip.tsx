/**
 * A document's category, and how much to trust it.
 *
 * The distinction this screen turns on is not which category a document is in
 * — it is whether a person decided that or a machine guessed it. A guess reads
 * as provisional: dotted underline, a confidence dot, amber. A confirmed tag
 * reads as settled: solid, quiet. Someone scanning the list should be able to
 * see what still needs a human without reading a word.
 *
 * Categories themselves stay deliberately quiet. Sixteen hues for sixteen tags
 * would make the list a colour chart and leave nothing loud enough for the
 * provisional state to matter. Financial paperwork takes the informational
 * tone, everything else is neutral, and amber is reserved for "not sure yet".
 */

const FINANCIAL = new Set([
  "invoice",
  "receipt",
  "bank_statement",
  "financial_statement",
  "tax_form",
]);

export function TagChip({
  label,
  slug,
  provisional = false,
  confidence = null,
}: {
  label: string;
  slug: string | null;
  provisional?: boolean;
  confidence?: number | null;
}) {
  if (provisional) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-warning-line bg-warning-tint px-2 py-0.5 text-[11px] text-warning-text"
        title={
          confidence !== null
            ? `Walkup guessed this, ${Math.round(confidence * 100)}% sure. Nobody has confirmed it.`
            : "Walkup guessed this. Nobody has confirmed it."
        }
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-warning"
          style={confidence !== null ? { opacity: 0.35 + confidence * 0.65 } : undefined}
        />
        <span className="underline decoration-dotted underline-offset-2">{label}</span>
      </span>
    );
  }

  // Whole class strings, never interpolated fragments: Tailwind generates CSS
  // by scanning source for literal names, so `border-${tone}-line` would
  // compile to nothing and fail silently at runtime. Same reason the STATUS
  // map in components/ui.tsx stores complete strings.
  const tone =
    slug && FINANCIAL.has(slug)
      ? "border-info-line bg-info-tint text-info-text"
      : "border-neutral-line bg-neutral-tint text-neutral-text";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>{label}</span>
  );
}

/** Not yet filed. Says so plainly rather than rendering an empty gap. */
export function UnfiledChip() {
  return (
    <span className="rounded-full border border-line bg-fill px-2 py-0.5 text-[11px] text-mute">
      Unfiled
    </span>
  );
}
