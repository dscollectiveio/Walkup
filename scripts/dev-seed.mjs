/**
 * Development data for 2158 N. Damen — a test fixture, not real financials
 * (docs/DECISIONS.md #12).
 *
 * Chosen to be awkward on purpose, because a tidy fixture proves nothing:
 *   - Bo is two months delinquent, which drags the cash-basis 60% ratio down
 *   - reserve interest is non-exempt income inside a restricted fund
 *   - a $6,200 roof repair is over the capitalization threshold
 *   - Cy is a board_admin who also owns a unit
 */

const A = "11111111-1111-1111-1111-111111111111";
const FY = "f1500000-0000-0000-0000-000000000001";

const U = {
  one: "aaaa1111-0000-0000-0000-000000000001",
  two: "aaaa1111-0000-0000-0000-000000000002",
  three: "aaaa1111-0000-0000-0000-000000000003",
};

const USER = {
  ada: "dddd0000-0000-0000-0000-00000000000a",
  bo: "dddd0000-0000-0000-0000-00000000000b",
  cy: "dddd0000-0000-0000-0000-00000000000c",
  nia: "dddd0000-0000-0000-0000-00000000000d",
};

const P = {
  ada: "eeee0000-0000-0000-0000-00000000000a",
  bo: "eeee0000-0000-0000-0000-00000000000b",
  cy: "eeee0000-0000-0000-0000-00000000000c",
  nia: "eeee0000-0000-0000-0000-00000000000d",
};

export const DEV_USERS = [
  { id: USER.cy, name: "Cy Ferreira", role: "board_admin + owner, Unit 3" },
  { id: USER.ada, name: "Ada Okonkwo", role: "owner, Unit 1" },
  { id: USER.bo, name: "Bo Lindqvist", role: "owner, Unit 2 (delinquent)" },
  { id: USER.nia, name: "Nia Bergström", role: "accountant" },
];

