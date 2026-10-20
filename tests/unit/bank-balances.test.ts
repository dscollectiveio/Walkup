import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
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

import { BankAccountsSection, type ConnectionBalance } from "@/app/bank-feed/balances";

const balances: ConnectionBalance[] = [
  {
    connectionId: "c1",
    source: "last_sync",
    accounts: [
      { accountId: "acc-chk", name: "Plaid Checking", mask: "0000", type: "depository", currentCents: 11000 },
      { accountId: "acc-sav", name: "Plaid Saving", mask: "1111", type: "depository", currentCents: 21000 },
      { accountId: "acc-cc", name: "Plaid Credit Card", mask: "3333", type: "credit", currentCents: 41000 },
      { accountId: "acc-ira", name: "Plaid IRA", mask: "5555", type: "investment", currentCents: 32076 },
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
    expect(html).toContain("text-[22px]");
    expect(html).toContain("as of each bank");
  });

  it("shows one navy Show individual accounts button per bank, with no bank-level Sync now or Manage connection", async () => {
    const html = await render();
    expect(html).toContain("Show individual accounts (4)");
    expect(html).toContain("bg-ink");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain(">Sync now<"); // the footer sentence mentions it; no bank-level button does
    expect(html).not.toContain(">Manage connection<");
    expect(html).not.toContain("Plaid Checking"); // hidden until expanded
    expect(html).toContain("4 accounts");
  });

  it("gives every account its own Sync now and Manage connection links once expanded", async () => {
    const el = await BankAccountsSection({
      balancesPromise: Promise.resolve(balances),
      active,
      canEdit: true,
      cashAccounts: [],
    });
    // The expanded panel is passed to the client component; render it directly.
    const find = (node: unknown): ReactElement | null => {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) {
        for (const k of node) {
          const hit = find(k);
          if (hit) return hit;
        }
        return null;
      }
      const n = node as ReactElement<{ children?: unknown; accountsPanel?: unknown }>;
      if (n.props && "accountsPanel" in n.props) return n;
      return find(n.props?.children);
    };
    const card = find(el);
    expect(card).not.toBeNull();
    const panel = renderToStaticMarkup((card as ReactElement<{ accountsPanel: ReactElement }>).props.accountsPanel);
    expect(panel).toContain("Plaid Checking");
    expect((panel.match(/Sync now/g) ?? []).length).toBe(4); // one per account tile
  });

  it("a bank with no accounts to expand still has Sync now on its own line", async () => {
    const el = await BankAccountsSection({
      balancesPromise: Promise.resolve([{ connectionId: "c1", accounts: [], error: "Couldn't reach the bank." }]),
      active,
      canEdit: true,
      cashAccounts: [],
    });
    const html = renderToStaticMarkup(el);
    expect(html).toContain(">Sync now<");
    expect(html).toContain(">Manage connection<");
    expect(html).not.toContain("Show individual accounts");
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

  it("tells someone who can't reconnect that a board admin has to, and shows one Reconnect button at most", async () => {
    const el = await BankAccountsSection({
      balancesPromise: Promise.resolve(balances),
      active: [{ ...active[0], status: "error" }],
      canEdit: false,
      cashAccounts: [],
    });
    const html = renderToStaticMarkup(el);
    expect(html).toContain("Chase needs a board admin to sign in again before new transactions can come in.");
    expect(html).not.toContain("Reconnect Chase");

    const admin = await BankAccountsSection({
      balancesPromise: Promise.resolve([{ connectionId: "c1", accounts: [], needsReconnect: true }]),
      active,
      canEdit: true,
      cashAccounts: [],
    });
    expect((renderToStaticMarkup(admin).match(/Reconnect Chase/g) ?? []).length).toBe(1);
  });

  it("says when the page is checking the bank on its own, and that a reload shows the result", async () => {
    const el = await BankAccountsSection({
      balancesPromise: Promise.resolve(balances),
      active,
      canEdit: true,
      cashAccounts: [],
      checkingIds: ["c1"],
    });
    const html = renderToStaticMarkup(el);
    expect(html).toContain("Checking the bank for new transactions");
    expect(html).toContain("Reload in a minute");
  });
});
