import type { PGlite } from "@electric-sql/pglite";

/**
 * The awkward-on-purpose fixture from DECISIONS #12.
 *
 * Two associations, so cross-tenant leakage is testable. Inside Damen:
 * Ada owns unit 1, Bo owns unit 2 and is delinquent, Cy is a board_admin who
 * ALSO owns unit 3 — the multi-role case that the original schema could not
 * represent (DECISIONS #6). Vic is an accountant whose grant has expired.
 */
export type Fixture = Awaited<ReturnType<typeof seed>>;

export async function seed(db: PGlite) {
  const ids = {
    damen: "11111111-1111-1111-1111-111111111111",
    hoyne: "22222222-2222-2222-2222-222222222222",
    unit1: "aaaa1111-0000-0000-0000-000000000001",
    unit2: "aaaa1111-0000-0000-0000-000000000002",
    unit3: "aaaa1111-0000-0000-0000-000000000003",
    hoyneUnit: "bbbb2222-0000-0000-0000-000000000001",
    adaUser: "dddd0000-0000-0000-0000-00000000000a",
    boUser: "dddd0000-0000-0000-0000-00000000000b",
    cyUser: "dddd0000-0000-0000-0000-00000000000c",
    vicUser: "dddd0000-0000-0000-0000-00000000000d",
    zaraUser: "dddd0000-0000-0000-0000-00000000000e",
    niaUser: "dddd0000-0000-0000-0000-00000000000f",
    adaPerson: "eeee0000-0000-0000-0000-00000000000a",
    boPerson: "eeee0000-0000-0000-0000-00000000000b",
    cyPerson: "eeee0000-0000-0000-0000-00000000000c",
    vicPerson: "eeee0000-0000-0000-0000-00000000000d",
    zaraPerson: "eeee0000-0000-0000-0000-00000000000e",
    niaPerson: "eeee0000-0000-0000-0000-00000000000f",
    adaCharge: "cccc0000-0000-0000-0000-00000000000a",
    boCharge: "cccc0000-0000-0000-0000-00000000000b",
  } as const;

  await db.exec(`
    insert into auth.users (id, email) values
      ('${ids.adaUser}',  'ada@example.test'),
      ('${ids.boUser}',   'bo@example.test'),
      ('${ids.cyUser}',   'cy@example.test'),
      ('${ids.vicUser}',  'vic@example.test'),
      ('${ids.zaraUser}', 'zara@example.test'),
      ('${ids.niaUser}',  'nia@example.test');

    insert into associations (id, legal_name, display_name, state_code, incorporated_on)
    values
      ('${ids.damen}', '2158 N. Damen Condominium Association', '2158 N. Damen', 'IL', '2004-03-11'),
      ('${ids.hoyne}', '1900 N. Hoyne Condominium Association',  '1900 N. Hoyne', 'IL', '2011-09-02');

    insert into units (id, association_id, label, sort_order) values
      ('${ids.unit1}', '${ids.damen}', 'Unit 1', 1),
      ('${ids.unit2}', '${ids.damen}', 'Unit 2', 2),
      ('${ids.unit3}', '${ids.damen}', 'Unit 3', 3),
      ('${ids.hoyneUnit}', '${ids.hoyne}', 'Unit A', 1);

    insert into persons (id, association_id, full_name, email, auth_user_id) values
      ('${ids.adaPerson}',  '${ids.damen}', 'Ada Okonkwo', 'ada@example.test',  '${ids.adaUser}'),
      ('${ids.boPerson}',   '${ids.damen}', 'Bo Lindqvist','bo@example.test',   '${ids.boUser}'),
      ('${ids.cyPerson}',   '${ids.damen}', 'Cy Ferreira', 'cy@example.test',   '${ids.cyUser}'),
      ('${ids.vicPerson}',  '${ids.damen}', 'Vic Advani',  'vic@example.test',  '${ids.vicUser}'),
      ('${ids.zaraPerson}', '${ids.hoyne}', 'Zara Haddad', 'zara@example.test', '${ids.zaraUser}'),
      ('${ids.niaPerson}',  '${ids.damen}', 'Nia Bergström','nia@example.test',  '${ids.niaUser}');

    insert into unit_owners (association_id, unit_id, person_id, effective_from) values
      ('${ids.damen}', '${ids.unit1}', '${ids.adaPerson}',  '2020-01-01'),
      ('${ids.damen}', '${ids.unit2}', '${ids.boPerson}',   '2020-01-01'),
      ('${ids.damen}', '${ids.unit3}', '${ids.cyPerson}',   '2020-01-01'),
      ('${ids.hoyne}', '${ids.hoyneUnit}', '${ids.zaraPerson}', '2020-01-01');

    -- Cy holds two roles at once. This is the normal case in a self-managed
    -- building, and the shape the original schema could not express.
    insert into role_grants (association_id, person_id, role, granted_on, expires_on) values
      ('${ids.damen}', '${ids.adaPerson}',  'owner',       '2020-01-01', null),
      ('${ids.damen}', '${ids.boPerson}',   'owner',       '2020-01-01', null),
      ('${ids.damen}', '${ids.cyPerson}',   'owner',       '2020-01-01', null),
      ('${ids.damen}', '${ids.cyPerson}',   'board_admin', '2024-01-01', null),
      ('${ids.damen}', '${ids.vicPerson}',  'accountant',  '2024-01-01', '2024-04-01'),
      ('${ids.damen}', '${ids.niaPerson}',  'accountant',  '2026-01-01', '2099-01-01'),
      ('${ids.hoyne}', '${ids.zaraPerson}', 'owner',       '2020-01-01', null);

    insert into funds (id, association_id, name, kind, is_restricted) values
      ('ffff0000-0000-0000-0000-000000000001', '${ids.damen}', 'Operating', 'operating', false),
      ('ffff0000-0000-0000-0000-000000000002', '${ids.damen}', 'Reserve',   'reserve',   true);

    insert into fiscal_years (id, association_id, label, starts_on, ends_on) values
      ('f1500000-0000-0000-0000-000000000001', '${ids.damen}', '2026', '2026-01-01', '2026-12-31');

    insert into accounts
      (id, association_id, code, name, type, is_cash_account, is_exempt_function_income, is_exempt_expenditure)
    values
      ('acc00000-0000-0000-0000-000000001000', '${ids.damen}', '1000', 'Operating Cash',        'asset',  true,  null, null),
      ('acc00000-0000-0000-0000-000000001200', '${ids.damen}', '1200', 'Assessments Receivable','asset',  false, null, null),
      ('acc00000-0000-0000-0000-000000004000', '${ids.damen}', '4000', 'Regular Assessments',   'income', false, true, null);

    -- A real ledger entry, so that "an owner cannot reach the ledger" is not
    -- passing merely because journal_lines is empty.
    insert into journal_entries
      (id, association_id, fiscal_year_id, entry_date, memo, source, is_posted, posted_at)
    values
      ('3e000000-0000-0000-0000-000000000001', '${ids.damen}',
       'f1500000-0000-0000-0000-000000000001', '2026-01-01',
       'January assessments', 'assessment', true, now());

    insert into journal_lines
      (association_id, journal_entry_id, account_id, fund_id, unit_id, debit, credit)
    values
      ('${ids.damen}', '3e000000-0000-0000-0000-000000000001',
       'acc00000-0000-0000-0000-000000001200', 'ffff0000-0000-0000-0000-000000000001',
       '${ids.unit2}', 750.00, 0),
      ('${ids.damen}', '3e000000-0000-0000-0000-000000000001',
       'acc00000-0000-0000-0000-000000004000', 'ffff0000-0000-0000-0000-000000000001',
       '${ids.unit2}', 0, 750.00);

    -- Bo is behind. Ada is not. That difference is the whole point of the test.
    insert into assessment_charges
      (id, association_id, unit_id, charge_type, period_start, due_on, amount) values
      ('${ids.adaCharge}', '${ids.damen}', '${ids.unit1}', 'assessment', '2026-01-01', '2026-01-01', 500.00),
      ('${ids.boCharge}',  '${ids.damen}', '${ids.unit2}', 'assessment', '2026-01-01', '2026-01-01', 750.00);
  `);

  return ids;
}
