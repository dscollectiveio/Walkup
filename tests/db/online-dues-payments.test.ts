import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

// Online dues payments, Stripe Connect (0097, DECISIONS #57).
// Seed: Cy is board admin (and owns unit 3), Bo owns unit 2 and owes $750, Nia is the accountant.

const CASH = "acc00000-0000-0000-0000-000000001000";
const AR = "acc00000-0000-0000-0000-000000001200";
const FEES = "acc00000-0000-0000-0000-000000005060";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";
const ACCT = "acct_1TestDamen";

describe("online dues payments (0097)", () => {
  let db: PGlite;
  let f: Fixture;
  let connectionId: string;

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows;

  async function connectReady() {
    await asUser(db, f.cyUser, () => q(`select public.connect_payment_account($1::uuid, $2, false)`, [f.damen, ACCT]));
    await asService(db, () => q(`select public.connect_apply_account($1, true, true, true)`, [ACCT]));
  }

  async function startAsBo() {
    return asUser(db, f.boUser, async () => {
      const [row] = await q<{ payment_id: string; amount: string; stripe_account_id: string }>(
        `select * from public.start_online_dues_payment($1::uuid, $2::uuid)`, [f.damen, f.unit2]);
      return row;
    });
  }

  /** Bo pays: Checkout opens, the ACH starts, it settles with a $6 fee. */
  async function boPaysAndSettles() {
    const started = await startAsBo();
    await asUser(db, f.boUser, () =>
      q(`select public.attach_online_dues_checkout($1::uuid, 'cs_test_bo1')`, [started.payment_id]));
    await asService(db, async () => {
      await q(`select public.connect_apply_payment($1, 'cs_test_bo1', 'pi_bo1', 'processing')`, [ACCT]);
      await q(`select public.connect_apply_payment($1, null, 'pi_bo1', 'succeeded', 6.00)`, [ACCT]);
    });
    return started;
  }

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    connectionId = await asUser(db, f.cyUser, async () => {
      const [{ id }] = await q<{ id: string }>(
        `select public.store_bank_connection($1::uuid, 'BMO Harris', 'item-1', 'tok') as id`, [f.damen]);
      await q(`update public.bank_connections set cash_account_id = $2::uuid, fund_id = $3::uuid where id = $1::uuid`,
        [id, CASH, OPERATING]);
      await q(`insert into public.accounts (id, association_id, code, name, type, is_exempt_expenditure)
               values ($1::uuid, $2::uuid, '5060', 'Bank & Merchant Fees', 'expense', true)`, [FEES, f.damen]);
      return id;
    });
  });
  afterEach(async () => {
    await db.close();
  });

  describe("connecting", () => {
    it("only a board admin can connect or disconnect, and status goes off -> pending -> ready", async () => {
      await expect(asUser(db, f.boUser, () =>
        q(`select public.connect_payment_account($1::uuid, $2, false)`, [f.damen, ACCT]))).rejects.toThrow(/board administrator/);

      const status = () => asUser(db, f.boUser, async () =>
        (await q<{ s: string }>(`select public.online_dues_status($1::uuid) as s`, [f.damen]))[0].s);

      expect(await status()).toBe("off");
      await asUser(db, f.cyUser, () => q(`select public.connect_payment_account($1::uuid, $2, false)`, [f.damen, ACCT]));
      expect(await status()).toBe("pending");
      await asService(db, () => q(`select public.connect_apply_account($1, true, true, true)`, [ACCT]));
      expect(await status()).toBe("ready");

      await expect(asUser(db, f.boUser, () =>
        q(`select public.disconnect_payment_account($1::uuid)`, [f.damen]))).rejects.toThrow(/board administrator/);
      const [{ acct }] = await asUser(db, f.cyUser, () =>
        q<{ acct: string }>(`select public.disconnect_payment_account($1::uuid) as acct`, [f.damen]));
      expect(acct).toBe(ACCT);
      expect(await status()).toBe("off");
    });

    it("an owner never sees the Stripe account; the board and the accountant do", async () => {
      await connectReady();
      const owner = await asUser(db, f.boUser, () => q(`select * from public.association_payment_accounts`));
      expect(owner).toEqual([]);
      const board = await asUser(db, f.cyUser, () => q<{ stripe_account_id: string }>(`select stripe_account_id from public.association_payment_accounts`));
      expect(board.map((r) => r.stripe_account_id)).toEqual([ACCT]);
      const accountant = await asUser(db, f.niaUser, () => q(`select id from public.association_payment_accounts`));
      expect(accountant).toHaveLength(1);
    });

    it("authenticated users can't write the tables directly", async () => {
      await expect(asUser(db, f.cyUser, () =>
        q(`insert into public.association_payment_accounts (association_id, stripe_account_id, livemode) values ($1::uuid, $2, false)`,
          [f.damen, ACCT]))).rejects.toThrow();
    });

    it("the webhook functions are service role only", async () => {
      await expect(asUser(db, f.cyUser, () =>
        q(`select public.connect_apply_account($1, true, true, true)`, [ACCT]))).rejects.toThrow();
    });
  });

  describe("paying", () => {
    it("Pay charges the full open balance, computed by the database", async () => {
      await connectReady();
      const started = await startAsBo();
      expect(started.amount).toBe("750.00");
      expect(started.stripe_account_id).toBe(ACCT);
    });

    it("refuses before online payments are ready", async () => {
      await asUser(db, f.cyUser, () => q(`select public.connect_payment_account($1::uuid, $2, false)`, [f.damen, ACCT]));
      await expect(startAsBo()).rejects.toThrow(/aren't turned on/);
    });

    it("an owner can't pay for someone else's unit", async () => {
      await connectReady();
      await expect(asUser(db, f.adaUser, () =>
        q(`select * from public.start_online_dues_payment($1::uuid, $2::uuid)`, [f.damen, f.unit2]))).rejects.toThrow(/unit you own/);
    });

    it("one payment in flight per unit", async () => {
      await connectReady();
      await startAsBo();
      await expect(startAsBo()).rejects.toThrow(/already in progress/);
    });

    it("the Pay amount is for the unit's owner only", async () => {
      await connectReady();
      const amount = (user: string) => asUser(db, user, async () =>
        (await q<{ a: string | null }>(`select public.online_dues_amount($1::uuid, $2::uuid)::text as a`, [f.damen, f.unit2]))[0].a);
      expect(await amount(f.boUser)).toBe("750.00");
      expect(await amount(f.adaUser)).toBeNull();
    });

    it("an owner can find and cancel their own open Checkout, and nobody else's", async () => {
      await connectReady();
      const started = await startAsBo();
      await asUser(db, f.boUser, () =>
        q(`select public.attach_online_dues_checkout($1::uuid, 'cs_test_open')`, [started.payment_id]));

      const mine = await asUser(db, f.boUser, () =>
        q<{ payment_id: string; checkout_session_id: string; stripe_account_id: string }>(
          `select * from public.my_open_online_checkouts($1::uuid)`, [f.damen]));
      expect(mine).toEqual([{ payment_id: started.payment_id, unit_id: f.unit2, checkout_session_id: "cs_test_open", stripe_account_id: ACCT }]);
      expect(await asUser(db, f.adaUser, () => q(`select * from public.my_open_online_checkouts($1::uuid)`, [f.damen]))).toEqual([]);

      // Ada can't cancel Bo's; Bo can, and then pay again.
      await asUser(db, f.adaUser, () => q(`select public.cancel_online_dues_payment($1::uuid)`, [started.payment_id]));
      await expect(startAsBo()).rejects.toThrow(/already in progress/);
      await asUser(db, f.boUser, () => q(`select public.cancel_online_dues_payment($1::uuid)`, [started.payment_id]));
      await expect(startAsBo()).resolves.toBeTruthy();
    });

    it("a payment Stripe has started can't be canceled by the owner", async () => {
      await connectReady();
      const started = await boPaysAndSettles();
      await asUser(db, f.boUser, () => q(`select public.cancel_online_dues_payment($1::uuid)`, [started.payment_id]));
      const [row] = await q<{ status: string }>(`select status from public.online_dues_payments`);
      expect(row.status).toBe("succeeded");
    });

    it("a failed Stripe call frees the unit for another try", async () => {
      await connectReady();
      const started = await startAsBo();
      await asUser(db, f.boUser, () => q(`select public.cancel_online_dues_payment($1::uuid)`, [started.payment_id]));
      await expect(startAsBo()).resolves.toBeTruthy();
    });

    it("statuses only move forward, and a failed payment counts as not paid", async () => {
      await connectReady();
      await boPaysAndSettles();
      const back = await asService(db, () =>
        q<{ r: string }>(`select public.connect_apply_payment($1, null, 'pi_bo1', 'processing') as r`, [ACCT]));
      expect(back[0].r).toBe("stale");

      const failed = await asService(db, () =>
        q<{ r: string }>(`select public.connect_apply_payment($1, null, 'pi_bo1', 'failed', null, 'insufficient funds') as r`, [ACCT]));
      expect(failed[0].r).toBe("applied");
      const [row] = await asUser(db, f.boUser, () =>
        q<{ status: string; failure_reason: string }>(`select status, failure_reason from public.online_dues_payments`));
      expect(row).toEqual({ status: "failed", failure_reason: "insufficient funds" });
      // Nothing reached the ledger, so the $750 is still owed.
      const [{ balance }] = await q<{ balance: string }>(
        `select sum(balance)::text as balance from public.charge_balances where unit_id = $1::uuid`, [f.unit2]);
      expect(balance).toBe("750.00");
    });

    it("an event from a different Stripe account can't touch the payment", async () => {
      await connectReady();
      await boPaysAndSettles();
      const r = await asService(db, () =>
        q<{ r: string }>(`select public.connect_apply_payment('acct_1Someone', null, 'pi_bo1', 'failed') as r`));
      expect(r[0].r).toBe("ignored");
    });

    it("an owner sees only their own unit's payments", async () => {
      await connectReady();
      await boPaysAndSettles();
      expect(await asUser(db, f.boUser, () => q(`select id from public.online_dues_payments`))).toHaveLength(1);
      expect(await asUser(db, f.adaUser, () => q(`select id from public.online_dues_payments`))).toHaveLength(0);
    });
  });

  describe("posting the payout", () => {
    async function payoutAndDeposit(net: number, status = "paid") {
      const [{ id: payoutId }] = await asService(db, async () => {
        await q(`select public.connect_apply_payout($1, 'po_test1', $2, '2026-04-14', $3, array['pi_bo1'])`, [ACCT, net, status]);
        return q<{ id: string }>(`select id from public.stripe_payouts where stripe_payout_id = 'po_test1'`);
      });
      const [{ id: txId }] = await asUser(db, f.cyUser, () =>
        q<{ id: string }>(
          `insert into public.bank_transactions (association_id, bank_connection_id, plaid_transaction_id, posted_on, amount, description)
           values ($1::uuid, $2::uuid, 'plaid-po1', '2026-04-14', $3, 'STRIPE TRANSFER') returning id`,
          [f.damen, connectionId, net]));
      return { payoutId, txId };
    }

    it("one click posts gross dues, the fee and the net deposit, and clears the unit", async () => {
      await connectReady();
      await boPaysAndSettles();
      const { payoutId, txId } = await payoutAndDeposit(744);

      const [{ entry }] = await asUser(db, f.cyUser, () =>
        q<{ entry: string }>(`select public.post_stripe_payout($1::uuid, $2::uuid) as entry`, [txId, payoutId]));

      const lines = await q<{ account_id: string; unit_id: string | null; debit: string; credit: string }>(
        `select account_id, unit_id, debit::text, credit::text from public.journal_lines where journal_entry_id = $1::uuid order by debit desc, credit desc`,
        [entry]);
      expect(lines).toEqual([
        { account_id: CASH, unit_id: null, debit: "744.00", credit: "0.00" },
        { account_id: FEES, unit_id: null, debit: "6.00", credit: "0.00" },
        { account_id: AR, unit_id: f.unit2, debit: "0.00", credit: "750.00" },
      ]);

      const [{ balance }] = await q<{ balance: string }>(
        `select coalesce(sum(balance), 0)::text as balance from public.charge_balances where unit_id = $1::uuid and status in ('open','partial')`,
        [f.unit2]);
      expect(balance).toBe("0");

      const [pay] = await q<{ status: string; payment_id: string | null }>(`select status, payment_id from public.online_dues_payments`);
      expect(pay.status).toBe("deposited");
      expect(pay.payment_id).toBeTruthy();

      const [tx] = await q<{ journal_entry_id: string }>(`select journal_entry_id from public.bank_transactions where id = $1::uuid`, [txId]);
      expect(tx.journal_entry_id).toBe(entry);

      await expect(asUser(db, f.cyUser, () =>
        q(`select public.post_stripe_payout($1::uuid, $2::uuid)`, [txId, payoutId]))).rejects.toThrow(/already in the books/);
    });

    it("refuses a deposit that doesn't match, or a payout not yet paid", async () => {
      await connectReady();
      await boPaysAndSettles();
      const { payoutId, txId } = await payoutAndDeposit(744, "in_transit");
      await expect(asUser(db, f.cyUser, () =>
        q(`select public.post_stripe_payout($1::uuid, $2::uuid)`, [txId, payoutId]))).rejects.toThrow(/hasn't finished/);

      await asService(db, () => q(`select public.connect_apply_payout($1, 'po_test1', 740, '2026-04-14', 'paid', array['pi_bo1'])`, [ACCT]));
      await expect(asUser(db, f.cyUser, () =>
        q(`select public.post_stripe_payout($1::uuid, $2::uuid)`, [txId, payoutId]))).rejects.toThrow(/doesn't match/);
    });

    it("an owner can't post it", async () => {
      await connectReady();
      await boPaysAndSettles();
      const { payoutId, txId } = await payoutAndDeposit(744);
      await expect(asUser(db, f.boUser, () =>
        q(`select public.post_stripe_payout($1::uuid, $2::uuid)`, [txId, payoutId]))).rejects.toThrow(/not authorized/);
    });

    it("unposting puts the payment back to settled and the unit back to owing", async () => {
      await connectReady();
      await boPaysAndSettles();
      const { payoutId, txId } = await payoutAndDeposit(744);
      await asUser(db, f.cyUser, () => q(`select public.post_stripe_payout($1::uuid, $2::uuid)`, [txId, payoutId]));
      await asUser(db, f.cyUser, () => q(`select public.unpost_bank_transaction($1::uuid)`, [txId]));

      const [pay] = await q<{ status: string; payment_id: string | null }>(`select status, payment_id from public.online_dues_payments`);
      expect(pay).toEqual({ status: "succeeded", payment_id: null });
      const [po] = await q<{ journal_entry_id: string | null }>(`select journal_entry_id from public.stripe_payouts`);
      expect(po.journal_entry_id).toBeNull();
      const [{ balance }] = await q<{ balance: string }>(
        `select sum(balance)::text as balance from public.charge_balances where unit_id = $1::uuid`, [f.unit2]);
      expect(balance).toBe("750.00");
    });
  });
});
