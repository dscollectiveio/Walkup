import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { existsSync } from "node:fs";
import path from "node:path";
import { applyMigrations, asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";
import { PREMIUM_ADVANCE_CASES } from "../fixtures/premium-cases";

/**
 * Migration 0052 (insurance-spec §5, tests §13.1): the shared coverage
 * columns, provenance for quotes, document reads limited to insurance files,
 * the transactional and idempotent save RPCs, premium bills, the lifecycle
 * RPCs, the owner summary and owner requests, RLS on every new table, the
 * same-association guards, and the backfills.
 */

type PgError = { code?: string; detail?: string; message: string };

async function pgError(p: Promise<unknown>): Promise<PgError> {
  try {
    await p;
  } catch (e) {
    const x = e as PgError;
    return { code: x.code, detail: x.detail, message: x.message };
  }
  throw new Error("expected the statement to fail");
}

const HASH = "a".repeat(64);
const EXPENSE_CODE = { damen: "5100", hoyne: "5100" } as const;

/** The 89 FIELD_DEFS columns of insurance-spec §6.2 (policy side). */
const SPEC_FIELD_COLUMNS: { column: string; quoteColumn: string | null }[] = [
  ["coverage", "coverage"], ["carrier_name", "carrier_name"], ["policy_number", "quote_number"],
  ["named_insured", "named_insured"], ["insured_address", null], ["effective_from", "covers_from"],
  ["effective_to", "covers_to"], ["annual_premium", "annual_premium"], ["taxes_and_fees", "taxes_and_fees"],
  ["payment_schedule", "payment_schedule"], ["claims_phone", "claims_phone"], ["agency_name", "agency_name"],
  ["broker_name", "broker_name"], ["agent_phone", "agent_phone"], ["broker_email", "broker_email"],
  ...[
    "building_limit", "business_personal_property_limit", "loss_of_income_limit", "valuation",
    "extended_replacement_percent", "coinsurance_percent", "agreed_value", "cause_of_loss_form", "coverage_form",
    "ordinance_or_law", "ordinance_law_a_included", "ordinance_law_b_limit", "ordinance_law_c_limit",
    "ordinance_law_bc_limit", "water_backup_limit", "equipment_breakdown_included", "flood_covered",
    "earthquake_covered", "loss_assessment_limit", "waiver_of_subrogation", "property_deductible",
    "water_damage_deductible", "wind_hail_deductible", "wind_hail_deductible_percent", "per_unit_deductible",
    "liability_per_occurrence", "liability_aggregate", "products_completed_aggregate",
    "personal_advertising_injury_limit", "medical_payments_limit", "damage_to_premises_rented_limit",
    "hired_non_owned_auto", "unit_owners_additional_insureds", "manager_additional_insured", "do_limit",
    "do_retention", "do_claims_made", "do_retro_date", "do_full_prior_acts", "do_covers_non_monetary",
    "do_covers_breach_of_contract", "do_covers_insurance_decisions", "do_includes_managing_agent",
    "do_includes_past_future_board", "crime_limit", "crime_deductible", "crime_includes_manager",
    "crime_social_engineering_limit", "crime_computer_fraud_limit", "crime_funds_transfer_limit",
    "umbrella_limit", "umbrella_retention", "umbrella_includes_do", "flood_building_limit",
    "flood_contents_limit", "flood_deductible", "flood_program", "flood_zone_rated", "earthquake_limit",
    "earthquake_deductible_percent", "earthquake_deductible", "equipment_breakdown_limit",
    "equipment_breakdown_deductible", "wc_el_each_accident", "wc_el_disease_each_employee",
    "wc_el_disease_policy_limit", "wc_covers_volunteers", "cyber_limit", "cyber_retention", "epli_limit",
    "epli_retention", "epli_third_party", "coverage_limit", "deductible",
  ].map((c) => [c, c] as [string, string]),
].map(([column, quoteColumn]) => ({ column: column as string, quoteColumn }));

/** Editable columns that are not FIELD_DEFS (§6.2: lists, sections, reminder, notes, agent link). */
const POLICY_EXTRA = ["included_sections", "endorsements", "exclusions", "premium_breakdown", "renewal_reminder_days", "notes", "agent_contact_id"];
/** The quote's own non-field columns (§5 part 17: the lists and notes, plus the quote's request and dates). */
const QUOTE_EXTRA = ["included_sections", "endorsements", "exclusions", "premium_breakdown", "notes", "quoted_on", "valid_until", "contact_id", "quote_request_id"];

const policySet = (defs: { column: string }[]) => [...new Set([...defs.map((d) => d.column), ...POLICY_EXTRA])].sort();
const quoteSet = (defs: { quoteColumn: string | null }[]) =>
  [...new Set([...defs.flatMap((d) => (d.quoteColumn ? [d.quoteColumn] : [])), ...QUOTE_EXTRA])].sort();

const LIB = path.resolve(import.meta.dirname, "../../src/lib/insurance");
const FIELDS_MODULE = path.join(LIB, "fields.ts");
const PREMIUM_MODULE = path.join(LIB, "premium.ts");

const DEFINER_FUNCTIONS = [
  "insurance_assert_same_association", "tg_insurance_v2_same_association", "tg_insurance_messages_lock",
  "insurance_prune_field_sources", "owner_insurance_summary", "request_insurance_proof",
  "my_insurance_proof_requests", "update_insurance_building_basics",
];

const NEW_TABLES = [
  "insurance_contacts", "insurance_messages", "insurance_document_reads", "insurance_building_facts",
  "insurance_finding_dismissals", "insurance_owner_summaries", "insurance_market_research", "insurance_owner_requests",
];

/**
 * freshDb() replays every migration (about a second). This suite has over a
 * hundred tests, so it replays them once and starts each test from a copy of
 * that data directory instead. Same schema, same roles, nothing seeded.
 */
let template: File | Blob | undefined;
async function templateDb(): Promise<PGlite> {
  if (!template) {
    const db = await freshDb();
    template = await db.dumpDataDir("none");
    await db.close();
  }
  return PGlite.create({ loadDataDir: template, extensions: { btree_gist } });
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe("insurance v2 (0052)", () => {
  let db: PGlite;
  let f: Fixture;
  let policyId: string;

  // ---------------------------------------------------------------- helpers

  const q = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
    user === null ? db.query<T>(sql, params) : asUser(db, user, () => db.query<T>(sql, params));

  const one = async <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
    (await q<T>(user, sql, params)).rows[0];

  const count = async (sql: string, params: unknown[] = []) =>
    (await one<{ n: number }>(null, `select count(*)::int as n from (${sql}) x`, params)).n;

  /** Zara becomes a board_admin of Hoyne: cross-association tests use a real board member elsewhere. */
  const zaraBoard = async () => {
    await db.query(
      `insert into public.role_grants (association_id, person_id, role, granted_on) values ($1::uuid, $2::uuid, 'board_admin', '2024-01-01')`,
      [f.hoyne, f.zaraPerson],
    );
    return f.zaraUser;
  };

  /** Bo becomes a board_member (not admin) of Damen; the fixtures have none. */
  const boBoard = async () => {
    await db.query(
      `insert into public.role_grants (association_id, person_id, role, granted_on) values ($1::uuid, $2::uuid, 'board_member', '2024-01-01')`,
      [f.damen, f.boPerson],
    );
    return f.boUser;
  };

  let docCounter = 0;
  const doc = async (assoc: string, slug: string | null) => {
    const r = await one<{ id: string }>(
      null,
      `insert into public.documents (association_id, storage_path, filename, mime_type, byte_size, category_id)
       values ($1::uuid, $2, 'declarations.pdf', 'application/pdf', 1000,
               (select id from public.document_categories where association_id = $1::uuid and slug = $3))
       returning id`,
      [assoc, `${assoc}/${1_760_000_000_000 + ++docCounter}-abc123-declarations.pdf`, slug],
    );
    return r.id;
  };
  const insuranceDoc = (assoc: string) => doc(assoc, "insurance");
  const taxDoc = (assoc: string) => doc(assoc, "tax_form");

  const expenseAccount = async (assoc: string, code = EXPENSE_CODE.damen) =>
    (
      await one<{ id: string }>(
        null,
        `insert into public.accounts (association_id, code, name, type, is_exempt_expenditure)
         values ($1::uuid, $2, 'Insurance', 'expense', false) returning id`,
        [assoc, code],
      )
    ).id;

  const hoyneFund = async () =>
    (
      await one<{ id: string }>(
        null,
        `insert into public.funds (association_id, name, kind) values ($1::uuid, 'Operating', 'operating') returning id`,
        [f.hoyne],
      )
    ).id;

  const policyValues = (over: Record<string, unknown> = {}) => ({
    coverage: "property",
    carrier_name: "West Bend",
    effective_from: "2026-06-01",
    effective_to: "2027-06-01",
    annual_premium: "3766.00",
    building_limit: "2400000.00",
    ...over,
  });

  const savePolicy = async (
    user: string,
    values: Record<string, unknown>,
    opts: { assoc?: string; policyId?: string | null; sources?: unknown[]; options?: Record<string, unknown> } = {},
  ) =>
    (
      await one<{ id: string }>(
        user,
        `select public.save_insurance_policy($1::uuid, $2::uuid, $3::jsonb, $4::jsonb, $5::jsonb) as id`,
        [
          opts.assoc ?? f.damen,
          opts.policyId ?? null,
          JSON.stringify(values),
          JSON.stringify(opts.sources ?? []),
          JSON.stringify(opts.options ?? {}),
        ],
      )
    ).id;

  const quoteValues = (over: Record<string, unknown> = {}) => ({
    coverage: "property",
    carrier_name: "Acuity",
    quoted_on: "2026-05-01",
    annual_premium: "3500.00",
    building_limit: "2400000.00",
    ...over,
  });

  const saveQuote = async (
    user: string,
    values: Record<string, unknown>,
    opts: { assoc?: string; quoteId?: string | null; sources?: unknown[]; options?: Record<string, unknown> } = {},
  ) =>
    (
      await one<{ id: string }>(
        user,
        `select public.save_insurance_quote($1::uuid, $2::uuid, $3::jsonb, $4::jsonb, $5::jsonb) as id`,
        [
          opts.assoc ?? f.damen,
          opts.quoteId ?? null,
          JSON.stringify(values),
          JSON.stringify(opts.sources ?? []),
          JSON.stringify(opts.options ?? {}),
        ],
      )
    ).id;

  const contact = async (assoc: string, name = "Lakeside Agency", user: string | null = null) =>
    (
      await one<{ id: string }>(
        user,
        `insert into public.insurance_contacts (association_id, name, email) values ($1::uuid, $2, 'agent@lakeside.test') returning id`,
        [assoc, name],
      )
    ).id;

  const READ_RESULT = {
    policies: [
      {
        fields: [
          {
            name: "building_limit",
            candidates: [{ value: "$2,400,000", page: 2, snippet: "Building $2,400,000" }],
            confidence: 0.9,
          },
        ],
      },
      { fields: [] },
    ],
  };

  /** A finished read of a fresh insurance document, written by Cy. */
  const doneRead = async (assoc: string = f.damen, user: string = f.cyUser, mode: "policy" | "quote" = "policy") => {
    const documentId = await insuranceDoc(assoc);
    const r = await one<{ id: string }>(
      user,
      `insert into public.insurance_document_reads (association_id, document_id, mode, state, result)
       values ($1::uuid, $2::uuid, $3, 'done', $4::jsonb) returning id`,
      [assoc, documentId, mode, JSON.stringify(READ_RESULT)],
    );
    return { readId: r.id, documentId };
  };

  const queuedRead = async (user: string = f.cyUser, assoc: string = f.damen) => {
    const documentId = await insuranceDoc(assoc);
    return (
      await one<{ id: string }>(
        user,
        `insert into public.insurance_document_reads (association_id, document_id, mode) values ($1::uuid, $2::uuid, 'policy') returning id`,
        [assoc, documentId],
      )
    ).id;
  };

  const claimRead = async (user: string, readId: string) =>
    (await q<{ id: string; attempts: number; state: string }>(user, `select * from public.claim_insurance_read($1::uuid)`, [readId])).rows;

  const createRequests = (user: string, contacts: string[], messages?: unknown[], assoc: string = f.damen) =>
    q<{ request_id: string; message_id: string }>(
      user,
      `select * from public.create_insurance_quote_requests($1::uuid, $2::jsonb, $3::jsonb)`,
      [
        assoc,
        JSON.stringify(contacts.map((c) => ({ contact_id: c, coverages: ["property"], payload_json: { units: 3 } }))),
        JSON.stringify(
          messages ??
            contacts.map(() => ({ subject: "Quote request", body: "Please quote.", to_email: "agent@lakeside.test", drafted_by: "template", facts_json: {} })),
        ),
      ],
    );

  const markSent = (user: string, messageId: string) =>
    q(user, `select public.mark_insurance_message_sent($1::uuid)`, [messageId]);

  const track = (user: string, policy: string, account: string | null, frequency: string, amount: string, nextDue: string | null) =>
    one<{ id: string }>(
      user,
      `select public.track_insurance_premium($1::uuid, $2::uuid, $3::public.bill_frequency, $4::numeric, $5::date) as id`,
      [policy, account, frequency, amount, nextDue],
    );

  const advance = async (user: string, billId: string, paid: string) =>
    (
      await one<{ d: string | null }>(
        user,
        `select public.insurance_premium_bill_advance($1::uuid, $2::date)::text as d`,
        [billId, paid],
      )
    ).d;

  const policyRow = (id: string) =>
    one<{
      replaced_by_policy_id: string | null;
      archived_at: string | null;
      accepted_quote_id: string | null;
      agent_contact_id: string | null;
      replaced_at: string | null;
    }>(null, `select * from public.insurance_policies where id = $1::uuid`, [id]);

  const activeBills = (policy: string) =>
    q<{ id: string; account_id: string; fund_id: string; typical_amount: string; next_due_on: string | null }>(
      null,
      `select id, account_id, fund_id, typical_amount::text, next_due_on::text from public.recurring_bills
        where insurance_policy_id = $1::uuid and is_active`,
      [policy],
    ).then((r) => r.rows);

  beforeEach(async () => {
    db = await templateDb();
    f = await seed(db);
    policyId = await savePolicy(f.cyUser, policyValues());
  });

  afterEach(async () => {
    await db.close();
  });

  // ------------------------------------------------------- migration, lint

  describe("migration and lint", () => {
    it("migration applies; new enum values usable after commit", async () => {
      const r = await q(
        f.cyUser,
        `insert into public.insurance_policies (association_id, coverage, carrier_name, effective_from, effective_to, annual_premium)
         values ($1::uuid, 'fidelity_crime', 'Great American', '2026-01-01', '2027-01-01', 800.00)`,
        [f.damen],
      );
      expect(r.affectedRows).toBe(1);
      const id = await savePolicy(f.cyUser, policyValues({ coverage: "employment_practices", carrier_name: "Hiscox" }));
      expect((await one<{ c: string }>(null, `select coverage::text as c from public.insurance_policies where id = $1::uuid`, [id])).c).toBe(
        "employment_practices",
      );
    });

    it("fields-match-sql: editable columns equal the §6.2 field table plus the extra columns", async () => {
      expect(SPEC_FIELD_COLUMNS).toHaveLength(89);
      const p = await one<{ c: string[] }>(null, `select public.insurance_policy_editable_columns() as c`);
      const qc = await one<{ c: string[] }>(null, `select public.insurance_quote_editable_columns() as c`);
      expect([...p.c].sort()).toEqual(policySet(SPEC_FIELD_COLUMNS));
      expect([...qc.c].sort()).toEqual(quoteSet(SPEC_FIELD_COLUMNS));
      expect(new Set(p.c).size).toBe(p.c.length);
      expect(new Set(qc.c).size).toBe(qc.c.length);
      // Every allowlisted name is a real column of its table.
      for (const [table, cols] of [["insurance_policies", p.c], ["insurance_quotes", qc.c]] as const) {
        const { rows } = await db.query<{ column_name: string }>(
          `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`,
          [table],
        );
        const real = new Set(rows.map((r) => r.column_name));
        expect(cols.filter((c) => !real.has(c)), table).toEqual([]);
      }
    });

    // Runs once src/lib/insurance/fields.ts exists (built by the Insurance lib
    // step); the check above pins the same set against the spec meanwhile.
    it("fields-match-sql: FIELD_DEFS from src/lib/insurance/fields.ts", async () => {
      expect(existsSync(FIELDS_MODULE), "fields.ts must exist").toBe(true);
      const mod = (await import(/* @vite-ignore */ FIELDS_MODULE)) as {
        FIELD_DEFS: { column: string; quoteColumn: string | null }[];
      };
      const p = await one<{ c: string[] }>(null, `select public.insurance_policy_editable_columns() as c`);
      const qc = await one<{ c: string[] }>(null, `select public.insurance_quote_editable_columns() as c`);
      expect([...p.c].sort()).toEqual(policySet(mod.FIELD_DEFS));
      expect([...qc.c].sort()).toEqual(quoteSet(mod.FIELD_DEFS));
    });

    it("a finding dismissal is per finding: two findings of one rule can be dismissed apart, one cannot be dismissed twice", async () => {
      const ins = (key: string) =>
        db.query(
          `insert into public.insurance_finding_dismissals (association_id, rule_id, finding_key, reason) values ($1::uuid, 'DOC-REQ-01', $2, 'n/a')`,
          [f.damen, key],
        );
      await ins("DOC-REQ-01:flood");
      await ins("DOC-REQ-01:earthquake");
      await expect(ins("DOC-REQ-01:flood")).rejects.toThrow(/insurance_finding_dismissals_key/);
      const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from public.insurance_finding_dismissals`);
      expect(rows[0].n).toBe("2");
    });

    it("new tables have association_id restrict FKs and RLS", async () => {
      const { rows } = await db.query<{ tablename: string; rowsecurity: boolean }>(
        `select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = any($1::text[])`,
        [NEW_TABLES],
      );
      expect(rows).toHaveLength(NEW_TABLES.length);
      expect(rows.filter((r) => !r.rowsecurity)).toEqual([]);
      const { rows: fks } = await db.query<{ table_name: string; delete_rule: string }>(
        `select tc.table_name, rc.delete_rule
           from information_schema.table_constraints tc
           join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
           join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
          where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'associations'
            and tc.table_name = any($1::text[])`,
        [NEW_TABLES],
      );
      expect(new Set(fks.map((r) => r.table_name))).toEqual(new Set(NEW_TABLES));
      expect(fks.filter((r) => r.delete_rule !== "RESTRICT")).toEqual([]);
    });

    it("no new SECURITY DEFINER function is executable by anon; the guard helper not even by authenticated", async () => {
      const { rows } = await db.query<{ proname: string; anon: boolean; authed: boolean; config: string[] | null; definer: boolean }>(
        `select p.proname, p.prosecdef as definer, p.proconfig as config,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as authed
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = any($1::text[])`,
        [DEFINER_FUNCTIONS],
      );
      expect(rows.map((r) => r.proname).sort()).toEqual([...DEFINER_FUNCTIONS].sort());
      for (const r of rows) {
        expect(r.definer, r.proname).toBe(true);
        expect(r.anon, r.proname).toBe(false);
        expect(r.config ?? [], r.proname).toContain('search_path=""');
      }
      expect(rows.find((r) => r.proname === "insurance_assert_same_association")!.authed).toBe(false);
      expect(rows.find((r) => r.proname === "owner_insurance_summary")!.authed).toBe(true);
    });
  });

  // ------------------------------------------------------------------ reads

  describe("reads and the insurance-category rule (decision 7)", () => {
    it("a read of an insurance document is created", async () => {
      const id = await queuedRead();
      const r = await one<{ state: string; attempts: number }>(null, `select state, attempts from public.insurance_document_reads where id = $1::uuid`, [id]);
      expect(r).toEqual({ state: "queued", attempts: 0 });
    });

    it("a read of a tax_form document is refused", async () => {
      const documentId = await taxDoc(f.damen);
      const e = await pgError(
        q(f.cyUser, `insert into public.insurance_document_reads (association_id, document_id, mode) values ($1::uuid, $2::uuid, 'policy')`, [
          f.damen,
          documentId,
        ]),
      );
      expect(e.code).toBe("42501");
      expect(e.message).toBe("File this document as Insurance before Walkup reads it.");
    });

    it("a read of an uncategorised document is refused", async () => {
      const documentId = await doc(f.damen, null);
      const e = await pgError(
        q(f.cyUser, `insert into public.insurance_document_reads (association_id, document_id, mode) values ($1::uuid, $2::uuid, 'quote')`, [
          f.damen,
          documentId,
        ]),
      );
      expect(e.code).toBe("42501");
    });

    it("re-pointing a read at a tax_form document is refused", async () => {
      const id = await queuedRead();
      const documentId = await taxDoc(f.damen);
      const e = await pgError(q(f.cyUser, `update public.insurance_document_reads set document_id = $2::uuid where id = $1::uuid`, [id, documentId]));
      expect(e.code).toBe("42501");
      // An update that leaves the document alone is not re-checked.
      const ok = await q(f.cyUser, `update public.insurance_document_reads set error = 'x' where id = $1::uuid`, [id]);
      expect(ok.affectedRows).toBe(1);
    });

    it("hoyne board cannot read a damen document", async () => {
      const zara = await zaraBoard();
      const documentId = await insuranceDoc(f.damen);
      const e = await pgError(
        q(zara, `insert into public.insurance_document_reads (association_id, document_id, mode) values ($1::uuid, $2::uuid, 'policy')`, [
          f.hoyne,
          documentId,
        ]),
      );
      expect(e.code).toBe("42501");
      expect(e.message).toBe("document belongs to a different association");
    });

    it("claim_insurance_read: queued to running, no double claim, stale reclaim, attempts cap at 3", async () => {
      const id = await queuedRead();
      const first = await claimRead(f.cyUser, id);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ state: "running", attempts: 1 });
      expect(await claimRead(f.cyUser, id)).toEqual([]);

      await db.query(`update public.insurance_document_reads set started_at = now() - interval '300 seconds' where id = $1::uuid`, [id]);
      expect(await claimRead(f.cyUser, id)).toEqual([]);

      await db.query(`update public.insurance_document_reads set started_at = now() - interval '331 seconds' where id = $1::uuid`, [id]);
      const second = await claimRead(f.cyUser, id);
      expect(second[0]).toMatchObject({ state: "running", attempts: 2 });

      await db.query(`update public.insurance_document_reads set state = 'failed' where id = $1::uuid`, [id]);
      expect((await claimRead(f.cyUser, id))[0]).toMatchObject({ attempts: 3 });
      await db.query(`update public.insurance_document_reads set state = 'failed' where id = $1::uuid`, [id]);
      expect(await claimRead(f.cyUser, id)).toEqual([]);
    });

    it("claim_insurance_read by owner returns an empty set", async () => {
      const id = await queuedRead();
      expect(await claimRead(f.adaUser, id)).toEqual([]);
      expect((await one<{ state: string }>(null, `select state from public.insurance_document_reads where id = $1::uuid`, [id])).state).toBe("queued");
    });

    it("accountant sees no reads or research rows", async () => {
      await queuedRead();
      await q(f.cyUser, `insert into public.insurance_market_research (association_id, kind) values ($1::uuid, 'agencies')`, [f.damen]);
      expect((await q(f.cyUser, `select id from public.insurance_document_reads`)).rows).toHaveLength(1);
      expect((await q(f.cyUser, `select id from public.insurance_market_research`)).rows).toHaveLength(1);
      expect((await q(f.niaUser, `select id from public.insurance_document_reads`)).rows).toHaveLength(0);
      expect((await q(f.niaUser, `select id from public.insurance_market_research`)).rows).toHaveLength(0);
      await expect(
        q(f.niaUser, `insert into public.insurance_market_research (association_id, kind) values ($1::uuid, 'insurers')`, [f.damen]),
      ).rejects.toThrow(/row-level security/);
    });

    it("hoyne board cannot see damen reads", async () => {
      await queuedRead();
      const zara = await zaraBoard();
      expect((await q(zara, `select id from public.insurance_document_reads`)).rows).toHaveLength(0);
    });

    it("deleting the document cascades its reads", async () => {
      const { readId, documentId } = await doneRead();
      await db.query(`delete from public.documents where id = $1::uuid`, [documentId]);
      expect(await count(`select 1 from public.insurance_document_reads where id = '${readId}'`)).toBe(0);
    });
  });

  // ---------------------------------------------------- save_insurance_policy

  describe("save_insurance_policy", () => {
    it("board member saves a policy with sources and a document link in one call", async () => {
      const documentId = await insuranceDoc(f.damen);
      const id = await savePolicy(f.cyUser, policyValues({ carrier_name: "Acuity", named_insured: "2158 N. Damen" }), {
        sources: [
          { field_name: "carrier_name", source: "manual" },
          { field_name: "building_limit", source: "manual" },
          { field_name: "named_insured", source: "manual" },
        ],
        options: { document_id: documentId },
      });
      expect(await count(`select 1 from public.insurance_policies where id = '${id}' and source_document_id = '${documentId}'`)).toBe(1);
      expect(await count(`select 1 from public.insurance_policy_field_sources where policy_id = '${id}'`)).toBe(3);
      const link = await one<{ relation: string }>(
        null,
        `select relation from public.document_links where target_table = 'insurance_policies' and target_id = $1::uuid`,
        [id],
      );
      expect(link.relation).toBe("declarations");
      const row = await one<{ updated_by: string; last_reviewed_by: string }>(
        null,
        `select updated_by, last_reviewed_by from public.insurance_policies where id = $1::uuid`,
        [id],
      );
      expect(row).toEqual({ updated_by: f.cyUser, last_reviewed_by: f.cyUser });
    });

    it("owner cannot save", async () => {
      const e = await pgError(savePolicy(f.adaUser, policyValues()));
      expect(e.code).toBe("42501");
      expect(e.message).toMatch(/^Only a board member/);
    });

    it("accountant cannot save", async () => {
      expect((await pgError(savePolicy(f.niaUser, policyValues()))).code).toBe("42501");
    });

    it("unknown column key is refused", async () => {
      const e = await pgError(savePolicy(f.cyUser, { ...policyValues(), association_id: f.hoyne }));
      expect(e.code).toBe("22023");
      expect(e.message).toBe("Unknown policy field: association_id");
    });

    it("failure rolls back everything", async () => {
      const documentId = await insuranceDoc(f.damen);
      const before = await count(`select 1 from public.insurance_policies`);
      const e = await pgError(
        savePolicy(f.cyUser, policyValues({ carrier_name: "Rollback Mutual" }), {
          sources: [{ field_name: "carrier_name", source: "bogus" }],
          options: { document_id: documentId },
        }),
      );
      expect(e.code).toBe("22023");
      expect(await count(`select 1 from public.insurance_policies`)).toBe(before);
      expect(await count(`select 1 from public.insurance_policies where carrier_name = 'Rollback Mutual'`)).toBe(0);
      expect(await count(`select 1 from public.document_links where document_id = '${documentId}'`)).toBe(0);
    });

    it("edit with stale expected_updated_at raises 40001", async () => {
      const e = await pgError(
        savePolicy(f.cyUser, { carrier_name: "Changed" }, { policyId, options: { expected_updated_at: "2000-01-01T00:00:00Z" } }),
      );
      expect(e.code).toBe("40001");
    });

    it("expected_updated_at with microseconds dropped still matches", async () => {
      await db.query(`update public.insurance_policies set updated_at = '2026-10-14 12:00:00.123456+00' where id = $1::uuid`, [policyId]);
      await savePolicy(f.cyUser, { carrier_name: "Changed" }, { policyId, options: { expected_updated_at: "2026-10-14T12:00:00.123Z" } });
      expect((await one<{ c: string }>(null, `select carrier_name as c from public.insurance_policies where id = $1::uuid`, [policyId])).c).toBe(
        "Changed",
      );
      // A different millisecond is a different edit.
      await db.query(`update public.insurance_policies set updated_at = '2026-10-14 12:00:00.123456+00' where id = $1::uuid`, [policyId]);
      const e = await pgError(
        savePolicy(f.cyUser, { carrier_name: "Again" }, { policyId, options: { expected_updated_at: "2026-10-14T12:00:00.124Z" } }),
      );
      expect(e.code).toBe("40001");
    });

    it("edit removes provenance for cleared fields", async () => {
      const id = await savePolicy(f.cyUser, policyValues({ named_insured: "Damen" }), {
        sources: [
          { field_name: "carrier_name", source: "manual" },
          { field_name: "building_limit", source: "manual" },
          { field_name: "named_insured", source: "manual" },
        ],
      });
      await savePolicy(f.cyUser, { named_insured: null }, { policyId: id, sources: [{ field_name: "carrier_name", source: "keep" }] });
      const { rows } = await db.query<{ field_name: string }>(
        `select field_name from public.insurance_policy_field_sources where policy_id = $1::uuid`,
        [id],
      );
      expect(rows.map((r) => r.field_name)).toEqual(["carrier_name"]);
    });

    it("board_member edit removes provenance through the RPC, but a direct delete removes nothing", async () => {
      const bo = await boBoard();
      const id = await savePolicy(f.cyUser, policyValues(), {
        sources: [
          { field_name: "carrier_name", source: "manual" },
          { field_name: "building_limit", source: "manual" },
        ],
      });
      const direct = await q(bo, `delete from public.insurance_policy_field_sources where policy_id = $1::uuid`, [id]);
      expect(direct.affectedRows).toBe(0);
      await savePolicy(bo, { building_limit: "2500000.00" }, { policyId: id, sources: [{ field_name: "building_limit", source: "manual" }] });
      const { rows } = await db.query<{ field_name: string; created_by: string }>(
        `select field_name, created_by from public.insurance_policy_field_sources where policy_id = $1::uuid`,
        [id],
      );
      expect(rows).toEqual([{ field_name: "building_limit", created_by: f.boUser }]);
    });

    it("insurance_prune_field_sources refuses another association's policy", async () => {
      const zara = await zaraBoard();
      const e = await pgError(q(zara, `select public.insurance_prune_field_sources($1::uuid, null, '{}'::text[])`, [policyId]));
      expect(e.code).toBe("42501");
      const both = await pgError(q(f.cyUser, `select public.insurance_prune_field_sources($1::uuid, $1::uuid, '{}'::text[])`, [policyId]));
      expect(both.code).toBe("22023");
    });

    it("extracted sources are rebuilt from the stored read", async () => {
      const { readId, documentId } = await doneRead();
      const id = await savePolicy(f.cyUser, policyValues(), {
        sources: [
          { field_name: "building_limit", source: "extracted", candidate_index: 0, page_number: 9, raw_text_snippet: "forged", document_id: f.damen },
        ],
        options: { read_id: readId, read_index: 0 },
      });
      const s = await one<{ page_number: number; raw_text_snippet: string; confidence: string; document_id: string; read_id: string; source: string }>(
        null,
        `select page_number, raw_text_snippet, confidence::text, document_id, read_id, source
           from public.insurance_policy_field_sources where policy_id = $1::uuid and field_name = 'building_limit'`,
        [id],
      );
      expect(s).toEqual({
        page_number: 2,
        raw_text_snippet: "Building $2,400,000",
        confidence: "0.9000",
        document_id: documentId,
        read_id: readId,
        source: "extracted",
      });
    });

    it("extracted source with a bad candidate index is refused", async () => {
      const { readId } = await doneRead();
      const e = await pgError(
        savePolicy(f.cyUser, policyValues(), {
          sources: [{ field_name: "building_limit", source: "extracted", candidate_index: 5 }],
          options: { read_id: readId, read_index: 0 },
        }),
      );
      expect(e.code).toBe("22023");
    });

    it("extracted source without a read is refused", async () => {
      const e = await pgError(
        savePolicy(f.cyUser, policyValues(), { sources: [{ field_name: "building_limit", source: "extracted", candidate_index: 0 }] }),
      );
      expect(e.code).toBe("22023");
      // A read id without its item index is refused too.
      const { readId } = await doneRead();
      expect((await pgError(savePolicy(f.cyUser, policyValues(), { options: { read_id: readId } }))).code).toBe("22023");
    });

    it("agent_confirmed needs confirmed_on; with it, created_by is the caller", async () => {
      const e = await pgError(
        savePolicy(f.cyUser, { building_limit: "2600000.00" }, { policyId, sources: [{ field_name: "building_limit", source: "agent_confirmed" }] }),
      );
      expect(e.code).toBe("22023");
      expect(e.message).toBe("Enter the date your agent answered.");
      await savePolicy(f.cyUser, { building_limit: "2600000.00" }, {
        policyId,
        sources: [{ field_name: "building_limit", source: "agent_confirmed", confirmed_on: "2026-10-01" }],
      });
      const s = await one<{ confirmed_on: string; created_by: string; source: string }>(
        null,
        `select confirmed_on::text, created_by, source from public.insurance_policy_field_sources where policy_id = $1::uuid`,
        [policyId],
      );
      expect(s).toEqual({ confirmed_on: "2026-10-01", created_by: f.cyUser, source: "agent_confirmed" });
    });

    describe("idempotency", () => {
      it("saving the same read item twice raises 23505 with the first policy id in details", async () => {
        const { readId } = await doneRead();
        const first = await savePolicy(f.cyUser, policyValues({ carrier_name: "From File" }), { options: { read_id: readId, read_index: 0 } });
        const e = await pgError(savePolicy(f.cyUser, policyValues({ carrier_name: "From File" }), { options: { read_id: readId, read_index: 0 } }));
        expect(e.code).toBe("23505");
        expect(e.detail).toBe(first);
        expect(await count(`select 1 from public.insurance_policies where carrier_name = 'From File'`)).toBe(1);
      });

      it("two calls with the same client_token return the same id", async () => {
        const token = "0a0a0a0a-0000-4000-8000-000000000001";
        const a = await savePolicy(f.cyUser, policyValues({ carrier_name: "Token Mutual" }), { options: { client_token: token } });
        const b = await savePolicy(f.cyUser, policyValues({ carrier_name: "Token Mutual" }), { options: { client_token: token } });
        expect(b).toBe(a);
        expect(await count(`select 1 from public.insurance_policies where carrier_name = 'Token Mutual'`)).toBe(1);
      });

      it("a skipped item can still be saved", async () => {
        const { readId } = await doneRead();
        await q(f.cyUser, `select public.set_insurance_read_item_skipped($1::uuid, 0, true)`, [readId]);
        const id = await savePolicy(f.cyUser, policyValues(), { options: { read_id: readId, read_index: 0 } });
        const r = await one<{ saved: Record<string, unknown> }>(null, `select saved from public.insurance_document_reads where id = $1::uuid`, [readId]);
        expect(r.saved).toEqual({ "0": { policy_id: id } });
      });
    });

    describe("replaces", () => {
      let account: string;
      const umbrella = (from: string, to: string, over: Record<string, unknown> = {}) =>
        policyValues({ coverage: "umbrella", carrier_name: "Old Umbrella Co", effective_from: from, effective_to: to, payment_schedule: "quarterly", ...over });

      beforeEach(async () => {
        account = await expenseAccount(f.damen);
      });

      it("replaces keeps the old policy active and gives the new one its own bill; the old bill stays while it has an installment left", async () => {
        const old = await savePolicy(f.cyUser, umbrella("2025-03-01", "2026-03-01"), {
          options: { premium_bill: { account_id: account, frequency: "quarterly", typical_amount: "1000.00", next_due_on: "2025-12-01" } },
        });
        const fresh = await savePolicy(f.cyUser, umbrella("2026-03-01", "2027-03-01", { carrier_name: "New Umbrella Co" }), {
          options: { replaces_policy_id: old, premium_bill: { frequency: "quarterly", typical_amount: "1100.00", next_due_on: "2026-03-01" } },
        });
        const o = await policyRow(old);
        expect(o.replaced_by_policy_id).toBe(fresh);
        expect(o.archived_at).toBeNull();
        expect(o.replaced_at).not.toBeNull();
        const newBills = await activeBills(fresh);
        expect(newBills).toHaveLength(1);
        expect(newBills[0]).toMatchObject({ account_id: account, typical_amount: "1100.00", next_due_on: "2026-03-01" });
        expect(await activeBills(old)).toHaveLength(1);
      });

      it("the old bill retires at once when its next due date is on or after the new start", async () => {
        const old = await savePolicy(f.cyUser, umbrella("2025-03-01", "2026-03-01", { payment_schedule: "annual" }), {
          options: { premium_bill: { account_id: account, frequency: "annual", typical_amount: "4000.00", next_due_on: "2026-03-01" } },
        });
        const fresh = await savePolicy(f.cyUser, umbrella("2026-03-01", "2027-03-01", { payment_schedule: "annual" }), {
          options: { replaces_policy_id: old, premium_bill: { frequency: "annual", typical_amount: "4200.00", next_due_on: "2026-03-01" } },
        });
        expect(await activeBills(old)).toHaveLength(0);
        expect(await activeBills(fresh)).toHaveLength(1);
      });

      it("replacing an already-replaced policy with a different one is refused", async () => {
        const a = await savePolicy(f.cyUser, umbrella("2024-03-01", "2025-03-01"));
        await savePolicy(f.cyUser, umbrella("2025-03-01", "2026-03-01"), { options: { replaces_policy_id: a } });
        const e = await pgError(savePolicy(f.cyUser, umbrella("2025-04-01", "2026-04-01"), { options: { replaces_policy_id: a } }));
        expect(e.code).toBe("22023");
      });

      it("replacing an archived policy is refused", async () => {
        const a = await savePolicy(f.cyUser, umbrella("2024-03-01", "2025-03-01"));
        await q(f.cyUser, `select public.archive_insurance_policy($1::uuid, true)`, [a]);
        const e = await pgError(savePolicy(f.cyUser, umbrella("2025-03-01", "2026-03-01"), { options: { replaces_policy_id: a } }));
        expect(e.code).toBe("22023");
      });

      it("replacing a policy of another coverage is refused", async () => {
        const e = await pgError(savePolicy(f.cyUser, umbrella("2027-06-01", "2028-06-01"), { options: { replaces_policy_id: policyId } }));
        expect(e.code).toBe("22023");
        expect(e.message).toBe("A policy can only replace one of the same kind.");
      });

      it("replacing a policy that starts on or after the new one is refused", async () => {
        const a = await savePolicy(f.cyUser, umbrella("2025-03-01", "2026-03-01"));
        const e = await pgError(savePolicy(f.cyUser, umbrella("2025-03-01", "2026-03-01"), { options: { replaces_policy_id: a } }));
        expect(e.code).toBe("22023");
        expect(e.message).toBe("The policy being replaced has to start before this one.");
      });

      it("a 2-cycle (B replaces A, then A replaces B) is refused", async () => {
        const a = await savePolicy(f.cyUser, umbrella("2024-03-01", "2025-03-01"));
        const b = await savePolicy(f.cyUser, umbrella("2025-03-01", "2026-03-01"), { options: { replaces_policy_id: a } });
        const e = await pgError(savePolicy(f.cyUser, { notes: "x" }, { policyId: a, options: { replaces_policy_id: b } }));
        expect(e.code).toBe("22023");
        expect((await policyRow(b)).replaced_by_policy_id).toBeNull();
      });

      it("premium_bill inherits the predecessor bill's account and fund when none is given", async () => {
        const reserve = "ffff0000-0000-0000-0000-000000000002";
        const old = await savePolicy(f.cyUser, umbrella("2025-03-01", "2026-03-01"), {
          options: { premium_bill: { account_id: account, frequency: "quarterly", typical_amount: "1000.00", next_due_on: "2025-12-01" } },
        });
        await db.query(`update public.recurring_bills set fund_id = $2::uuid, autopay_arranged = true where insurance_policy_id = $1::uuid`, [old, reserve]);
        const fresh = await savePolicy(f.cyUser, umbrella("2026-03-01", "2027-03-01"), {
          options: { replaces_policy_id: old, premium_bill: { frequency: "quarterly", typical_amount: "1100.00", next_due_on: "2026-03-01" } },
        });
        const [bill] = await activeBills(fresh);
        expect(bill).toMatchObject({ account_id: account, fund_id: reserve });
        expect((await one<{ a: boolean }>(null, `select autopay_arranged as a from public.recurring_bills where id = $1::uuid`, [bill.id])).a).toBe(true);
      });
    });

    it("accepted quote: quote selected, request accepted, policy.accepted_quote_id set", async () => {
      const c = await contact(f.damen);
      const [req] = (await createRequests(f.cyUser, [c])).rows;
      await markSent(f.cyUser, req.message_id);
      const quoteId = await saveQuote(f.cyUser, quoteValues({ quote_request_id: req.request_id }));
      const id = await savePolicy(f.cyUser, policyValues({ carrier_name: "Acuity", effective_from: "2027-06-01", effective_to: "2028-06-01" }), {
        options: { accepted_quote_id: quoteId, replaces_policy_id: policyId },
      });
      expect((await one<{ s: boolean }>(null, `select was_selected as s from public.insurance_quotes where id = $1::uuid`, [quoteId])).s).toBe(true);
      expect((await one<{ s: string }>(null, `select status as s from public.insurance_quote_requests where id = $1::uuid`, [req.request_id])).s).toBe(
        "accepted",
      );
      expect((await policyRow(id)).accepted_quote_id).toBe(quoteId);
    });

    it("quote sources carry the quote's document and page", async () => {
      const documentId = await insuranceDoc(f.damen);
      const { readId } = await doneRead(f.damen, f.cyUser, "quote");
      const quoteId = await saveQuote(f.cyUser, quoteValues(), {
        sources: [{ field_name: "building_limit", source: "extracted", candidate_index: 0 }],
        options: { read_id: readId, read_index: 0, document_id: documentId },
      });
      const id = await savePolicy(f.cyUser, policyValues({ effective_from: "2027-06-01", effective_to: "2028-06-01" }), {
        sources: [{ field_name: "building_limit", source: "quote" }],
        options: { accepted_quote_id: quoteId },
      });
      const s = await one<{ document_id: string; page_number: number; source: string }>(
        null,
        `select document_id, page_number, source from public.insurance_policy_field_sources where policy_id = $1::uuid`,
        [id],
      );
      expect(s).toEqual({ document_id: documentId, page_number: 2, source: "quote" });
    });

    it("read_index marks the read item saved", async () => {
      const { readId } = await doneRead();
      const id = await savePolicy(f.cyUser, policyValues(), { options: { read_id: readId, read_index: 1 } });
      const r = await one<{ saved: Record<string, unknown> }>(null, `select saved from public.insurance_document_reads where id = $1::uuid`, [readId]);
      expect(r.saved).toEqual({ "1": { policy_id: id } });
    });

    it("premium_bill creates exactly one active bill; a second save updates it", async () => {
      const account = await expenseAccount(f.damen);
      const bill = { account_id: account, frequency: "annual", typical_amount: "3766.00", next_due_on: "2026-06-01" };
      const id = await savePolicy(f.cyUser, policyValues({ carrier_name: "Billed Co" }), { options: { premium_bill: bill } });
      await savePolicy(f.cyUser, { annual_premium: "3900.00" }, { policyId: id, options: { premium_bill: { ...bill, typical_amount: "3900.00" } } });
      const bills = await activeBills(id);
      expect(bills).toHaveLength(1);
      expect(bills[0].typical_amount).toBe("3900.00");
      const row = await one<{ name: string; notes: string }>(null, `select name, notes from public.recurring_bills where id = $1::uuid`, [bills[0].id]);
      expect(row).toEqual({ name: "Billed Co insurance premium", notes: "Tracked from Insurance. Walkup does not pay it." });
      // The unique index holds even against a direct second insert.
      await expect(
        db.query(
          `insert into public.recurring_bills (association_id, name, account_id, fund_id, insurance_policy_id)
           values ($1::uuid, 'dup', $2::uuid, 'ffff0000-0000-0000-0000-000000000001', $3::uuid)`,
          [f.damen, account, id],
        ),
      ).rejects.toThrow(/recurring_bills_insurance_policy_key/);
    });

    it("premium_bill without account, no existing bill and no predecessor bill raises 22023", async () => {
      const e = await pgError(
        savePolicy(f.cyUser, policyValues({ carrier_name: "No Account" }), {
          options: { premium_bill: { frequency: "annual", typical_amount: "100.00", next_due_on: "2026-06-01" } },
        }),
      );
      expect(e.code).toBe("22023");
      expect(e.message).toBe("Choose the expense category the premium is paid from.");
      expect(await count(`select 1 from public.insurance_policies where carrier_name = 'No Account'`)).toBe(0);
    });

    describe("cross-association", () => {
      it("hoyne board cannot save into damen", async () => {
        const zara = await zaraBoard();
        expect((await pgError(savePolicy(zara, policyValues(), { assoc: f.damen }))).code).toBe("42501");
      });

      it("damen board cannot reference a hoyne contact, document, quote or replaced policy", async () => {
        const zara = await zaraBoard();
        const hoyneContact = await contact(f.hoyne);
        const hoyneDoc = await insuranceDoc(f.hoyne);
        const hoyneQuote = await saveQuote(zara, quoteValues(), { assoc: f.hoyne });
        const hoynePolicy = await savePolicy(zara, policyValues({ effective_from: "2025-06-01", effective_to: "2026-06-01" }), { assoc: f.hoyne });

        const c = await pgError(savePolicy(f.cyUser, policyValues({ agent_contact_id: hoyneContact })));
        expect(c).toMatchObject({ code: "42501", message: "contact belongs to a different association" });
        const d = await pgError(savePolicy(f.cyUser, policyValues(), { options: { document_id: hoyneDoc } }));
        expect(d).toMatchObject({ code: "42501", message: "document belongs to a different association" });
        // Through the RPC the quote is looked up in the caller's association
        // first (not found); written directly, the guard refuses it.
        expect((await pgError(savePolicy(f.cyUser, policyValues(), { options: { accepted_quote_id: hoyneQuote } }))).code).toBe("P0002");
        const qd = await pgError(q(f.cyUser, `update public.insurance_policies set accepted_quote_id = $2::uuid where id = $1::uuid`, [policyId, hoyneQuote]));
        expect(qd).toMatchObject({ code: "42501", message: "quote belongs to a different association" });
        expect((await pgError(savePolicy(f.cyUser, policyValues(), { options: { replaces_policy_id: hoynePolicy } }))).code).toBe("P0002");
        const pd = await pgError(
          q(f.cyUser, `update public.insurance_policies set replaced_by_policy_id = $2::uuid where id = $1::uuid`, [policyId, hoynePolicy]),
        );
        expect(pd).toMatchObject({ code: "42501", message: "replacing policy belongs to a different association" });
      });

      it("hoyne board cannot update a damen policy by id", async () => {
        const zara = await zaraBoard();
        const e = await pgError(savePolicy(zara, { carrier_name: "Hijack" }, { assoc: f.hoyne, policyId }));
        expect(e.code).toBe("P0002");
        expect((await one<{ c: string }>(null, `select carrier_name as c from public.insurance_policies where id = $1::uuid`, [policyId])).c).toBe(
          "West Bend",
        );
      });
    });
  });

  // ------------------------------------------------------- premium and bills

  describe("track_insurance_premium and bills", () => {
    it("a hoyne expense account is refused", async () => {
      const hoyneAccount = await expenseAccount(f.hoyne);
      const e = await pgError(track(f.cyUser, policyId, hoyneAccount, "annual", "3766.00", "2026-06-01"));
      expect(e.code).toBe("22023");
      expect(e.message).toBe("Choose one of your expense categories for the premium.");
    });

    it("a damen income account is refused", async () => {
      const e = await pgError(track(f.cyUser, policyId, "acc00000-0000-0000-0000-000000004000", "annual", "3766.00", "2026-06-01"));
      expect(e.code).toBe("22023");
    });

    it("an owner can't track a premium; an archived policy and a zero premium are refused", async () => {
      const account = await expenseAccount(f.damen);
      expect((await pgError(track(f.adaUser, policyId, account, "annual", "3766.00", null))).code).toMatch(/42501|P0002/);
      expect((await pgError(track(f.cyUser, policyId, account, "annual", "0", null))).code).toBe("22023");
      await q(f.cyUser, `select public.archive_insurance_policy($1::uuid, true)`, [policyId]);
      expect((await pgError(track(f.cyUser, policyId, account, "annual", "3766.00", null))).code).toBe("22023");
    });

    it("direct insert of a recurring_bills row with a hoyne account or fund is refused", async () => {
      const hoyneAccount = await expenseAccount(f.hoyne);
      const fund = await hoyneFund();
      const insert = (account: string, fundId: string) =>
        q(
          f.cyUser,
          `insert into public.recurring_bills (association_id, name, account_id, fund_id) values ($1::uuid, 'Sneaky', $2::uuid, $3::uuid)`,
          [f.damen, account, fundId],
        );
      expect(await pgError(insert(hoyneAccount, "ffff0000-0000-0000-0000-000000000001"))).toMatchObject({
        code: "42501",
        message: "category belongs to a different association",
      });
      expect(await pgError(insert("acc00000-0000-0000-0000-000000001000", fund))).toMatchObject({
        code: "42501",
        message: "fund belongs to a different association",
      });
    });

    it("insurance_premium_bill_advance: the four premiumSchedule cases", async () => {
      const account = await expenseAccount(f.damen);
      for (const c of PREMIUM_ADVANCE_CASES) {
        const id = await savePolicy(f.cyUser, policyValues({ carrier_name: c.name, ...c.policy }));
        const freq = c.policy.payment_schedule === "semi_annual" ? "semiannual" : c.policy.payment_schedule;
        const bill = (await track(f.cyUser, id, account, freq, c.policy.annual_premium, c.paidDueOn)).id;
        if (c.successorStart) {
          await savePolicy(
            f.cyUser,
            policyValues({ ...c.policy, carrier_name: `${c.name} (renewal)`, effective_from: c.successorStart, effective_to: addDays(c.successorStart, 365) }),
            { options: { replaces_policy_id: id } },
          );
        }
        expect(await advance(f.cyUser, bill, c.paidDueOn), c.name).toBe(c.expected);
        const b = await one<{ is_active: boolean; next_due_on: string | null }>(
          null,
          `select is_active, next_due_on::text from public.recurring_bills where id = $1::uuid`,
          [bill],
        );
        if (c.expected === null) {
          expect(b.is_active, c.name).toBe(false);
        } else {
          expect(b, c.name).toEqual({ is_active: true, next_due_on: c.expected });
        }
      }
      // A bill not linked to a policy is not this function's business.
      const gas = await one<{ id: string }>(null, `select id from public.recurring_bills where name = 'Gas'`);
      expect(await advance(f.cyUser, gas.id, "2026-01-01")).toBeNull();
    });

    // Runs once src/lib/insurance/premium.ts exists (Insurance lib step).
    it("premium advance matches premiumSchedule", async () => {
      expect(existsSync(PREMIUM_MODULE), "premium.ts must exist").toBe(true);
      const mod = (await import(/* @vite-ignore */ PREMIUM_MODULE)) as {
        premiumSchedule: (p: (typeof PREMIUM_ADVANCE_CASES)[number]["policy"], today: string) => { nextDueOn: string };
        premiumBillRetires: (p: (typeof PREMIUM_ADVANCE_CASES)[number]["policy"], successorStart: string | null, today: string) => boolean;
      };
      for (const c of PREMIUM_ADVANCE_CASES) {
        const today = addDays(c.paidDueOn, 1);
        expect(mod.premiumBillRetires(c.policy, c.successorStart, today), c.name).toBe(c.expected === null);
        if (c.expected !== null) expect(mod.premiumSchedule(c.policy, today).nextDueOn, c.name).toBe(c.expected);
      }
    });

    it("insurance_premium_bill_advance by an owner raises 42501", async () => {
      const account = await expenseAccount(f.damen);
      const bill = (await track(f.cyUser, policyId, account, "annual", "3766.00", "2026-06-01")).id;
      expect((await pgError(advance(f.adaUser, bill, "2026-06-01"))).code).toBe("42501");
      expect((await pgError(advance(f.niaUser, bill, "2026-06-01"))).code).toBe("42501");
      const b = await one<{ next_due_on: string }>(null, `select next_due_on::text from public.recurring_bills where id = $1::uuid`, [bill]);
      expect(b.next_due_on).toBe("2026-06-01");
    });
  });

  // ---------------------------------------------------- save_insurance_quote

  describe("save_insurance_quote", () => {
    it("saves a quote with sources; the request goes draft to quote_received with sent_at set", async () => {
      const c = await contact(f.damen);
      const [req] = (await createRequests(f.cyUser, [c])).rows;
      const id = await saveQuote(f.cyUser, quoteValues({ quote_request_id: req.request_id, contact_id: c, covers_from: "2026-06-01", covers_to: "2027-06-01" }), {
        sources: [{ field_name: "annual_premium", source: "manual" }],
      });
      expect(await count(`select 1 from public.insurance_policy_field_sources where quote_id = '${id}'`)).toBe(1);
      const r = await one<{ status: string; sent_at: string | null; responded_at: string | null }>(
        null,
        `select status, sent_at, responded_at from public.insurance_quote_requests where id = $1::uuid`,
        [req.request_id],
      );
      expect(r.status).toBe("quote_received");
      expect(r.sent_at).not.toBeNull();
      expect(r.responded_at).not.toBeNull();
    });

    it("saving a quote cancels the request's draft quote_request and follow-up messages; a sent message is untouched", async () => {
      const c = await contact(f.damen);
      const [req] = (await createRequests(f.cyUser, [c])).rows;
      const insertMsg = async (kind: string) =>
        (
          await one<{ id: string }>(
            f.cyUser,
            `insert into public.insurance_messages (association_id, kind, contact_id, subject, body, quote_request_id)
             values ($1::uuid, $2, $3::uuid, 'Following up', 'Any news?', $4::uuid) returning id`,
            [f.damen, kind, c, req.request_id],
          )
        ).id;
      const followUp = await insertMsg("quote_follow_up");
      const sentFollowUp = await insertMsg("quote_follow_up");
      const other = await insertMsg("other");
      await markSent(f.cyUser, sentFollowUp);
      await saveQuote(f.cyUser, quoteValues({ quote_request_id: req.request_id }));
      const status = async (id: string) =>
        (await one<{ s: string }>(null, `select status::text as s from public.insurance_messages where id = $1::uuid`, [id])).s;
      expect(await status(req.message_id)).toBe("cancelled");
      expect(await status(followUp)).toBe("cancelled");
      expect(await status(sentFollowUp)).toBe("sent");
      expect(await status(other)).toBe("draft");
    });

    it("quote sources are unique per (quote_id, field_name); policy and quote sources coexist", async () => {
      const id = await saveQuote(f.cyUser, quoteValues(), { sources: [{ field_name: "building_limit", source: "manual" }] });
      await savePolicy(f.cyUser, { building_limit: "2400000.00" }, { policyId, sources: [{ field_name: "building_limit", source: "manual" }] });
      const e = await pgError(
        q(f.cyUser, `insert into public.insurance_policy_field_sources (association_id, quote_id, field_name, source) values ($1::uuid, $2::uuid, 'building_limit', 'manual')`, [
          f.damen,
          id,
        ]),
      );
      expect(e.code).toBe("23505");
      expect(await count(`select 1 from public.insurance_policy_field_sources where field_name = 'building_limit'`)).toBe(2);
    });

    it("one-owner check: a source row with both policy_id and quote_id is refused", async () => {
      const id = await saveQuote(f.cyUser, quoteValues());
      const e = await pgError(
        q(
          f.cyUser,
          `insert into public.insurance_policy_field_sources (association_id, policy_id, quote_id, field_name, source)
           values ($1::uuid, $2::uuid, $3::uuid, 'carrier_name', 'manual')`,
          [f.damen, policyId, id],
        ),
      );
      expect(e.code).toBe("23514");
    });

    it("quote save refuses source 'quote' and 'agent_confirmed'", async () => {
      for (const source of ["quote", "agent_confirmed"]) {
        const e = await pgError(saveQuote(f.cyUser, quoteValues(), { sources: [{ field_name: "building_limit", source, confirmed_on: "2026-10-01" }] }));
        expect(e.code, source).toBe("22023");
      }
    });

    it("refuses policy-only keys and updates an existing quote", async () => {
      expect((await pgError(saveQuote(f.cyUser, { ...quoteValues(), effective_from: "2026-01-01" }))).code).toBe("22023");
      const id = await saveQuote(f.cyUser, quoteValues(), { sources: [{ field_name: "building_limit", source: "manual" }] });
      await saveQuote(f.cyUser, { annual_premium: "3400.00" }, { quoteId: id, sources: [{ field_name: "annual_premium", source: "manual" }] });
      const r = await one<{ p: string }>(null, `select annual_premium::text as p from public.insurance_quotes where id = $1::uuid`, [id]);
      expect(r.p).toBe("3400.00");
      const { rows } = await db.query<{ field_name: string }>(`select field_name from public.insurance_policy_field_sources where quote_id = $1::uuid`, [id]);
      expect(rows.map((x) => x.field_name)).toEqual(["annual_premium"]);
      expect((await pgError(saveQuote(f.cyUser, { annual_premium: "1.00" }, { quoteId: "0a0a0a0a-0000-4000-8000-0000000000ff" }))).code).toBe("P0002");
    });

    it("saving the same quote read item twice raises 23505; the same client_token returns the same id", async () => {
      const { readId } = await doneRead(f.damen, f.cyUser, "quote");
      const first = await saveQuote(f.cyUser, quoteValues(), { options: { read_id: readId, read_index: 0 } });
      const e = await pgError(saveQuote(f.cyUser, quoteValues(), { options: { read_id: readId, read_index: 0 } }));
      expect(e.code).toBe("23505");
      expect(e.detail).toBe(first);
      const token = "0a0a0a0a-0000-4000-8000-000000000002";
      const a = await saveQuote(f.cyUser, quoteValues({ carrier_name: "Token Quote" }), { options: { client_token: token } });
      const b = await saveQuote(f.cyUser, quoteValues({ carrier_name: "Token Quote" }), { options: { client_token: token } });
      expect(b).toBe(a);
      expect(await count(`select 1 from public.insurance_quotes where carrier_name = 'Token Quote'`)).toBe(1);
    });

    it("cross-association: a hoyne quote_request_id is refused", async () => {
      const zara = await zaraBoard();
      const hoyneContact = await contact(f.hoyne);
      const [req] = (await createRequests(zara, [hoyneContact], undefined, f.hoyne)).rows;
      const e = await pgError(saveQuote(f.cyUser, quoteValues({ quote_request_id: req.request_id })));
      expect(e).toMatchObject({ code: "42501", message: "quote request belongs to a different association" });
    });
  });

  // ------------------------------------------------------ lifecycle and RPCs

  describe("lifecycle and RPCs", () => {
    it("archive_insurance_policy by board_admin archives and deactivates the linked bill; unarchive leaves the bill inactive", async () => {
      const account = await expenseAccount(f.damen);
      const bill = (await track(f.cyUser, policyId, account, "annual", "3766.00", "2026-06-01")).id;
      await q(f.cyUser, `select public.archive_insurance_policy($1::uuid, true)`, [policyId]);
      const p = await one<{ archived_at: string | null; archived_by: string | null }>(
        null,
        `select archived_at, archived_by from public.insurance_policies where id = $1::uuid`,
        [policyId],
      );
      expect(p.archived_at).not.toBeNull();
      expect(p.archived_by).toBe(f.cyUser);
      const active = async () => (await one<{ a: boolean }>(null, `select is_active as a from public.recurring_bills where id = $1::uuid`, [bill])).a;
      expect(await active()).toBe(false);
      await q(f.cyUser, `select public.archive_insurance_policy($1::uuid, false)`, [policyId]);
      expect((await policyRow(policyId)).archived_at).toBeNull();
      expect(await active()).toBe(false);
    });

    it("archive_insurance_policy by board_member raises 42501", async () => {
      const bo = await boBoard();
      expect((await pgError(q(bo, `select public.archive_insurance_policy($1::uuid, true)`, [policyId]))).code).toBe("42501");
    });

    it("delete_insurance_policy: admin only, removes links, blocked by claims, clears replaced_by", async () => {
      const bo = await boBoard();
      const documentId = await insuranceDoc(f.damen);
      const older = await savePolicy(f.cyUser, policyValues({ effective_from: "2025-06-01", effective_to: "2026-06-01" }));
      const id = await savePolicy(f.cyUser, policyValues({ carrier_name: "Doomed" }), {
        options: { document_id: documentId, replaces_policy_id: older },
      });
      const del = (user: string, pid: string) => q(user, `select public.delete_insurance_policy($1::uuid)`, [pid]);

      expect((await pgError(del(bo, id))).code).toBe("42501");

      const claim = await one<{ id: string }>(
        f.cyUser,
        `insert into public.insurance_claims (association_id, policy_id, date_of_loss, description) values ($1::uuid, $2::uuid, '2026-08-01', 'Leak') returning id`,
        [f.damen, id],
      );
      expect((await pgError(del(f.cyUser, id))).code).toBe("23503");
      expect(await count(`select 1 from public.insurance_policies where id = '${id}'`)).toBe(1);
      expect(await count(`select 1 from public.document_links where target_id = '${id}'`)).toBe(1);

      await q(f.cyUser, `select public.delete_insurance_claim($1::uuid)`, [claim.id]);
      await del(f.cyUser, id);
      expect(await count(`select 1 from public.insurance_policies where id = '${id}'`)).toBe(0);
      expect(await count(`select 1 from public.document_links where target_id = '${id}'`)).toBe(0);
      expect((await policyRow(older)).replaced_by_policy_id).toBeNull();
    });

    it("delete_insurance_quote removes its document_links; delete_insurance_claim removes its links and nulls messages.claim_id", async () => {
      const qDoc = await insuranceDoc(f.damen);
      const quoteId = await saveQuote(f.cyUser, quoteValues(), { options: { document_id: qDoc } });
      expect(await count(`select 1 from public.document_links where target_table = 'insurance_quotes' and target_id = '${quoteId}'`)).toBe(1);
      await q(f.cyUser, `select public.delete_insurance_quote($1::uuid)`, [quoteId]);
      expect(await count(`select 1 from public.document_links where target_id = '${quoteId}'`)).toBe(0);
      expect(await count(`select 1 from public.insurance_quotes where id = '${quoteId}'`)).toBe(0);

      const cDoc = await insuranceDoc(f.damen);
      const claim = await one<{ id: string }>(
        f.cyUser,
        `insert into public.insurance_claims (association_id, policy_id, date_of_loss, description) values ($1::uuid, $2::uuid, '2026-08-01', 'Leak') returning id`,
        [f.damen, policyId],
      );
      await q(
        f.cyUser,
        `insert into public.document_links (association_id, document_id, target_table, target_id, relation) values ($1::uuid, $2::uuid, 'insurance_claims', $3::uuid, 'claim')`,
        [f.damen, cDoc, claim.id],
      );
      const msg = await one<{ id: string }>(
        f.cyUser,
        `insert into public.insurance_messages (association_id, kind, subject, body, claim_id) values ($1::uuid, 'claim_report', 'Claim', 'Body', $2::uuid) returning id`,
        [f.damen, claim.id],
      );
      await markSent(f.cyUser, msg.id);
      expect((await pgError(q(f.niaUser, `select public.delete_insurance_claim($1::uuid)`, [claim.id]))).code).toBe("42501");
      await q(f.cyUser, `select public.delete_insurance_claim($1::uuid)`, [claim.id]);
      expect(await count(`select 1 from public.document_links where target_id = '${claim.id}'`)).toBe(0);
      const m = await one<{ claim_id: string | null; status: string }>(
        null,
        `select claim_id, status::text from public.insurance_messages where id = $1::uuid`,
        [msg.id],
      );
      expect(m).toEqual({ claim_id: null, status: "sent" });
    });

    it("after delete, the document can be deleted", async () => {
      const documentId = await insuranceDoc(f.damen);
      const id = await savePolicy(f.cyUser, policyValues({ carrier_name: "Linked" }), { options: { document_id: documentId } });
      await expect(db.query(`delete from public.documents where id = $1::uuid`, [documentId])).rejects.toThrow(/foreign key/);
      await q(f.cyUser, `select public.delete_insurance_policy($1::uuid)`, [id]);
      const r = await q(f.cyUser, `delete from public.documents where id = $1::uuid`, [documentId]);
      expect(r.affectedRows).toBe(1);
    });

    it("set_insurance_read_item_skipped: skip then unskip; refuses an item already saved", async () => {
      const { readId } = await doneRead();
      const skip = (i: number, s: boolean) => q(f.cyUser, `select public.set_insurance_read_item_skipped($1::uuid, $2::int, $3::boolean)`, [readId, i, s]);
      const saved = async () =>
        (await one<{ saved: Record<string, unknown> }>(null, `select saved from public.insurance_document_reads where id = $1::uuid`, [readId])).saved;
      await skip(1, true);
      expect(await saved()).toEqual({ "1": { skipped: true } });
      await skip(1, false);
      expect(await saved()).toEqual({});
      // A save that got there first wins over a later skip.
      const id = await savePolicy(f.cyUser, policyValues(), { options: { read_id: readId, read_index: 0 } });
      expect((await pgError(skip(0, true))).code).toBe("22023");
      expect(await saved()).toEqual({ "0": { policy_id: id } });
      expect((await pgError(skip(-1, true))).code).toBe("22023");
      expect((await pgError(q(f.adaUser, `select public.set_insurance_read_item_skipped($1::uuid, 1, true)`, [readId]))).code).toBe("P0002");
    });

    it("create_insurance_quote_requests: n requests and n messages; a bad message inserts nothing; owner and hoyne contact refused", async () => {
      const a = await contact(f.damen, "Lakeside Agency");
      const b = await contact(f.damen, "Northside Agency");
      const rows = (await createRequests(f.cyUser, [a, b])).rows;
      expect(rows).toHaveLength(2);
      expect(await count(`select 1 from public.insurance_quote_requests where status = 'draft' and contact_id is not null`)).toBe(2);
      expect(await count(`select 1 from public.insurance_messages where kind = 'quote_request' and status = 'draft'`)).toBe(2);

      const bad = await pgError(
        createRequests(f.cyUser, [a, b], [
          { subject: "ok", body: "ok" },
          { subject: null, body: "no subject" },
        ]),
      );
      expect(bad.code).toBe("23502");
      expect(await count(`select 1 from public.insurance_quote_requests`)).toBe(2);
      expect(await count(`select 1 from public.insurance_messages`)).toBe(2);

      expect((await pgError(createRequests(f.adaUser, [a]))).code).toBe("42501");
      expect((await pgError(createRequests(f.cyUser, []))).code).toBe("22023");
      const hoyneContact = await contact(f.hoyne);
      expect(await pgError(createRequests(f.cyUser, [hoyneContact]))).toMatchObject({
        code: "42501",
        message: "contact belongs to a different association",
      });
    });

    it("mark_insurance_message_sent sets sent_at and approved_by and moves the draft request to sent; a second call raises 22023", async () => {
      const c = await contact(f.damen);
      const [req] = (await createRequests(f.cyUser, [c])).rows;
      await markSent(f.cyUser, req.message_id);
      const m = await one<{ status: string; sent_at: string | null; approved_by: string }>(
        null,
        `select status::text, sent_at, approved_by from public.insurance_messages where id = $1::uuid`,
        [req.message_id],
      );
      expect(m.status).toBe("sent");
      expect(m.sent_at).not.toBeNull();
      expect(m.approved_by).toBe(f.cyUser);
      const r = await one<{ status: string; sent_at: string | null }>(
        null,
        `select status, sent_at from public.insurance_quote_requests where id = $1::uuid`,
        [req.request_id],
      );
      expect(r.status).toBe("sent");
      expect(r.sent_at).not.toBeNull();
      expect((await pgError(markSent(f.cyUser, req.message_id))).code).toBe("22023");
      expect((await pgError(markSent(f.adaUser, req.message_id))).code).toBe("42501");
    });

    it("insurance_messages lock: approver is the caller; sent and cancelled emails are frozen; drafts edit", async () => {
      const ins = (status: string, approvedBy: string | null) =>
        q<{ id: string }>(
          f.cyUser,
          `insert into public.insurance_messages (association_id, kind, subject, body, status, approved_by, sent_at)
           values ($1::uuid, 'other', 'Hi', 'Body', $2::public.message_status, $3::uuid, case when $2 = 'sent' then now() end) returning id`,
          [f.damen, status, approvedBy],
        );
      expect((await pgError(ins("sent", f.boUser))).code).toBe("42501");

      const draft = (await ins("draft", null)).rows[0].id;
      const edit = await q(f.cyUser, `update public.insurance_messages set body = 'Edited' where id = $1::uuid`, [draft]);
      expect(edit.affectedRows).toBe(1);

      await markSent(f.cyUser, draft);
      for (const set of ["subject = 'x'", "body = 'x'", "to_email = 'x@y.test'", `facts_json = '{"a":1}'`]) {
        expect((await pgError(q(f.cyUser, `update public.insurance_messages set ${set} where id = $1::uuid`, [draft]))).code, set).toBe("22023");
      }

      const cancelled = (await ins("draft", null)).rows[0].id;
      await q(f.cyUser, `update public.insurance_messages set status = 'cancelled' where id = $1::uuid`, [cancelled]);
      expect((await pgError(q(f.cyUser, `update public.insurance_messages set body = 'x' where id = $1::uuid`, [cancelled]))).code).toBe("22023");
    });

    it("set_current_insurance_agent leaves exactly one current agent; a direct second one fails the unique index", async () => {
      const a = await contact(f.damen, "Lakeside Agency");
      const b = await contact(f.damen, "Northside Agency");
      await q(f.cyUser, `select public.set_current_insurance_agent($1::uuid)`, [a]);
      await q(f.cyUser, `select public.set_current_insurance_agent($1::uuid)`, [b]);
      const { rows } = await db.query<{ id: string }>(`select id from public.insurance_contacts where is_current_agent`);
      expect(rows.map((r) => r.id)).toEqual([b]);
      const e = await pgError(q(f.cyUser, `update public.insurance_contacts set is_current_agent = true where id = $1::uuid`, [a]));
      expect(e.code).toBe("23505");
      expect((await pgError(q(f.adaUser, `select public.set_current_insurance_agent($1::uuid)`, [a]))).code).toBe("42501");
    });

    it("insurance_contacts.source_urls with a javascript: URL is refused", async () => {
      const ins = (urls: string[]) =>
        q(f.cyUser, `insert into public.insurance_contacts (association_id, name, source_urls) values ($1::uuid, $2, $3::text[])`, [
          f.damen,
          `Found ${urls.length} ${urls[0]}`,
          urls,
        ]);
      expect((await pgError(ins(["javascript:alert(1)"]))).code).toBe("23514");
      expect((await pgError(ins(["https://ok.test/a", "javascript:alert(1)"]))).code).toBe("23514");
      expect((await ins(["https://ok.test/agency", "http://also.test"])).affectedRows).toBe(1);
      expect(
        (await pgError(q(f.cyUser, `insert into public.insurance_contacts (association_id, name, website_url) values ($1::uuid, 'Bad', 'javascript:x')`, [f.damen])))
          .code,
      ).toBe("23514");
    });

    it("update_insurance_building_basics: board_member updates the four columns; owner and hoyne board refused; no city parameter", async () => {
      const bo = await boBoard();
      const zara = await zaraBoard();
      const call = (user: string, assoc: string) =>
        q(user, `select public.update_insurance_building_basics($1::uuid, 1925::smallint, 'joisted_masonry', 4::smallint, 2015::smallint)`, [assoc]);
      await call(bo, f.damen);
      const a = await one<{ year_built: number; construction_type: string; stories: number; roof_replaced_year: number }>(
        null,
        `select year_built, construction_type, stories, roof_replaced_year from public.associations where id = $1::uuid`,
        [f.damen],
      );
      expect(a).toEqual({ year_built: 1925, construction_type: "joisted_masonry", stories: 4, roof_replaced_year: 2015 });
      expect((await pgError(call(f.adaUser, f.damen))).code).toBe("42501");
      expect((await pgError(call(zara, f.damen))).code).toBe("42501");
      const city = await pgError(
        q(bo, `select public.update_insurance_building_basics($1::uuid, 1925::smallint, 'frame', 4::smallint, 2015::smallint, 'Evanston')`, [f.damen]),
      );
      expect(city.code).toBe("42883");
      // The columns' own checks still apply.
      expect((await pgError(q(bo, `select public.update_insurance_building_basics($1::uuid, 1925::smallint, 'straw', 4::smallint, null)`, [f.damen]))).code).toBe(
        "23514",
      );
    });
  });

  // ---------------------------------------------------------- owner summary

  describe("owner summary", () => {
    const content = (deductible: string) => ({ version: 1, coverage_form: "single_entity", master_deductible: deductible });
    const publish = (user: string, c: unknown, assoc: string = f.damen) =>
      q(user, `select public.publish_insurance_owner_summary($1::uuid, $2::jsonb, $3::uuid, $4)`, [assoc, JSON.stringify(c), policyId, HASH]);
    const read = async (user: string, assoc: string = f.damen) =>
      (await one<{ s: Record<string, unknown> | null }>(user, `select public.owner_insurance_summary($1::uuid) as s`, [assoc])).s;

    it("owner_insurance_summary returns null before publish", async () => {
      expect(await read(f.adaUser)).toBeNull();
    });

    it("owner reads only the published snapshot; draft edits after publish are not visible until republish", async () => {
      await publish(f.cyUser, content("25000.00"));
      const s = await read(f.adaUser);
      expect(s).toMatchObject({ version: 1, master_deductible: "25000.00" });
      expect(s!.published_at).toBeTruthy();
      await q(f.cyUser, `update public.insurance_owner_summaries set draft = $2::jsonb where association_id = $1::uuid`, [
        f.damen,
        JSON.stringify(content("50000.00")),
      ]);
      expect(await read(f.adaUser)).toMatchObject({ master_deductible: "25000.00" });
      await publish(f.cyUser, content("50000.00"));
      expect(await read(f.adaUser)).toMatchObject({ master_deductible: "50000.00" });
    });

    it("publish stores source_policy_id and source_hash", async () => {
      await publish(f.cyUser, content("25000.00"));
      const r = await one<{ source_policy_id: string; source_hash: string; published_by: string }>(
        null,
        `select source_policy_id, source_hash, published_by from public.insurance_owner_summaries where association_id = $1::uuid`,
        [f.damen],
      );
      expect(r).toEqual({ source_policy_id: policyId, source_hash: HASH, published_by: f.cyUser });
      expect((await pgError(publish(f.cyUser, { version: 2 }))).code).toBe("22023");
    });

    it("owner cannot select insurance_owner_summaries directly", async () => {
      await publish(f.cyUser, content("25000.00"));
      expect((await q(f.adaUser, `select id from public.insurance_owner_summaries`)).rows).toHaveLength(0);
    });

    it("hoyne member gets null for damen's summary", async () => {
      await publish(f.cyUser, content("25000.00"));
      expect(await read(f.zaraUser)).toBeNull();
    });

    it("publish by owner refused; by accountant refused", async () => {
      expect((await pgError(publish(f.adaUser, content("1.00")))).code).toBe("42501");
      expect((await pgError(publish(f.niaUser, content("1.00")))).code).toBe("42501");
    });

    it("unpublish hides it", async () => {
      await publish(f.cyUser, content("25000.00"));
      await q(
        f.cyUser,
        `update public.insurance_owner_summaries set published = null, published_at = null, published_by = null where association_id = $1::uuid`,
        [f.damen],
      );
      expect(await read(f.adaUser)).toBeNull();
    });
  });

  // --------------------------------------------------------- owner requests

  describe("owner requests", () => {
    const ask = (user: string, assoc: string = f.damen, kind = "certificate") =>
      one<{ id: string }>(user, `select public.request_insurance_proof($1::uuid, $2, $3) as id`, [assoc, kind, "  For my lender  "]);

    it("request_insurance_proof by an owner inserts a row with her person_id", async () => {
      const { id } = await ask(f.adaUser);
      const r = await one<{ person_id: string; status: string; note: string; kind: string }>(
        null,
        `select person_id, status, note, kind from public.insurance_owner_requests where id = $1::uuid`,
        [id],
      );
      expect(r).toEqual({ person_id: f.adaPerson, status: "open", note: "For my lender", kind: "certificate" });
      expect((await pgError(ask(f.adaUser, f.damen, "refund"))).code).toBe("22023");
    });

    it("owner cannot select insurance_owner_requests directly, but my_insurance_proof_requests returns her own and not Bo's", async () => {
      const mine = await ask(f.adaUser);
      await ask(f.boUser);
      expect((await q(f.adaUser, `select id from public.insurance_owner_requests`)).rows).toHaveLength(0);
      await expect(
        q(f.adaUser, `insert into public.insurance_owner_requests (association_id, person_id) values ($1::uuid, $2::uuid)`, [f.damen, f.adaPerson]),
      ).rejects.toThrow(/row-level security/);
      const { rows } = await q<{ id: string }>(f.adaUser, `select id from public.my_insurance_proof_requests($1::uuid)`, [f.damen]);
      expect(rows.map((r) => r.id)).toEqual([mine.id]);
    });

    it("a fourth request in a day is refused", async () => {
      await ask(f.adaUser);
      await ask(f.adaUser);
      await ask(f.adaUser, f.damen, "question");
      expect((await pgError(ask(f.adaUser))).code).toBe("22023");
    });

    it("hoyne member cannot request for damen", async () => {
      expect((await pgError(ask(f.zaraUser, f.damen))).code).toBe("42501");
    });

    it("board reads and closes a request; marking a linked email sent closes it", async () => {
      const a = await ask(f.adaUser);
      const b = await ask(f.boUser);
      expect((await q(f.cyUser, `select id from public.insurance_owner_requests`)).rows).toHaveLength(2);
      const closed = await q(
        f.cyUser,
        `update public.insurance_owner_requests set status = 'dismissed', handled_by = auth.uid(), handled_at = now() where id = $1::uuid and status = 'open'`,
        [a.id],
      );
      expect(closed.affectedRows).toBe(1);
      const msg = await one<{ id: string }>(
        f.cyUser,
        `insert into public.insurance_messages (association_id, kind, subject, body) values ($1::uuid, 'certificate_request', 'Certificate', 'Please') returning id`,
        [f.damen],
      );
      await q(f.cyUser, `update public.insurance_owner_requests set message_id = $2::uuid where id = $1::uuid`, [b.id, msg.id]);
      await markSent(f.cyUser, msg.id);
      const r = await one<{ status: string; handled_by: string }>(
        null,
        `select status, handled_by from public.insurance_owner_requests where id = $1::uuid`,
        [b.id],
      );
      expect(r).toEqual({ status: "done", handled_by: f.cyUser });
    });
  });

  // -------------------------------------------------- RLS on each new table

  describe("RLS per new table", () => {
    const TABLES: { table: string; insert: string }[] = [
      { table: "insurance_contacts", insert: `insert into public.insurance_contacts (association_id, name) values ($1::uuid, 'RLS Agency') returning id` },
      {
        table: "insurance_messages",
        insert: `insert into public.insurance_messages (association_id, kind, subject, body) values ($1::uuid, 'other', 'Hello', 'Body') returning id`,
      },
      { table: "insurance_building_facts", insert: `insert into public.insurance_building_facts (association_id) values ($1::uuid) returning id` },
      { table: "insurance_owner_summaries", insert: `insert into public.insurance_owner_summaries (association_id) values ($1::uuid) returning id` },
      {
        table: "insurance_finding_dismissals",
        insert: `insert into public.insurance_finding_dismissals (association_id, rule_id, reason) values ($1::uuid, 'CP-DED-01', 'Checked with our agent') returning id`,
      },
    ];

    for (const t of TABLES) {
      describe(t.table, () => {
        const visible = async (user: string) => (await q(user, `select id from public.${t.table}`)).rows.length;

        it("readers read; owners and an expired accountant don't", async () => {
          await q(f.cyUser, t.insert, [f.damen]);
          expect(await visible(f.cyUser)).toBe(1);
          expect(await visible(f.niaUser)).toBe(1);
          expect(await visible(f.adaUser)).toBe(0);
          expect(await visible(f.vicUser)).toBe(0);
        });

        it("board writes; an accountant can't", async () => {
          await expect(q(f.niaUser, t.insert, [f.damen])).rejects.toThrow(/row-level security/);
          expect((await q(f.cyUser, t.insert, [f.damen])).rows).toHaveLength(1);
        });

        it(`board_admin deletes${t.table === "insurance_finding_dismissals" ? "; a board_member deletes too" : "; a board_member can't"}`, async () => {
          const bo = await boBoard();
          const { rows } = await q<{ id: string }>(f.cyUser, t.insert, [f.damen]);
          const del = (user: string) => q(user, `delete from public.${t.table} where id = $1::uuid`, [rows[0].id]);
          if (t.table === "insurance_finding_dismissals") {
            expect((await del(bo)).affectedRows).toBe(1);
          } else {
            expect((await del(bo)).affectedRows).toBe(0);
            expect((await del(f.cyUser)).affectedRows).toBe(1);
          }
        });

        it("cross-association: hoyne board sees no damen rows and can't insert into damen", async () => {
          const zara = await zaraBoard();
          await q(f.cyUser, t.insert, [f.damen]);
          expect(await visible(zara)).toBe(0);
          await expect(q(zara, t.insert, [f.damen])).rejects.toThrow(/row-level security/);
        });

        it("audit rows are written for each insert", async () => {
          const before = await count(`select 1 from public.audit_log where table_name = '${t.table}'`);
          await q(f.cyUser, t.insert, [f.damen]);
          expect(await count(`select 1 from public.audit_log where table_name = '${t.table}' and actor_user_id = '${f.cyUser}'`)).toBe(before + 1);
        });
      });
    }

    it("reads and research are board only and not audited", async () => {
      await queuedRead();
      await q(f.cyUser, `insert into public.insurance_market_research (association_id, kind) values ($1::uuid, 'insurers')`, [f.damen]);
      expect((await q(f.adaUser, `select id from public.insurance_document_reads`)).rows).toHaveLength(0);
      expect(await count(`select 1 from public.audit_log where table_name in ('insurance_document_reads', 'insurance_market_research')`)).toBe(0);
    });
  });

  // ------------------------------------------------------------------- view

  describe("view", () => {
    it("insurance_year_over_year excludes archived policies", async () => {
      const carrierA = await one<{ id: string }>(null, `select id from public.insurance_policies where carrier_name = 'Carrier A'`);
      const rows = async () =>
        (
          await q<{ carrier_name: string; previous_premium: string | null }>(
            f.cyUser,
            `select carrier_name, previous_premium::text from public.insurance_year_over_year
              where association_id = $1::uuid and coverage = 'property' order by effective_from`,
            [f.damen],
          )
        ).rows;
      expect((await rows()).map((r) => r.carrier_name)).toEqual(["Carrier A", "Carrier B", "West Bend"]);
      await q(f.cyUser, `select public.archive_insurance_policy($1::uuid, true)`, [carrierA.id]);
      const after = await rows();
      expect(after.map((r) => r.carrier_name)).toEqual(["Carrier B", "West Bend"]);
      expect(after[0].previous_premium).toBeNull();
    });
  });
});

// ----------------------------------------------------------------- backfill

describe("insurance v2 backfill (0052 on top of 0041-era data)", () => {
  let db: PGlite;
  let f: Fixture;

  const P = {
    agency: "9a000000-0000-0000-0000-000000000001",
    agent: "9a000000-0000-0000-0000-000000000002",
    umbrellaOld: "9a000000-0000-0000-0000-000000000003",
    umbrellaNew: "9a000000-0000-0000-0000-000000000004",
    floodA: "9a000000-0000-0000-0000-000000000005",
    floodB: "9a000000-0000-0000-0000-000000000006",
    orphan: "9a000000-0000-0000-0000-000000000007",
    pkg: "9a000000-0000-0000-0000-000000000008",
  } as const;
  const PARTNER = "9b000000-0000-0000-0000-000000000001";
  const REQUEST = "9c000000-0000-0000-0000-000000000001";
  const BILL_EARLY = "9d000000-0000-0000-0000-000000000001";
  const BILL_LATE = "9d000000-0000-0000-0000-000000000002";
  const OP_FUND = "ffff0000-0000-0000-0000-000000000001";
  const CASH = "acc00000-0000-0000-0000-000000001000";

  beforeEach(async () => {
    db = await freshDb({ before: "0052" });
    f = await seed(db);
    const d = f.damen;
    await db.exec(`
      insert into public.insurance_policies
        (id, association_id, coverage, carrier_name, agency_name, broker_name, broker_email, agent_phone,
         effective_from, effective_to, annual_premium, liability_per_occurrence, do_limit, replaced_at, created_at)
      values
        ('${P.agency}', '${d}', 'general_liability', 'Acuity', 'Lakeside Agency', 'Pat Doe', 'pat@lakeside.test', '312-555-0100',
         current_date - 200, current_date + 165, 900.00, null, 1000000.00, null, '2025-01-01'),
        ('${P.agent}', '${d}', 'directors_officers', 'Travelers', '  ', 'Sam Roe', 'not-an-email', null,
         current_date - 30, current_date + 335, 700.00, null, 1000000.00, null, '2025-01-02'),
        ('${P.umbrellaOld}', '${d}', 'umbrella', 'Old Umbrella', null, null, null, null,
         '2024-01-01', '2025-01-01', 500.00, null, null, now(), '2024-01-01'),
        ('${P.umbrellaNew}', '${d}', 'umbrella', 'New Umbrella', null, null, null, null,
         '2025-01-01', '2026-01-01', 550.00, null, null, null, '2025-01-01'),
        ('${P.floodA}', '${d}', 'flood', 'Flood A', null, null, null, null,
         '2025-05-01', '2026-05-01', 300.00, null, null, now(), '2025-04-01 10:00'),
        ('${P.floodB}', '${d}', 'flood', 'Flood B', null, null, null, null,
         '2025-05-01', '2026-05-01', 300.00, null, null, now(), '2025-04-01 11:00'),
        ('${P.orphan}', '${d}', 'workers_comp', 'Orphan Comp', null, null, null, null,
         '2025-01-01', '2026-01-01', 200.00, null, null, now(), '2025-01-01'),
        ('${P.pkg}', '${d}', 'property', 'Package Co', null, null, null, null,
         '2023-01-01', '2024-01-01', 2000.00, 1000000.00, 1000000.00, null, '2023-01-01');

      insert into public.insurance_policy_field_sources (association_id, policy_id, field_name, source, raw_text_snippet)
      values ('${d}', '${P.agency}', 'liability_per_occurrence', 'extracted', repeat('x', 300));

      insert into public.insurance_partners (id, name, contact_email, states_served)
      values ('${PARTNER}', 'Midwest Brokers', 'quotes@midwest.test', '{IL}');
      insert into public.insurance_quote_requests (id, association_id, policy_id, partner_id, payload_json)
      values ('${REQUEST}', '${d}', '${P.agency}', '${PARTNER}', '{}');

      insert into public.recurring_bills (id, association_id, name, account_id, fund_id, frequency, typical_amount, notes, created_at)
      values
        ('${BILL_LATE}',  '${d}', 'Travelers insurance', '${CASH}', '${OP_FUND}', 'annual', 700.00, 'Premium for the directors officers policy.', '2025-02-02'),
        ('${BILL_EARLY}', '${d}', 'Travelers insurance', '${CASH}', '${OP_FUND}', 'annual', 700.00, 'Premium for the directors officers policy.', '2025-02-01');
    `);
    await applyMigrations(db, { from: "0052" });
  });

  afterEach(async () => {
    await db.close();
  });

  const contactsOf = async () =>
    (
      await db.query<{ id: string; kind: string; name: string; person_name: string | null; email: string | null; source: string; is_current_agent: boolean; partner_id: string | null }>(
        `select id, kind, name, person_name, email, source, is_current_agent, partner_id from public.insurance_contacts order by name`,
      )
    ).rows;

  const policy = async (id: string) =>
    (
      await db.query<{ agent_contact_id: string | null; replaced_by_policy_id: string | null; replaced_at: string | null; included_sections: string[] }>(
        `select agent_contact_id, replaced_by_policy_id, replaced_at, included_sections from public.insurance_policies where id = $1::uuid`,
        [id],
      )
    ).rows[0];

  it("policy agent becomes a contact and agent_contact_id is set", async () => {
    const cs = await contactsOf();
    const lakeside = cs.find((c) => c.name === "Lakeside Agency")!;
    expect(lakeside).toMatchObject({ kind: "agency", person_name: "Pat Doe", email: "pat@lakeside.test", source: "policy" });
    // A blank agency and an invalid email are treated as missing.
    const sam = cs.find((c) => c.name === "Sam Roe")!;
    expect(sam).toMatchObject({ kind: "agent", person_name: null, email: null, source: "policy" });
    expect((await policy(P.agency)).agent_contact_id).toBe(lakeside.id);
    expect((await policy(P.agent)).agent_contact_id).toBe(sam.id);
    expect((await policy(P.umbrellaOld)).agent_contact_id).toBeNull();
  });

  it("two in-force policies with different agents give exactly one current agent (the latest-starting)", async () => {
    const current = (await contactsOf()).filter((c) => c.is_current_agent);
    expect(current.map((c) => c.name)).toEqual(["Sam Roe"]);
  });

  it("partner requests get a partner contact and contact_id", async () => {
    const partner = (await contactsOf()).find((c) => c.source === "partner")!;
    expect(partner).toMatchObject({ kind: "broker", name: "Midwest Brokers", email: "quotes@midwest.test", partner_id: PARTNER });
    const r = (
      await db.query<{ contact_id: string; coverages: string[] }>(`select contact_id, coverages from public.insurance_quote_requests where id = $1::uuid`, [
        REQUEST,
      ])
    ).rows[0];
    expect(r).toEqual({ contact_id: partner.id, coverages: ["general_liability"] });
  });

  it("0041 replaced policy gets replaced_by_policy_id (successor strictly later)", async () => {
    expect((await policy(P.umbrellaOld)).replaced_by_policy_id).toBe(P.umbrellaNew);
    expect((await policy(P.umbrellaNew)).replaced_by_policy_id).toBeNull();
  });

  it("two same-day replaced duplicates don't point at each other", async () => {
    const a = await policy(P.floodA);
    const b = await policy(P.floodB);
    expect(a.replaced_by_policy_id).toBe(P.floodB);
    expect(b.replaced_by_policy_id).toBeNull();
  });

  it("a replaced policy with no successor keeps replaced_at and a null link", async () => {
    const o = await policy(P.orphan);
    expect(o.replaced_at).not.toBeNull();
    expect(o.replaced_by_policy_id).toBeNull();
  });

  it("duplicate premium bills: earliest linked, later ones untouched and active", async () => {
    const { rows } = await db.query<{ id: string; insurance_policy_id: string | null; is_active: boolean }>(
      `select id, insurance_policy_id, is_active from public.recurring_bills where name = 'Travelers insurance' order by created_at`,
    );
    expect(rows).toEqual([
      { id: BILL_EARLY, insurance_policy_id: P.agent, is_active: true },
      { id: BILL_LATE, insurance_policy_id: null, is_active: true },
    ]);
    // The unique index exists after the backfill.
    await expect(db.query(`update public.recurring_bills set insurance_policy_id = $1::uuid where id = $2::uuid`, [P.agent, BILL_LATE])).rejects.toThrow(
      /recurring_bills_insurance_policy_key/,
    );
  });

  it("included_sections backfilled from held values", async () => {
    expect((await policy(P.pkg)).included_sections).toEqual(["property", "property_deductibles", "liability", "do"]);
    expect((await policy(P.agency)).included_sections).toEqual(["liability", "do"]);
    expect((await policy(P.agent)).included_sections).toEqual(["do"]);
    expect((await policy(P.orphan)).included_sections).toEqual(["workers_comp"]);
    const seedProperty = (
      await db.query<{ included_sections: string[] }>(`select included_sections from public.insurance_policies where carrier_name = 'Carrier A'`)
    ).rows[0];
    expect(seedProperty.included_sections).toEqual(["property", "property_deductibles"]);
  });

  it("long 0041 snippets are cut to 240 characters", async () => {
    const { rows } = await db.query<{ n: number }>(`select length(raw_text_snippet) as n from public.insurance_policy_field_sources`);
    expect(rows).toEqual([{ n: 240 }]);
  });

  it("updated_at reflects the last real change, not the migration", async () => {
    const { rows } = await db.query<{ ok: boolean }>(
      `select updated_at = coalesce(last_reviewed_at, created_at) as ok from public.insurance_policies where id = $1::uuid`,
      [P.agency],
    );
    expect(rows[0].ok).toBe(true);
  });
});
