import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const OPERATING_CASH = "acc00000-0000-0000-0000-000000001000";
const RESERVE_CASH = "acc00000-0000-0000-0000-000000001010";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";
const RESERVE = "ffff0000-0000-0000-0000-000000000002";

describe("monthly_cash_activity transfer columns (0039)", () => {
  let db: PGlite;
  let f: Fixture;
  let txId: string;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);

    txId = await asUser(db, f.cyUser, async () => {
      await db.query(
        `insert into public.accounts (id, association_id, code, name, type, is_cash_account)
         values ($1::uuid, $2::uuid, '1010', 'Reserve Cash', 'asset', true)`,
        [RESERVE_CASH, f.damen],
      );
      const { rows: conn } = await db.query<{ store_bank_connection: string }>(
        `select public.store_bank_connection($1::uuid, 'BMO Harris', 'item-1', 'tok')`,
        [f.damen],
      );
      await db.query(
        `update public.bank_connections set cash_account_id = $2::uuid, fund_id = $3::uuid where id = $1::uuid`,
        [conn[0].store_bank_connection, OPERATING_CASH, OPERATING],
      );
      const { rows } = await db.query<{ id: string }>(
        `insert into public.bank_transactions
           (association_id, bank_connection_id, plaid_transaction_id, posted_on, amount, description,
            posting_kind, account_id)
         values ($1::uuid, $2::uuid, 'p-1', '2026-04-10', -300.00, 'TRANSFER TO RESERVE', 'transfer', $3::uuid)
         returning id`,
        [f.damen, conn[0].store_bank_connection, RESERVE_CASH],
      );
      return rows[0].id;
    });
  });

  async function april() {
    return asUser(db, f.cyUser, () =>
      db.query<{ fund_kind: string; inflow: string; outflow: string; transfer_inflow: string; transfer_outflow: string }>(
        `select fund_kind, inflow, outflow, transfer_inflow, transfer_outflow
           from public.monthly_cash_activity where month = '2026-04-01' order by fund_kind`,
      ),
    );
  }

  it("reports a posted transfer in the transfer columns on both sides", async () => {
    await asUser(db, f.cyUser, () => db.query(`select public.post_bank_transaction($1::uuid)`, [txId]));
    const { rows } = await april();
    const op = rows.find((r) => r.fund_kind === "operating")!;
    const res = rows.find((r) => r.fund_kind === "reserve")!;
    expect(op.outflow).toBe("300.00");
    expect(op.transfer_outflow).toBe("300.00");
    expect(res.inflow).toBe("300.00");
    expect(res.transfer_inflow).toBe("300.00");
    void RESERVE;
  });

  it("treats the reversal of a transfer as a transfer too", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(`select public.post_bank_transaction($1::uuid)`, [txId]);
      await db.query(`select public.unpost_bank_transaction($1::uuid)`, [txId]);
    });
    const { rows } = await april();
    for (const r of rows) {
      // Everything in April was the transfer and its undo — none of it is outside money.
      expect(r.inflow).toBe(r.transfer_inflow);
      expect(r.outflow).toBe(r.transfer_outflow);
    }
  });
});
