// Postgres errors from the insurance RPCs and tables, mapped once
// (insurance-spec §8). Raw database messages are never shown, except the RPC
// messages written for people (42501 "Only …", 40001, P0002, 22023, and the
// "already saved" 23505 that carries the saved row's id). Pure.

export interface DbError {
  code?: string;
  message: string;
  details?: string | null;
}

export function friendlyDbError(e: DbError, fallback: string): { error: string; alreadySavedId?: string } {
  const message = String(e.message ?? "");
  switch (e.code) {
    case "42501":
      return { error: /^(Only|File this)/.test(message) ? message : "Only a board member can do that." };
    case "40001":
    case "P0002":
    case "22023":
      return { error: message || fallback };
    case "23503":
      return {
        error: message.startsWith("This policy has claims")
          ? message
          : "This is still linked to something else (a claim, a bill, or a document). Archive it instead.",
      };
    case "23505":
      if (/^This (policy|quote) was already saved/.test(message)) {
        return { error: message, ...(e.details ? { alreadySavedId: e.details } : {}) };
      }
      return { error: "That already exists." };
    default:
      return { error: fallback };
  }
}
