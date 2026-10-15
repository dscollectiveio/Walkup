// The board contact owners see on their home page and replies go to
// (owner-portal-spec 6.9). Pure, so a server action and a test share it.

const CONTACT_EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

/** Name 120, email 254 and the database's pattern, phone 40. Returns a sentence, or null when it is fine. */
export function validateBoardContact(c: { name: string | null; email: string | null; phone: string | null }): string | null {
  if (c.name && c.name.length > 120) return "The board contact's name must be 120 characters or fewer.";
  if (c.email && (c.email.length > 254 || !CONTACT_EMAIL.test(c.email))) {
    return "Enter a real email address for the board contact, like board@example.com.";
  }
  if (c.phone && c.phone.length > 40) return "The board contact's phone number must be 40 characters or fewer.";
  return null;
}
