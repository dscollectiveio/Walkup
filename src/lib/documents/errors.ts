/**
 * A database or storage error as one sentence for the page (REVIEW-2 #25). The
 * raw message names tables, constraints and policies; it is logged by code
 * only. Messages the database raises on purpose for people (22023) pass through.
 */
export function documentError(error: { code?: string | null; message?: string | null }, context = "documents"): string {
  if (error.code === "42501") return "Only a board member can do that.";
  if (error.code === "22023" && error.message) return error.message;
  // The sharing guard (0074) says in words which kinds of document can go to every owner.
  if (error.code === "23514" && error.message?.startsWith("only governing documents")) return `Only ${error.message.slice("only ".length)}.`;
  console.error(`[${context}]`, error.code ?? "-");
  return "Something went wrong saving that. Try again.";
}
