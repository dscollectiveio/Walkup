/**
 * Formatting shared by the hub's server and client components.
 *
 * Deliberately neither "use client" nor "server-only": both sides render
 * document metadata, and a pure formatter living in a client module becomes a
 * client *reference* rather than a function, so calling it from a server
 * component fails at runtime with nothing for the type checker to catch.
 */

export function readableSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const SOURCE_LABEL: Record<string, string> = {
  email: "arrived by email",
  scan: "scanned",
  import: "imported",
  request: "uploaded on request",
};

/** Plain language, never the raw enum. */
export function visibilitySentence(visibility: string, unitLabel: string | null): string {
  if (unitLabel) {
    return `Visible to ${unitLabel}'s owner and the board. No other owner can see it.`;
  }
  return visibility === "all_owners"
    ? "Visible to every owner in the building."
    : "Visible to the board and the accountant only.";
}
