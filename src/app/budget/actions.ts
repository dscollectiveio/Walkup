"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
