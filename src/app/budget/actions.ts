"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { categorizeBankTransaction } from "@/app/bank-feed/actions";

export async function saveBudgetLine(_prev: unknown, formData: FormData) {
  const associationId = String(formData.get("association_id") ?? "");
  const fiscalYearId = String(formData.get("fiscal_year_id") ?? "");
  const accountId = String(formData.get("account_id") ?? "");
  const fundId = String(formData.get("fund_id") ?? "");
  const amount = Number(formData.get("amount") ?? "");

  if (!Number.isFinite(amount) || amount < 0) {
    return { error: "Enter a number of zero or more." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_budget_line", {
    p_association_id: associationId,
    p_fiscal_year_id: fiscalYearId,
    p_account_id: accountId,
    p_fund_id: fundId,
    p_amount: amount,
  });

  if (error) return { error: error.message };

  revalidatePath("/budget");
  return { ok: true };
}

/**
 * Applies last year's spending as this year's budget — only ever after the
 * board clicked a clearly labeled suggestion and confirmed it. Each line goes
 * through set_budget_line, the same board-gated path as typing it in.
 */
export async function applySuggestedBudget(input: {
  associationId: string;
  fiscalYearId: string;
  fundId: string;
  lines: { accountId: string; amount: number }[];
}) {
  const supabase = await createClient();
  for (const line of input.lines) {
    if (!Number.isFinite(line.amount) || line.amount < 0) continue;
    const { error } = await supabase.rpc("set_budget_line", {
      p_association_id: input.associationId,
      p_fiscal_year_id: input.fiscalYearId,
      p_account_id: line.accountId,
      p_fund_id: input.fundId,
      p_amount: line.amount,
    });
    if (error) return { error: error.message };
  }
  revalidatePath("/budget");
  revalidatePath("/");
  return { ok: true };
}

/**
 * One-interaction categorize from the Budget & spending transactions table:
 * pick an expense category, and the transaction is categorized and posted —
 * the same bank-feed path (and RLS) as categorizing on the bank feed itself.
 */
export async function categorizeAsExpense(transactionId: string, accountId: string) {
  const result = await categorizeBankTransaction({
    transactionId,
    kind: "expense",
    accountId,
    unitId: null,
    vendorId: null,
    saveRule: false,
    autoPostRule: false,
    postNow: true,
  });
  revalidatePath("/budget");
  return result;
}

const BILL_FREQUENCIES = ["monthly", "quarterly", "semiannual", "annual"] as const;

/** Tracks a bill the association already pays — Walkup never pays it. RLS: board. */
export async function addRecurringBill(_prev: unknown, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const accountId = String(formData.get("account_id") ?? "");
  const vendorId = String(formData.get("vendor_id") ?? "") || null;
  const frequency = String(formData.get("frequency") ?? "");
  const nextDueOn = String(formData.get("next_due_on") ?? "");
  const rawAmount = String(formData.get("typical_amount") ?? "").trim();
  const typicalAmount = rawAmount === "" ? null : Number(rawAmount);
  const autopay = formData.get("autopay_arranged") === "on";

  if (!name) return { error: "Give the bill a name, like “ComEd” or “Water.”" };
  if (!accountId) return { error: "Choose the category it's paid from." };
  if (!(BILL_FREQUENCIES as readonly string[]).includes(frequency)) return { error: "Choose how often it's due." };
  if (!nextDueOn) return { error: "Enter when it's next due." };
  if (typicalAmount !== null && (!Number.isFinite(typicalAmount) || typicalAmount < 0)) {
    return { error: "The usual amount must be a number of zero or more." };
  }

  const supabase = await createClient();
  const [{ data: associations }, { data: funds }] = await Promise.all([
    supabase.from("associations").select("id").limit(1),
    supabase.from("funds").select("id").eq("kind", "operating").limit(1),
  ]);
  const associationId = associations?.[0]?.id;
  const fundId = funds?.[0]?.id;
  if (!associationId || !fundId) return { error: "No association or operating fund is visible to you." };

  const { error } = await supabase.from("recurring_bills").insert({
    association_id: associationId,
    name,
    account_id: accountId,
    vendor_id: vendorId,
    fund_id: fundId,
    frequency,
    next_due_on: nextDueOn,
    due_day: Number(nextDueOn.slice(8, 10)),
    typical_amount: typicalAmount,
    autopay_arranged: autopay,
  });
  if (error) return { error: error.code === "42501" ? "Only a board member can add a bill." : error.message };

  revalidatePath("/budget");
  revalidatePath("/bills");
  revalidatePath("/");
  return { ok: true };
}

export async function addExpenseCategory(_prev: unknown, formData: FormData) {
  const associationId = String(formData.get("association_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!name) return { error: "Enter a category name." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_expense_account", {
    p_association_id: associationId,
    p_name: name,
  });

  if (error) return { error: error.message };

  revalidatePath("/budget");
  return { ok: true };
}
