/** First word of a full name, "there" when empty (the greeting on the owner home). */
export function firstNameOf(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first || "there";
}
