import type { PostingKind } from "@/app/bank-feed/actions";

export interface SuggestableAccount {
  id: string;
  name: string;
}

export interface Suggestion {
  kind: PostingKind;
  /** null when the kind is right but the target needs a human pick (transfer's counterparty, dues' unit). */
  accountId: string | null;
}

/**
 * A suggestion for the bulk-categorization review on the bank feed — never
 * written anywhere on its own, always shown to a board admin to confirm or
 * change before it touches posting_kind. Two layers: a small table of
 * patterns calibrated against real production transaction descriptions
 * (ComEd, West Bend — an insurance carrier Plaid itself mis-categorizes as
 * "Food and Drink" — Illinois Secretary of State, etc.), then a generic
 * word-overlap fallback against whatever expense accounts this association
 * actually has, so it still helps for accounts/vendors this table has
 * never seen.
 */
const EXPENSE_KEYWORDS: { pattern: RegExp; accountName: string }[] = [
  { pattern: /comed|electric|\belectr(ic|icity)\b/i, accountName: "Utilities" },
  { pattern: /water bill|\bwater\b/i, accountName: "Utilities" },
  { pattern: /gas company|\bnicor\b/i, accountName: "Utilities" },
  { pattern: /west bend|\binsuran/i, accountName: "Insurance" },
  { pattern: /home depot|lowe'?s|ace hardware/i, accountName: "Repairs & Maintenance" },
  { pattern: /landscap|snow removal|lawn/i, accountName: "Landscaping / Snow Removal" },
  { pattern: /janitorial|cleaning service/i, accountName: "Janitorial" },
  { pattern: /tax service|\battorney\b|law offices|\bcpa\b|accounting/i, accountName: "Professional Fees" },
  { pattern: /community assoc|management (co|company)/i, accountName: "Professional Fees" },
  { pattern: /secretary of state|illinois secretary/i, accountName: "State Filing Fees" },
  { pattern: /chargeback|return item|\bnsf\b|service charge|maintenance fee/i, accountName: "Bank & Merchant Fees" },
];

const TRANSFER_PATTERN = /\btransfer\b|webxfr|chasbk|\bxfer\b/i;
const DUES_PATTERN = /\bdeposit\b|\bzelle\b|\bach credit\b/i;

function findAccountByName(accounts: SuggestableAccount[], name: string): string | null {
  const lower = name.toLowerCase();
  return accounts.find((a) => a.name.toLowerCase() === lower)?.id ?? null;
}

/** Overlap between the description's words and an account's own name — the fallback when no keyword matches. */
function bestOverlapMatch(description: string, accounts: SuggestableAccount[]): string | null {
  const words = new Set(description.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  if (words.size === 0) return null;

  let best: { id: string; score: number } | null = null;
  for (const account of accounts) {
    const accountWords = account.name.toLowerCase().match(/[a-z]{3,}/g) ?? [];
    const score = accountWords.filter((w) => words.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: account.id, score };
  }
  return best?.id ?? null;
}

export function suggestCategorization(
  description: string,
  amount: number,
  expenseAccounts: SuggestableAccount[],
  incomeAccounts: SuggestableAccount[],
): Suggestion | null {
  // Transfer checked before sign-based logic — a transfer can move money
  // either direction and never belongs to an income/expense account.
  if (TRANSFER_PATTERN.test(description)) {
    return { kind: "transfer", accountId: null };
  }

  if (amount > 0) {
    if (DUES_PATTERN.test(description)) {
      return { kind: "dues", accountId: null };
    }
    const overlap = bestOverlapMatch(description, incomeAccounts);
    return overlap ? { kind: "income", accountId: overlap } : null;
  }

  if (amount < 0) {
    for (const { pattern, accountName } of EXPENSE_KEYWORDS) {
      if (pattern.test(description)) {
        const accountId = findAccountByName(expenseAccounts, accountName);
        if (accountId) return { kind: "expense", accountId };
      }
    }
    const overlap = bestOverlapMatch(description, expenseAccounts);
    return overlap ? { kind: "expense", accountId: overlap } : null;
  }

  return null;
}
