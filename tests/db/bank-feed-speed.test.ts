import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";
import { normalizeDescription } from "@/lib/plaid/similar";

const CASH = "acc00000-0000-0000-0000-000000001000";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";
const UTILITIES = "acc00000-0000-0000-0000-00000000e001";
const INSURANCE = "acc00000-0000-0000-0000-00000000e002";

interface HistoryRow {
  payee_key: string;
  direction: number;
  posting_kind: string;
  account_id: string | null;
  matched_unit_id: string | null;
  count: number;
  amount_cents_total: string;
  last_seen: string | null;
}

describe("bank feed speed (0046)", () => {
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

  async function history(): Promise<HistoryRow[]> {
    const { rows } = await db.query<HistoryRow>(
      `select payee_key, direction, posting_kind, account_id, matched_unit_id, count,
              amount_cents_total::text, last_seen::text
         from public.bank_payee_history
        where association_id = $1::uuid
        order by payee_key, direction, posting_kind, account_id::text`,
      [f.damen],
    );
    return rows;
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
        `insert into public.accounts (id, association_id, code, name, type, is_exempt_expenditure) values
           ($1::uuid, $3::uuid, '5010', 'Utilities', 'expense', true),
           ($2::uuid, $3::uuid, '5020', 'Insurance', 'expense', true)`,
        [UTILITIES, INSURANCE, f.damen],
      );
      return rows[0].store_bank_connection;
    });
  });
  afterEach(async () => {
    await db.close();
  });

  it("bank_payee_key matches normalizeDescription exactly", async () => {
    const cases = [
      "COMED 8841",
      "ComEd *9120",
      "PPD ComEd PAYMENTS",
      "ZELLE J. SMITH #0042",
      "  Chase   QuickPay-- w/ Bo  ",
      "Café Déjà Vu 12",
      "1234",
      "",
      "TRANSFER TO CK CHASE BANK",
      "West Bend Mutual INS 2026-04",
    ];
    const { rows } = await db.query<{ input: string; key: string }>(
      `select d as input, public.bank_payee_key(d) as key from unnest($1::text[]) as d`,
      [cases],
    );
    for (const { input, key } of rows) {
      expect(key, `key for ${JSON.stringify(input)}`).toBe(normalizeDescription(input));
    }
  });

  it("keeps the tally right across categorize, re-categorize, un-categorize and retraction", async () => {
    const a = await insertTx(-46.5, "PPD ComEd PAYMENTS");
    const b = await insertTx(-51, "PPD ComEd PAYMENTS", { posted_on: "2026-05-10" });
    expect(await history()).toEqual([]);

    await asUser(db, f.cyUser, async () => {
      await db.query(
        `update public.bank_transactions set posting_kind = 'expense', account_id = $2::uuid where id = any($1::uuid[])`,
        [[a, b], UTILITIES],
      );
    });
    expect(await history()).toEqual([
      {
        payee_key: "ppd comed payments", direction: -1, posting_kind: "expense",
        account_id: UTILITIES, matched_unit_id: null, count: 2, amount_cents_total: "9750", last_seen: "2026-05-10",
      },
    ]);

    // Re-categorize one: the old choice loses it, the new choice gains it.
    await asUser(db, f.cyUser, () =>
      db.query(`update public.bank_transactions set account_id = $2::uuid where id = $1::uuid`, [b, INSURANCE]));
    expect(await history()).toMatchObject([
      { account_id: UTILITIES, count: 1, amount_cents_total: "4650" },
      { account_id: INSURANCE, count: 1, amount_cents_total: "5100" },
    ]);

    // Posting changes nothing about how it was filed.
    await asUser(db, f.cyUser, () => db.query(`select public.post_bank_transaction($1::uuid)`, [a]));
    expect(await history()).toMatchObject([
      { account_id: UTILITIES, count: 1 },
      { account_id: INSURANCE, count: 1 },
    ]);

    // Un-categorize: the row drops out, and an empty tally row is removed.
    await asUser(db, f.cyUser, () =>
      db.query(`update public.bank_transactions set posting_kind = null, account_id = null where id = $1::uuid`, [b]));
    expect(await history()).toMatchObject([{ account_id: UTILITIES, count: 1 }]);

    // The bank retracts the last one: nothing left.
    await asUser(db, f.cyUser, () =>
      db.query(`update public.bank_transactions set removed_at = now() where id = $1::uuid`, [a]));
    expect(await history()).toEqual([]);
  });

  it("keeps money in and money out apart, and files dues by unit", async () => {
    await insertTx(450, "ZELLE J SMITH", { posting_kind: "dues", matched_unit_id: f.unit1 });
    await insertTx(450, "ZELLE J SMITH 2", { posting_kind: "dues", matched_unit_id: f.unit1 });
    await insertTx(-30, "ZELLE J SMITH", { posting_kind: "excluded" });
    expect(await history()).toMatchObject([
      { payee_key: "zelle j smith", direction: -1, posting_kind: "excluded", account_id: null, matched_unit_id: null, count: 1 },
      { payee_key: "zelle j smith", direction: 1, posting_kind: "dues", matched_unit_id: f.unit1, count: 2, amount_cents_total: "90000" },
    ]);
  });

  it("is readable by the board and invisible to an owner, and writable by nobody", async () => {
    await insertTx(-51, "PPD ComEd PAYMENTS", { posting_kind: "expense", account_id: UTILITIES });

    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query(`select 1 from public.bank_payee_history`);
      expect(rows).toHaveLength(1);
      await expect(
        db.query(
          `insert into public.bank_payee_history (association_id, payee_key, direction, posting_kind, count)
           values ($1::uuid, 'made up', -1, 'expense', 99)`,
          [f.damen],
        ),
      ).rejects.toThrow(/row-level security/i);
      const { affectedRows } = await db.query(`update public.bank_payee_history set count = 99`);
      expect(affectedRows).toBe(0);
    });
    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query(`select 1 from public.bank_payee_history`);
      expect(rows).toHaveLength(0);
    });
  });

  it("post_bank_transactions posts what it can and reports the rest, per row", async () => {
    const a = await insertTx(-46, "PPD ComEd PAYMENTS", { posting_kind: "expense", account_id: UTILITIES });
    const pending = await insertTx(-20, "CARD PURCHASE", { posting_kind: "expense", account_id: UTILITIES, pending: true });
    const b = await insertTx(-51, "PPD ComEd PAYMENTS", { posting_kind: "expense", account_id: UTILITIES });
    const excluded = await insertTx(-5, "FEE REVERSAL", { posting_kind: "excluded" });

    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ id: string; ok: boolean; error: string | null }>(
        `select * from public.post_bank_transactions($1::uuid[])`,
        [[a, pending, b, excluded]],
      );
      expect(rows).toEqual([
        { id: a, ok: true, error: null },
        { id: pending, ok: false, error: expect.stringMatching(/pending/i) },
        { id: b, ok: true, error: null },
        { id: excluded, ok: true, error: null },
      ]);

      const { rows: posted } = await db.query<{ id: string }>(
        `select id from public.bank_transactions where journal_entry_id is not null order by posted_on, id`,
      );
      expect(posted.map((r) => r.id).sort()).toEqual([a, b].sort());
      const { rows: ex } = await db.query<{ excluded_at: string | null }>(
        `select excluded_at from public.bank_transactions where id = $1::uuid`, [excluded]);
      expect(ex[0].excluded_at).not.toBeNull();

      // Undo both in one call; the reversals land and the rows are free again.
      const { rows: undone } = await db.query<{ id: string; ok: boolean; error: string | null }>(
        `select * from public.unpost_bank_transactions($1::uuid[])`,
        [[a, b, pending]],
      );
      expect(undone).toEqual([
        { id: a, ok: true, error: null },
        { id: b, ok: true, error: null },
        { id: pending, ok: false, error: expect.stringMatching(/isn't in the books/i) },
      ]);
      const { rows: reversals } = await db.query(
        `select 1 from public.journal_entries where source = 'reversal' and association_id = $1::uuid`, [f.damen]);
      expect(reversals).toHaveLength(2);
    });

    // An owner gets a per-row refusal, not a posting.
    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query<{ ok: boolean; error: string }>(
        `select ok, error from public.post_bank_transactions($1::uuid[])`, [[a]]);
      expect(rows[0].ok).toBe(false);
      expect(rows[0].error).toMatch(/not authorized|not found/i);
    });
  });
});
