import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/plaid", () => ({
  plaidClient: vi.fn(),
  describePlaidError: () => "",
  isProductNotEnabled: () => false,
  isLoginRequired: () => false,
}));
vi.mock("@/app/bank-feed/reconnect-button", () => ({
  ReconnectButton: ({ institutionName }: { institutionName: string }) =>
    createElement("button", null, `Reconnect ${institutionName}`),
}));
vi.mock("@/app/bank-feed/sync-button", () => ({ SyncButton: () => createElement("button", null, "Sync now") }));
vi.mock("@/app/bank-feed/disconnect-button", () => ({ DisconnectButton: () => createElement("button", null, "Disconnect") }));
vi.mock("@/app/bank-feed/connect-bank-button", () => ({ ConnectBankButton: () => createElement("button", null, "Connect") }));
vi.mock("@/app/bank-feed/ledger-account-select", () => ({ LedgerAccountSelect: () => createElement("span", null, "pick") }));

import { BankAccountsSection, ReconnectNotice, type ConnectionBalance } from "@/app/bank-feed/balances";

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
const active = [{ id: "c1", institution_name: "Chase", status: "active", last_synced_at: null, cash_account_id: "x" }];

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

  it("puts In and Out for the period under the total, and says nothing when there is no flow to report", async () => {
    const withFlow = await BankAccountsSection({
      balancesPromise: Promise.resolve(balances),
      active,
      canEdit: true,
      cashAccounts: [],
      flow: { in: 2800, out: 4310.5, period: "this month" },
    });
    const html = renderToStaticMarkup(withFlow);
    expect(html).toContain("$2,800.00");
    expect(html).toContain("$4,310.50");
    expect(html).toMatch(/In .*\$2,800\.00.* · Out .*\$4,310\.50.* this month/);
    expect(await render()).not.toContain("· Out");
  });

  it("replaces the bank's buttons with one sign-in-again line and Reconnect when the bank wants a fresh sign-in", async () => {
    const el = await BankAccountsSection({
      balancesPromise: Promise.resolve([{ connectionId: "c1", accounts: [], needsReconnect: true }]),
      active,
      canEdit: true,
      cashAccounts: [],
    });
    const html = renderToStaticMarkup(el);
    expect(html).toContain("Chase needs you to sign in again before new transactions can come in.");
    expect(html).toContain("Reconnect Chase");
    expect(html).toContain("bg-warning-tint");
    expect(html).not.toContain("<button>Sync now</button>");
    expect(html).not.toContain("Manage connection");
  });

  it("the same line tops the Transactions card as a bad-status answer, and is absent when every bank is fine", async () => {
    const stale = await ReconnectNotice({
      balancesPromise: Promise.resolve([{ connectionId: "c1", accounts: [], needsReconnect: true }]),
      active,
      canEdit: true,
    });
    const html = renderToStaticMarkup(stale as never);
    expect(html).toContain("Chase needs you to sign in again before new transactions can come in.");
    expect(html).toContain("Reconnect Chase");
    expect(html).toContain("bg-bad-tint");

    const errored = await ReconnectNotice({
      balancesPromise: Promise.resolve(balances),
      active: [{ ...active[0], status: "error" }],
      canEdit: false,
    });
    const erroredHtml = renderToStaticMarkup(errored as never);
    expect(erroredHtml).toContain("sign in again");
    expect(erroredHtml).not.toContain("Reconnect Chase"); // owners can't reconnect

    const fine = await ReconnectNotice({ balancesPromise: Promise.resolve(balances), active, canEdit: true });
    expect(fine).toBeNull();
  });

  it("says when the page is checking the bank on its own", async () => {
    const el = await BankAccountsSection({
      balancesPromise: Promise.resolve(balances),
      active,
      canEdit: true,
      cashAccounts: [],
      checkingIds: ["c1"],
    });
    expect(renderToStaticMarkup(el)).toContain("Checking the bank for new transactions");
  });
});
