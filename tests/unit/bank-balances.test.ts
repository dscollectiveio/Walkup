import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/plaid", () => ({
  plaidClient: vi.fn(),
  describePlaidError: () => "",
  isProductNotEnabled: () => false,
}));
vi.mock("@/app/bank-feed/sync-button", () => ({ SyncButton: () => createElement("button", null, "Sync now") }));
vi.mock("@/app/bank-feed/disconnect-button", () => ({ DisconnectButton: () => createElement("button", null, "Disconnect") }));
vi.mock("@/app/bank-feed/connect-bank-button", () => ({ ConnectBankButton: () => createElement("button", null, "Connect") }));
vi.mock("@/app/bank-feed/ledger-account-select", () => ({ LedgerAccountSelect: () => createElement("span", null, "pick") }));

import { BankAccountsSection, BankBalanceInline, type ConnectionBalance } from "@/app/bank-feed/balances";

const balances: ConnectionBalance[] = [
  {
    connectionId: "c1",
    source: "last_sync",
    accounts: [
      { name: "Plaid Checking", mask: "0000", type: "depository", currentCents: 11000 },
      { name: "Plaid Saving", mask: "1111", type: "depository", currentCents: 21000 },
      { name: "Plaid Credit Card", mask: "3333", type: "credit", currentCents: 41000 },
      { name: "Plaid IRA", mask: "5555", type: "investment", currentCents: 32076 },
    ],
  },
];
const active = [{ id: "c1", institution_name: "Chase", last_synced_at: null, cash_account_id: "x" }];

async function render() {
  const el = await BankAccountsSection({
    balancesPromise: Promise.resolve(balances),
    active,
    canEdit: true,
    cashAccounts: [],
  });
  return renderToStaticMarkup(el);
}

describe("Bank accounts section", () => {
  it("leads with one large total of cash only (checking and savings, not the card or IRA)", async () => {
    const html = await render();
    expect(html).toContain("Total bank balance");
    expect(html).toContain("$320.00"); // 110 + 210
    expect(html).toContain("text-[48px]");
    expect(html).toContain("as of each bank");
  });

  it("puts Sync now, Show individual accounts and Manage connection in one matching row, accounts closed by default", async () => {
    const html = await render();
    expect(html).toContain("Sync now");
    expect(html).toContain("Show individual accounts (4)");
    expect(html).toContain("Manage connection");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Plaid Checking"); // hidden until expanded
    expect(html).toContain("4 accounts");
  });

  it("the inline strip figure matches the headline total", async () => {
    const el = await BankBalanceInline({ promise: Promise.resolve(balances) });
    expect(renderToStaticMarkup(el as never)).toContain("$320.00");
  });
});
