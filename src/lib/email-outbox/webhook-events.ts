/**
 * A bounce message from a mail server often repeats the address it refused.
 * The send log is board-readable and outlives a redaction of the person, so
 * addresses are removed before the text is stored, and it is cut to 200
 * characters.
 */
export function scrubDetail(text: string): string {
  return String(text ?? "")
    .replace(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g, "[address]")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
