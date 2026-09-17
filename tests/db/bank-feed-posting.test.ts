import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const CASH = "acc00000-0000-0000-0000-000000001000";
const INCOME = "acc00000-0000-0000-0000-000000004000";
const UTILITIES = "acc00000-0000-0000-0000-00000000e001";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";

describe("bank feed posting (0035/0036)", () => {
  let db: PGlite;
  let f: Fixture;
  let connectionId: string;
  let seq = 0;

  async function insertTx(
    amount: number,
    description: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    seq += 1;
    const cols = ["association_id", "bank_connection_id", "plaid_transaction_id", "posted_on", "amount", "description"];
    const vals: unknown[] = [f.damen, connectionId, `plaid-${seq}`, extra.posted_on ?? "2026-04-10", amount, description];
    for (const [k, v] of Object.entries(extra)) {
      if (k === "posted_on") continue;
      cols.push(k);
      vals.push(v);
    }
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
    return asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.bank_transactions (${cols.join(", ")}) values (${placeholders}) returning id`,
        vals,
      );
      return rows[0].id;
    });
  }

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);

    connectionId = await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ store_bank_connection: string }>(
        `select public.store_bank_connection($1::uuid, 'BMO Harris', 'item-1', 'tok')`,
        [f.damen],
      );
      await db.query(
        `update public.bank_connections set cash_account_id = $2::uuid, fund_id = $3::uuid where id = $1::uuid`,
        [rows[0].store_bank_connection, CASH, OPERATING],
      );
      await db.query(
        `insert into public.accounts (id, association_id, code, name, type, is_exempt_expenditure)
         values ($1::uuid, $2::uuid, '5010', 'Utilities', 'expense', true)`,
        [UTILITIES, f.damen],
      );
      return rows[0].store_bank_connection;
    });
  });
  afterEach(async () => {
    await db.close();
  });

  it("posts a money-out row as an expense through record_expense (budget sees it)", async () => {
    const tx = await insertTx(-51, "PPD ComEd PAYMENTS", { posting_kind: "expense", account_id: UTILITIES });

    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ post_bank_transaction: string }>(
        `select public.post_bank_transaction($1::uuid)`, [tx]);
      const entry = rows[0].post_bank_transaction;
      expect(entry).toBeTruthy();

      const { rows: bt } = await db.query<{ journal_entry_id: string }>(
        `select journal_entry_id from public.bank_transactions where id = $1::uuid`, [tx]);
      expect(bt[0].journal_entry_id).toBe(entry);

      const { rows: exp } = await db.query<{ amount: string; account_id: string }>(
        `select amount, account_id from public.expenses where journal_entry_id = $1::uuid`, [entry]);
      expect(exp).toEqual([{ amount: "51.00", account_id: UTILITIES }]);

      const { rows: isl } = await db.query<{ account_type: string; amount: string }>(
        `select account_type, amount from public.income_statement_lines
          where association_id = $1::uuid and entry_date = '2026-04-10'`, [f.damen]);
      expect(isl).toEqual([{ account_type: "expense", amount: "51.00" }]);

      await expect(
        db.query(`select public.post_bank_transaction($1::uuid)`, [tx]),
      ).rejects.toThrow(/already in the books/i);
    });
  });

  it("posts dues with no open charge as cash-basis assessment income, tagged to the unit", async () => {
    const tx = await insertTx(4350, "DDA DEPOSIT", { posting_kind: "dues", matched_unit_id: f.unit3 });

    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ post_bank_transaction: string }>(
        `select public.post_bank_transaction($1::uuid)`, [tx]);
      const entry = rows[0].post_bank_transaction;

      const { rows: lines } = await db.query<{ account_id: string; debit: string; credit: string; unit_id: string }>(
        `select account_id, debit, credit, unit_id from public.journal_lines
          where journal_entry_id = $1::uuid order by debit desc`, [entry]);
      expect(lines).toEqual([
        { account_id: CASH, debit: "4350.00", credit: "0.00", unit_id: f.unit3 },
        { account_id: INCOME, debit: "0.00", credit: "4350.00", unit_id: f.unit3 },
      ]);

      const { rows: pay } = await db.query(
        `select id from public.payments where journal_entry_id = $1::uuid`, [entry]);
      expect(pay).toHaveLength(0);
    });
  });

  it("posts dues against an open charge through record_payment (unit balance clears)", async () => {
    const tx = await insertTx(500, "MOBILE DEPOSIT - CREDIT", { posting_kind: "dues", matched_unit_id: f.unit1 });

    await asUser(db, f.cyUser, async () => {
      await db.query(`select public.post_bank_transaction($1::uuid)`, [tx]);

      const { rows: alloc } = await db.query<{ charge_id: string; amount: string }>(
        `select pa.charge_id, pa.amount from public.payment_allocations pa
           join public.payments p on p.id = pa.payment_id
          where p.unit_id = $1::uuid`, [f.unit1]);
      expect(alloc).toEqual([{ charge_id: f.adaCharge, amount: "500.00" }]);

      const { rows: bal } = await db.query<{ balance_owed: string }>(
        `select balance_owed from public.unit_balances where unit_id = $1::uuid`, [f.unit1]);
      expect(bal[0].balance_owed).toBe("0.00");
    });
  });

  it("posts a transfer cash-to-cash and keeps it off the P&L", async () => {
    const chase = await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ id: string; code: string; is_cash_account: boolean }>(
        `select id, code, is_cash_account from public.create_cash_account($1::uuid, 'Chase Checking')`, [f.damen]);
      expect(rows[0].is_cash_account).toBe(true);
      expect(rows[0].code).toBe("1010");
      return rows[0].id;
    });
    const tx = await insertTx(-1519, "TRANSFER TO CK CHASE BANK", { posting_kind: "transfer", account_id: chase });

    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ post_bank_transaction: string }>(
        `select public.post_bank_transaction($1::uuid)`, [tx]);
      const { rows: lines } = await db.query<{ account_id: string; debit: string; credit: string }>(
        `select account_id, debit, credit from public.journal_lines
          where journal_entry_id = $1::uuid order by debit desc`, [rows[0].post_bank_transaction]);
      expect(lines).toEqual([
        { account_id: chase, debit: "1519.00", credit: "0.00" },
        { account_id: CASH, debit: "0.00", credit: "1519.00" },
      ]);
      const { rows: isl } = await db.query(
        `select 1 from public.income_statement_lines where association_id = $1::uuid and entry_date = '2026-04-10'`,
        [f.damen]);
      expect(isl).toHaveLength(0);
    });
  });

  it("unposts by reversal, drops the subsidiary row, and allows a corrected re-post", async () => {
    const tx = await insertTx(-51, "PPD ComEd PAYMENTS", { posting_kind: "expense", account_id: UTILITIES });

    await asUser(db, f.cyUser, async () => {
      const { rows: first } = await db.query<{ post_bank_transaction: string }>(
        `select public.post_bank_transaction($1::uuid)`, [tx]);
      const original = first[0].post_bank_transaction;

      const { rows: rev } = await db.query<{ unpost_bank_transaction: string }>(
        `select public.unpost_bank_transaction($1::uuid)`, [tx]);
      const { rows: reversal } = await db.query<{ source: string; reverses_entry_id: string; is_posted: boolean }>(
        `select source, reverses_entry_id, is_posted from public.journal_entries where id = $1::uuid`,
        [rev[0].unpost_bank_transaction]);
      expect(reversal[0]).toEqual({ source: "reversal", reverses_entry_id: original, is_posted: true });

      const { rows: exp } = await db.query(`select 1 from public.expenses where journal_entry_id = $1::uuid`, [original]);
      expect(exp).toHaveLength(0);

      const { rows: net } = await db.query<{ net: string }>(
        `select coalesce(sum(amount), 0)::numeric(14,2) as net from public.income_statement_lines
          where association_id = $1::uuid and entry_date = '2026-04-10'`, [f.damen]);
      expect(net[0].net).toBe("0.00");

      await db.query(`update public.bank_transactions set posting_kind = 'excluded', account_id = null where id = $1::uuid`, [tx]);
      const { rows: again } = await db.query<{ post_bank_transaction: string | null }>(
        `select public.post_bank_transaction($1::uuid)`, [tx]);
      expect(again[0].post_bank_transaction).toBeNull();
      const { rows: excluded } = await db.query<{ excluded_at: string | null }>(
        `select excluded_at from public.bank_transactions where id = $1::uuid`, [tx]);
      expect(excluded[0].excluded_at).not.toBeNull();
    });
  });

  it("creates the missing fiscal year for old history instead of failing", async () => {
    const tx = await insertTx(-51, "PPD ComEd PAYMENTS", {
      posting_kind: "expense", account_id: UTILITIES, posted_on: "2025-03-14",
    });
    await asUser(db, f.cyUser, async () => {
      await db.query(`select public.post_bank_transaction($1::uuid)`, [tx]);
      const { rows } = await db.query<{ label: string; starts_on: string; ends_on: string }>(
        `select label, starts_on::text, ends_on::text from public.fiscal_years
          where association_id = $1::uuid and label = '2025'`, [f.damen]);
      expect(rows).toEqual([{ label: "2025", starts_on: "2025-01-01", ends_on: "2025-12-31" }]);
    });
  });

  it("refuses pending rows, uncategorized rows, and non-admin callers", async () => {
    const pending = await insertTx(-20, "CARD PURCHASE", { posting_kind: "expense", account_id: UTILITIES, pending: true });
    const uncategorized = await insertTx(-20, "MYSTERY");
    const ready = await insertTx(-20, "PPD ComEd PAYMENTS", { posting_kind: "expense", account_id: UTILITIES });

    await asUser(db, f.cyUser, async () => {
      await expect(db.query(`select public.post_bank_transaction($1::uuid)`, [pending]))
        .rejects.toThrow(/pending/i);
      await expect(db.query(`select public.post_bank_transaction($1::uuid)`, [uncategorized]))
        .rejects.toThrow(/categorize/i);
    });
    await asUser(db, f.adaUser, async () => {
      await expect(db.query(`select public.post_bank_transaction($1::uuid)`, [ready]))
        .rejects.toThrow(/not authorized|not found/i);
    });
  });

  it("rejects a half-categorized row at the schema", async () => {
    await asUser(db, f.cyUser, async () => {
      await expect(
        db.query(
          `insert into public.bank_transactions
             (association_id, bank_connection_id, plaid_transaction_id, posted_on, amount, description, posting_kind)
           values ($1::uuid, $2::uuid, 'plaid-bad', '2026-04-10', -5, 'x', 'expense')`,
          [f.damen, connectionId],
        ),
      ).rejects.toThrow(/categorization_complete/);
    });
  });

  it("keeps rules board_admin-only and readable by the accountant tier", async () => {
    await asUser(db, f.adaUser, async () => {
      await expect(
        db.query(
          `insert into public.bank_categorization_rules (association_id, pattern, posting_kind, account_id)
           values ($1::uuid, 'ComEd', 'expense', $2::uuid)`,
          [f.damen, UTILITIES],
        ),
      ).rejects.toThrow();
    });
    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.bank_categorization_rules (association_id, pattern, posting_kind, account_id, auto_post)
         values ($1::uuid, 'ComEd', 'expense', $2::uuid, true) returning id`,
        [f.damen, UTILITIES],
      );
      expect(rows).toHaveLength(1);
    });
  });
});
