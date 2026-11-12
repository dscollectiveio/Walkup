import { createElement } from "react";
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
vi.mock("@/lib/plaid/institution-logo", () => ({
  institutionLogo: async () => null,
}));
vi.mock("@/app/bank-feed/sync-button", () => ({
  SyncButton: () => createElement("button", null, "Sync now"),
}));
vi.mock("@/app/bank-feed/disconnect-button", () => ({
  DisconnectButton: () => createElement("button", null, "Disconnect"),
}));
vi.mock("@/app/bank-feed/connect-bank-button", () => ({
  ConnectBankButton: () => createElement("button", null, "Connect"),
}));
vi.mock("@/app/bank-feed/ledger-account-select", () => ({
  LedgerAccountSelect: () => createElement("span", null, "pick"),
}));

import {
  BankAccountsSection,
  type ConnectionBalance,
} from "@/app/bank-feed/balances";

const balances: ConnectionBalance[] = [
  {
    connectionId: "c1",
    source: "last_sync",
    accounts: [
      {
        accountId: "acc-chk",
        name: "Plaid Checking",
        mask: "0000",
        type: "depository",
        currentCents: 11000,
      },
      {
        accountId: "acc-sav",
        name: "Plaid Saving",
        mask: "1111",
        type: "depository",
        currentCents: 21000,
      },
      {
        accountId: "acc-cc",
        name: "Plaid Credit Card",
        mask: "3333",
        type: "credit",
        currentCents: 41000,
      },
      {
        accountId: "acc-ira",
        name: "Plaid IRA",
        mask: "5555",
        type: "investment",
        currentCents: 32076,
      },
    ],
  },
];
const active = [
  {
    id: "c1",
    institution_name: "Chase",
    status: "active",
    last_synced_at: null,
    cash_account_id: "x",
  },
];

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

  it("puts Sync now and the manage menu on the bank's own line, and only a quiet link hides a long account list", async () => {
    const html = await render();
    expect(html).toContain("Show accounts (4)");
    expect(html).not.toContain("Show individual accounts");
    expect(html).not.toContain("bg-ink px-3"); // no heavy button
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">Sync now<");
    expect(html).toContain('aria-label="Manage connection"');
    expect(html).not.toContain("open its accounts and use Sync now");
    expect(html).not.toContain("Plaid Checking"); // 4 accounts: collapsed until opened
    expect(html).toContain("4 accounts");
  });

  it("shows up to three accounts expanded with no toggle, and none of them repeats Sync now", async () => {
    const few: ConnectionBalance[] = [
      { ...balances[0], accounts: balances[0].accounts.slice(0, 2) },
    ];
    const html = renderToStaticMarkup(
      await BankAccountsSection({
        balancesPromise: Promise.resolve(few),
        active,
        canEdit: true,
        cashAccounts: [],
      }),
    );
    expect(html).toContain("Plaid Checking");
    expect(html).toContain("Plaid Saving");
    expect(html).not.toContain("Hide accounts");
    expect(html).not.toContain("Show accounts");
    expect((html.match(/Sync now/g) ?? []).length).toBe(1); // the bank's, not one per account
  });

  it("splits the total into day-to-day and reserve, with each account in its own fund", async () => {
    const fundChoices = [
      { id: "f-op", label: "Day-to-day (operating)", kind: "operating" },
      { id: "f-res", label: "Savings (Reserve Fund)", kind: "reserve" },
    ];
    const few: ConnectionBalance[] = [
      { ...balances[0], accounts: balances[0].accounts.slice(0, 2) },
    ];
    const html = renderToStaticMarkup(
      await BankAccountsSection({
        balancesPromise: Promise.resolve(few),
        active,
        canEdit: true,
        cashAccounts: [],
        fundChoices,
        accountFunds: { "c1:acc-sav": "f-res" },
      }),
    );
    expect(html).toMatch(
      /Day-to-day <span[^>]*>\$110\.00<\/span> ·\s*Reserve <span[^>]*>\$210\.00/,
    );
    expect(html).toContain("Used for:");
    expect(html).not.toContain("Counts as");
    expect(html).not.toContain("Same as the bank");
  });

  it("asks a treasurer to confirm a savings account as reserve instead of guessing silently", async () => {
    const fundChoices = [
      { id: "f-op", label: "Day-to-day (operating)", kind: "operating" },
      { id: "f-res", label: "Savings (Reserve Fund)", kind: "reserve" },
    ];
    const few: ConnectionBalance[] = [
      { ...balances[0], accounts: balances[0].accounts.slice(0, 2) },
    ];
    const render2 = async (accountFunds: Record<string, string>) =>
      renderToStaticMarkup(
        await BankAccountsSection({
          balancesPromise: Promise.resolve(few),
          active,
          canEdit: true,
          cashAccounts: [],
          fundChoices,
          accountFunds,
        }),
      );
    const undecided = await render2({});
    expect(undecided).toContain("Looks like a savings account");
    expect(
      (undecided.match(/Looks like a savings account/g) ?? []).length,
    ).toBe(1); // not the checking account
    expect(await render2({ "c1:acc-sav": "f-op" })).not.toContain(
      "Looks like a savings account",
    ); // already decided
  });

  it("a bank with no accounts to show still has Sync now and the manage menu on its own line", async () => {
    const el = await BankAccountsSection({
      balancesPromise: Promise.resolve([
        { connectionId: "c1", accounts: [], error: "Couldn't reach the bank." },
      ]),
      active,
      canEdit: true,
      cashAccounts: [],
    });
    const html = renderToStaticMarkup(el);
    expect(html).toContain(">Sync now<");
    expect(html).toContain('aria-label="Manage connection"');
    expect(html).not.toContain("Show accounts");
  });

  it("shows no In and Out figures in the header bar", async () => {
    const html = await render();
    expect(html).not.toContain("· Out");
    expect(html).not.toMatch(/\bIn <span/);
  });

  it("replaces the bank's buttons with one sign-in-again line and Reconnect when the bank wants a fresh sign-in", async () => {
    const el = await BankAccountsSection({
      balancesPromise: Promise.resolve([
        { connectionId: "c1", accounts: [], needsReconnect: true },
      ]),
      active,
      canEdit: true,
      cashAccounts: [],
    });
    const html = renderToStaticMarkup(el);
    expect(html).toContain(
      "Chase needs you to sign in again before new transactions can come in.",
    );
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
    expect(html).toContain(
      "Chase needs a board admin to sign in again before new transactions can come in.",
    );
    expect(html).not.toContain("Reconnect Chase");

    const admin = await BankAccountsSection({
      balancesPromise: Promise.resolve([
        { connectionId: "c1", accounts: [], needsReconnect: true },
      ]),
      active,
      canEdit: true,
      cashAccounts: [],
    });
    expect(
      (renderToStaticMarkup(admin).match(/Reconnect Chase/g) ?? []).length,
    ).toBe(1);
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
    expect(html).toContain("checking for new transactions");
    expect(html).toContain("reload in a minute");
  });
});
