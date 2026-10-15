/**
 * What an account means for the tax tests, in the words shown beside a
 * category (import-spec 6.1). Pure.
 */

export type TaxEffectAccount = {
  type: "asset" | "liability" | "equity" | "income" | "expense";
  is_exempt_function_income?: boolean | null;
  is_exempt_expenditure?: boolean | null;
};

export function taxEffect(a: TaxEffectAccount): string {
  if (a.type === "income") return a.is_exempt_function_income ? "Counts as exempt income" : "Counts as taxable income";
  if (a.type === "expense") return a.is_exempt_expenditure ? "Counts toward the 90% spending test" : "Does not count toward the spending test";
  if (a.type === "asset" && a.is_exempt_expenditure) return "Counts toward the 90% spending test";
  return "Not part of the tax tests";
}

/** The same, from the by_account summary that import_validate returns. */
export function taxEffectFromSummary(type: string, exempt: boolean | null): string {
  if (type === "income") return exempt ? "Counts as exempt income" : "Counts as taxable income";
  if (type === "expense" || type === "asset") return exempt ? "Counts toward the 90% spending test" : "Does not count toward the spending test";
  return "Not part of the tax tests";
}
