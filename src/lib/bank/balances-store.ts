import "server-only";

export interface StoredAccountInput {
  accountId: string;
  name: string;
  mask: string | null;
  type: string;
  currentCents: number | null;
}

/**
 * Keeps the bank's answer (0063 record_bank_balances). Best effort: a failure
 * is logged and the page still shows what the bank said.
 */
export async function storeBankBalances(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { code?: string; message?: string } | null }> },
  connectionId: string,
  accounts: StoredAccountInput[],
  source: "live" | "last_sync" | "sync",
): Promise<void> {
  const { error } = await supabase.rpc("record_bank_balances", {
    p_connection_id: connectionId,
    p_source: source,
    p_accounts: accounts.map((a) => ({
      account_id: a.accountId,
      name: a.name,
      mask: a.mask,
      type: a.type,
      current: a.currentCents === null ? null : a.currentCents / 100,
    })),
  });
  if (error) console.error("[bank] record_bank_balances failed", error.code ?? "-");
}
