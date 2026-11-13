// How owners pay (the board's setup form). Pure: validation, masking, the memo line.

/** U.S. ABA routing number: nine digits and the 3-7-1 checksum. */
export function isValidRoutingNumber(raw: string): boolean {
  const s = raw.replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(s)) return false;
  const d = [...s].map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

/** "••••1234". Fewer than five digits are masked entirely. */
export function maskAccount(value: string): string {
  const v = value.trim();
  const tail = v.length > 4 ? v.slice(-4) : "";
  return `••••${tail}`;
}

export interface PaymentDetailsInput {
  payee: string | null;
  bank: string | null;
  routing: string | null;
  account: string | null;
  zelleEmail: string | null;
  zellePhone: string | null;
  mailing: string | null;
}

export type PaymentField =
  | "dues_payee_name"
  | "dues_routing_number"
  | "dues_account_number"
  | "dues_zelle_handle"
  | "dues_zelle_phone"
  | "form";

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/** A U.S. number: ten digits, with or without a leading 1. Returns the ten digits, or null. */
export function usPhoneDigits(s: string): string | null {
  const d = s.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return /^\d{10}$/.test(ten) ? ten : null;
}

/** "(312) 555-0142" */
export function formatUsPhone(s: string): string {
  const d = usPhoneDigits(s);
  return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s.trim();
}

/** What is wrong, and which field it belongs under, or null when the details can be saved. At least one way to pay is required. */
export function paymentDetailsProblem(i: PaymentDetailsInput): { field: PaymentField; message: string } | null {
  const has = (s: string | null) => Boolean(s?.trim());
  // The payee name is prefilled with the association name, so it alone does not start the bank section.
  const bankStarted = has(i.routing) || has(i.account);
  if (bankStarted) {
    if (!has(i.payee)) return { field: "dues_payee_name", message: "Add the payee name, or clear the bank transfer section." };
    if (!has(i.routing)) return { field: "dues_routing_number", message: "Add the routing number, or clear the bank transfer section." };
    if (!isValidRoutingNumber(i.routing!)) {
      return { field: "dues_routing_number", message: "This routing number doesn't look right. It should be 9 digits; check it against a check or your bank." };
    }
    if (!has(i.account)) return { field: "dues_account_number", message: "Add the account number, or clear the bank transfer section." };
  }
  if (has(i.zelleEmail) && !isValidEmail(i.zelleEmail!)) {
    return { field: "dues_zelle_handle", message: "This email doesn't look right. Check it for a typo." };
  }
  if (has(i.zellePhone) && !usPhoneDigits(i.zellePhone!)) {
    return { field: "dues_zelle_phone", message: "A Zelle phone number is 10 digits, like (312) 555-0142." };
  }
  if (!bankStarted && !has(i.zelleEmail) && !has(i.zellePhone) && !has(i.mailing)) {
    return { field: "form", message: "Add at least one way for owners to pay: bank transfer, Zelle, or a mailing address for checks." };
  }
  return null;
}

/** Every owner's instructions carry their own unit in the memo, so the deposit can be matched. */
export function memoInstruction(unitLabel: string): string {
  return `Put "${unitLabel}" in the memo.`;
}