export async function seedDev(db) {
  await db.exec(`
    insert into auth.users (id, email) values
      ('${USER.ada}','ada@example.test'),
      ('${USER.bo}','bo@example.test'),
      ('${USER.cy}','cy@example.test'),
      ('${USER.nia}','nia@example.test');

    insert into associations
      (id, legal_name, display_name, state_code, city, county, ein,
       incorporated_on, fiscal_year_end_month)
    values
      ('${A}', '2158 N. Damen Condominium Association', '2158 N. Damen',
       'IL', 'Chicago', 'Cook', '36-4412290', '2004-03-11', 12);

    insert into units (id, association_id, label, sort_order) values
      ('${U.one}','${A}','Unit 1',1),
      ('${U.two}','${A}','Unit 2',2),
      ('${U.three}','${A}','Unit 3',3);

    insert into persons (id, association_id, full_name, email, auth_user_id) values
      ('${P.ada}','${A}','Ada Okonkwo','ada@example.test','${USER.ada}'),
      ('${P.bo}','${A}','Bo Lindqvist','bo@example.test','${USER.bo}'),
      ('${P.cy}','${A}','Cy Ferreira','cy@example.test','${USER.cy}'),
      ('${P.nia}','${A}','Nia Bergström','nia@example.test','${USER.nia}');

    insert into unit_owners (association_id, unit_id, person_id, effective_from) values
      ('${A}','${U.one}','${P.ada}','2019-06-01'),
      ('${A}','${U.two}','${P.bo}','2021-02-15'),
      ('${A}','${U.three}','${P.cy}','2016-09-30');

    insert into role_grants (association_id, person_id, role, granted_on, expires_on) values
      ('${A}','${P.ada}','owner','2019-06-01',null),
      ('${A}','${P.bo}','owner','2021-02-15',null),
      ('${A}','${P.cy}','owner','2016-09-30',null),
      ('${A}','${P.cy}','board_admin','2023-01-01',null),
      ('${A}','${P.nia}','accountant','2026-01-15','2026-12-31');

    insert into fiscal_years (id, association_id, label, starts_on, ends_on) values
      ('${FY}','${A}','2026','2026-01-01','2026-12-31');
  `);

  // Seeding runs as board_admin so the SECURITY DEFINER seed functions accept
  // it — the same path the real onboarding flow will take.
  await db.exec(`
    select set_config('request.jwt.claim.sub', '${USER.cy}', false);
    select public.seed_default_funds('${A}');
    select public.seed_chart_of_accounts('${A}');
  `);

  const acct = async (code) => {
    const { rows } = await db.query(
      `select id from accounts where association_id=$1 and code=$2`,
      [A, code],
    );
    return rows[0].id;
  };
  const fund = async (name) => {
    const { rows } = await db.query(
      `select id from funds where association_id=$1 and name=$2`,
      [A, name],
    );
    return rows[0].id;
  };

  const [cash, reserveCash, ar, assessments, interest, laundry, insurance, utilities,
         repairs, improvements, taxExpense] = await Promise.all([
    acct("1000"), acct("1010"), acct("1200"), acct("4000"), acct("4100"),
    acct("4110"), acct("5000"), acct("5010"), acct("5020"), acct("1500"), acct("5900"),
  ]);
  const [operating, reserve] = await Promise.all([fund("Operating"), fund("Reserve")]);

  const post = async (date, memo, lines, source = "manual") => {
    const { rows } = await db.query(
      `select public.post_journal_entry($1::uuid,$2::uuid,$3::date,$4,$5,$6::jsonb) as id`,
      [A, FY, date, memo, source, JSON.stringify(lines)],
    );
    return rows[0].id;
  };

  // Opening balances. An association does not begin the year at zero, and
  // without these the reserve cannot fund the roof and operating goes
  // overdrawn. The credit leg is equity, not income, so these correctly
  // contribute nothing to the 60% test.
  const [opFundBalance, resFundBalance] = await Promise.all([acct("3000"), acct("3100")]);
  await post("2026-01-01", "Opening balance — operating", [
    { account_id: cash, fund_id: operating, debit: 8000.0 },
    { account_id: opFundBalance, fund_id: operating, credit: 8000.0 },
  ]);
  await post("2026-01-01", "Opening balance — reserve", [
    { account_id: reserveCash, fund_id: reserve, debit: 22000.0 },
    { account_id: resFundBalance, fund_id: reserve, credit: 22000.0 },
  ]);

  const MONTHLY = { [U.one]: 425, [U.two]: 500, [U.three]: 475 };
  const months = ["01", "02", "03", "04", "05", "06"];

  for (const m of months) {
    const due = `2026-${m}-01`;
    for (const [unit, amount] of Object.entries(MONTHLY)) {
      const entry = await post(
        due,
        `Assessment ${due} — ${unit === U.one ? "Unit 1" : unit === U.two ? "Unit 2" : "Unit 3"}`,
        [
          { account_id: ar, fund_id: operating, unit_id: unit, debit: amount },
          { account_id: assessments, fund_id: operating, unit_id: unit, credit: amount },
        ],
        "assessment",
      );
      await db.query(
        `insert into assessment_charges
           (association_id, unit_id, charge_type, period_start, due_on, amount, journal_entry_id)
         values ($1,$2,'assessment',$3,$3,$4,$5)`,
        [A, unit, due, amount, entry],
      );
    }
  }

  // Ada and Cy pay every month. Bo stops after April — two months down.
  const { rows: charges } = await db.query(
    `select id, unit_id, amount, due_on from assessment_charges
      where association_id=$1 order by due_on`,
    [A],
  );

  for (const c of charges) {
    const skip = c.unit_id === U.two && ["2026-05-01", "2026-06-01"].includes(
      c.due_on instanceof Date ? c.due_on.toISOString().slice(0, 10) : String(c.due_on).slice(0, 10),
    );
    if (skip) continue;

    const entry = await post(
      c.due_on,
      `Payment received`,
      [
        { account_id: cash, fund_id: operating, unit_id: c.unit_id, debit: c.amount },
        { account_id: ar, fund_id: operating, unit_id: c.unit_id, credit: c.amount },
      ],
      "payment",
    );
    const { rows: pay } = await db.query(
      `insert into payments
         (association_id, unit_id, received_on, amount, method, fund_id, journal_entry_id)
       values ($1,$2,$3,$4,'check',$5,$6) returning id`,
      [A, c.unit_id, c.due_on, c.amount, operating, entry],
    );
    await db.query(
      `insert into payment_allocations (association_id, payment_id, charge_id, amount)
       values ($1,$2,$3,$4)`,
      [A, pay[0].id, c.id, c.amount],
    );
  }

  // Monthly reserve contribution: operating funds the reserve. Both legs are
  // cash accounts, so this correctly contributes nothing to either 1120-H
  // test — moving your own money is neither income nor an expenditure.
  for (const m of months) {
    await post(`2026-${m}-05`, "Monthly reserve contribution", [
      { account_id: reserveCash, fund_id: reserve, debit: 200.0 },
      { account_id: cash, fund_id: operating, credit: 200.0 },
    ], "transfer");
  }

  // Non-exempt income. Reserve interest is the reason a healthy association
  // can still edge toward the 60% threshold.
  await post("2026-03-31", "Reserve account interest — Q1", [
    { account_id: reserveCash, fund_id: reserve, debit: 118.4 },
    { account_id: interest, fund_id: reserve, credit: 118.4 },
  ]);
  await post("2026-06-30", "Reserve account interest — Q2", [
    { account_id: reserveCash, fund_id: reserve, debit: 124.15 },
    { account_id: interest, fund_id: reserve, credit: 124.15 },
  ]);
  await post("2026-06-30", "Coin laundry collection", [
    { account_id: cash, fund_id: operating, debit: 340.0 },
    { account_id: laundry, fund_id: operating, credit: 340.0 },
  ]);

  const expenses = [
    ["2026-01-15", "Annual property insurance premium", insurance, 4180.0, operating],
    ["2026-02-10", "Peoples Gas — common areas", utilities, 612.44, operating],
    ["2026-03-12", "ComEd — common areas", utilities, 288.19, operating],
    ["2026-04-02", "Gutter and downspout repair", repairs, 875.0, operating],
    ["2026-05-20", "Boiler service call", repairs, 430.0, operating],
  ];
  for (const [date, memo, account, amount, f] of expenses) {
    const entry = await post(date, memo, [
      { account_id: account, fund_id: f, debit: amount },
      { account_id: cash, fund_id: f, credit: amount },
    ], "expense");
    await db.query(
      `insert into expenses
         (association_id, account_id, fund_id, paid_on, amount, memo, journal_entry_id, is_capitalized)
       values ($1,$2,$3,$4,$5,$6,$7,false)`,
      [A, account, f, date, amount, memo, entry],
    );
  }

  // Over the $2,500 threshold, so capitalized to 1500 rather than expensed.
  // Still counts toward the 90% numerator (DECISIONS #2).
  const roof = await post("2026-06-15", "Roof membrane replacement — south slope", [
    { account_id: improvements, fund_id: reserve, debit: 6200.0 },
    { account_id: reserveCash, fund_id: reserve, credit: 6200.0 },
  ], "expense");
  await db.query(
    `insert into expenses
       (association_id, account_id, fund_id, paid_on, amount, memo, journal_entry_id, is_capitalized)
     values ($1,$2,$3,$4,$5,$6,$7,true)`,
    [A, improvements, reserve, "2026-06-15", 6200.0, "Roof membrane replacement", roof],
  );

  // Tax on last year's reserve interest, paid from operating (DECISIONS #13).
  await post("2026-04-15", "2025 Form 1120-H tax paid", [
    { account_id: taxExpense, fund_id: operating, debit: 64.0 },
    { account_id: cash, fund_id: operating, credit: 64.0 },
  ]);

  await db.exec(`select set_config('request.jwt.claim.sub', '', false);`);
}
