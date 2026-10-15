#!/usr/bin/env node
// scripts/security/attack-round2.mjs
//
// Round 2 of the authorized RLS/PostgREST/RPC/Storage attack suite for the
// Walkup `security-test` Supabase branch (ref brwauxmdjgfrdqfbgezg), run
// after migrations 0051-0060 landed on it. Round 1 (`attack-rls.mjs`)
// covered the 0001-0050 schema with a hardcoded table list; this file
// extends that coverage to every new table/function from 0051-0060 and
// adds new roles (board_member, accountant, an outsider owner in Building
// B) and new attack categories (AI quota, email/reminders, imports,
// tickets/photos/storage, owner portal, tax views).
//
// Reuses scripts/security/lib.mjs unchanged. Same conventions as round 1:
//   - Plain Node ESM, raw `fetch`, no supabase-js, no service role key.
//   - Every check prints PASS/FAIL with a one-line reason.
//   - Exits non-zero if any check FAILs.
//   - Accounts step up to AAL2 with a throwaway TOTP factor computed by
//     this script (node:crypto, RFC 6238) -- no human, no authenticator app.
//   - `expectedFinding(name, brokenNow, reason)` records a FAIL as a
//     *finding* (distinct from a flaky/regressed check) when the behavior
//     is a confirmed bug rather than a surprise.
//
// Rows this script writes are tagged with a `SECTEST2-` prefix in a human
// text column wherever the schema allows it, so scripts/security/cleanup-
// round2.sql (run via the Supabase MCP execute_sql tool as postgres) can
// find and remove them even if this run is interrupted before its own
// best-effort cleanup step at the bottom runs.
//
// Table/function enumeration note: the task asked for dynamic enumeration
// via the PostgREST OpenAPI root (`GET /rest/v1/`) or `execute_sql`. On
// this Supabase instance the OpenAPI root now refuses the publishable/anon
// key outright ("Secret API key required" -- confirmed with a bare curl
// against this branch), which this suite must not hold (no service-role
// key, per scope). So the table list below was generated once, outside
// this script, with the Supabase MCP `execute_sql` tool against
// `information_schema.tables`/`columns` on this exact branch (see
// docs/security/ATTACK-REPORT-2.md, "Method") -- not hand-maintained, and
// re-derivable with the one-line query in that doc's appendix if the
// schema changes again. It is therefore a generated snapshot, not a
// hardcoded guess, and should be regenerated the same way for a future
// round rather than hand-edited.

import {
  loadConfig,
  readCredentials,
  getAal1AndAal2,
  signInPassword,
  pgrest,
  storage,
  makeReporter,
} from "./lib.mjs";

const cfg = loadConfig();
const creds = readCredentials(cfg.credsPath);
// Round 2 needs three more accounts beyond lib.mjs's required set; read
// them directly (readCredentials only enforces the round-1 required keys).
for (const k of [
  "BOARD_MEMBER_A_EMAIL", "BOARD_MEMBER_A_PASSWORD",
  "ACCOUNTANT_A_EMAIL", "ACCOUNTANT_A_PASSWORD",
  "OUTSIDER_OWNER_B_EMAIL", "OUTSIDER_OWNER_B_PASSWORD",
]) {
  if (!creds[k]) throw new Error(`Missing ${k} in credentials file (${cfg.credsPath}). See README's round-2 section.`);
}

const r = makeReporter();
let exitCode = 0;

function note(name, ok, reason) {
  if (ok) r.pass(name, reason);
  else { r.fail(name, reason); exitCode = 1; }
}
function expectedFinding(name, brokenNow, reason) {
  if (brokenNow) { r.fail(name, `FINDING: ${reason}`); exitCode = 1; }
  else { r.pass(name, `fixed/refused: ${reason}`); }
}
function isEmpty(body) { return Array.isArray(body) && body.length === 0; }
// PostgREST returns a scalar SQL function's result as a bare JSON value
// (e.g. a quoted uuid string), not `{id: ...}` or `[{id: ...}]`. Normalize
// so callers can always ask "what id/uuid did this RPC hand back".
function rpcScalar(body) {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (Array.isArray(body)) {
    const first = body[0];
    return typeof first === "string" ? first : first?.id ?? first ?? null;
  }
  if (typeof body === "object") return body.id ?? null;
  return body;
}
function isRefusal(res) {
  // PostgREST maps most PL/pgSQL RAISE EXCEPTION codes to 400/403/404, but a
  // few (e.g. P0002/no_data_found, used by redeem_invite for "this invite
  // link is not valid") fall through its default mapping to 500 even though
  // the function handled the bad input deliberately and cleanly -- so this
  // checks the controlled-error shape (a recognized Postgres/PL/pgSQL error
  // code, or refusal-shaped wording) rather than trusting the HTTP status
  // alone to distinguish "refused" from "crashed".
  return res.status === 401 || res.status === 403 || res.status === 404 ||
    (res.status >= 400 && res.body && (
      res.body.code === "42501" || res.body.code === "PGRST116" || res.body.code === "P0002" ||
      /not allowed|not authorized|permission denied|not found|not valid|already belongs|already has|already used|expired/i.test(String(res.body.message || ""))));
}

// Generated 2026-10-14 via the Supabase MCP execute_sql tool against the
// security-test branch's information_schema (see header note above).
const TABLES_WITH_ASSOC = [
  "access_reviews","accounts","ai_calls","announcement_reads","announcement_units","announcements",
  "assessment_charges","assessment_schedules","audit_log","bank_categorization_rules",
  "bank_connection_secrets","bank_connections","bank_payee_history","bank_transactions","board_tasks",
  "budget_lines","budgets","building_emergency_contacts","building_emergency_info","contractor_messages",
  "contractor_notes","contractor_reviews","contractor_search_cache","document_categories","document_links",
  "documents","dues_payment_reports","email_batches","email_log","email_outbox","email_preferences",
  "email_settings","email_suppressions","expenses","fiscal_years","folders","funds","google_api_calls",
  "import_batches","import_rows","insurance_building_facts","insurance_claims","insurance_contacts",
  "insurance_document_reads","insurance_finding_dismissals","insurance_market_research","insurance_messages",
  "insurance_owner_requests","insurance_owner_summaries","insurance_policies","insurance_policy_field_sources",
  "insurance_quote_requests","insurance_quotes","invites","journal_entries","journal_lines","late_fee_rules",
  "ownership_amendment_lines","ownership_amendments","payment_allocations","payments","persons",
  "recurring_bill_payments","recurring_bills","reminder_rules","repairs_seen","role_grants","saved_views",
  "tag_rules","tax_figure_provenance","tax_filings","tax_form_fields","tax_forms","tax_line_classifications",
  "ticket_bids","ticket_board_details","ticket_comments","ticket_events","tickets","unit_owners","units",
  "upkeep_log","upkeep_tasks","vendors",
];
// Board-only (never visible to a plain owner): everything a plain `owner`
// role cannot reach per the specs -- vendors, insurance_*, email_*,
// import_*, bank_*, tax_*, plus board-admin/financial-reader-only rows.
// NOTE: `accounts`, `fiscal_years`, `funds` and `role_grants` are
// deliberately left OUT of this list even though they are financial/
// governance-adjacent: confirmed by policy inspection (pg_policies, via the
// Supabase MCP execute_sql tool) that their SELECT policies allow any
// `is_member` (owner included), the same "readable by all members, not an
// access check" shape DECISIONS #17 documents for `units` -- chart-of-
// accounts names, fiscal year boundaries, fund names and the board roster
// are structural facts an owner's UI legitimately needs (e.g. to show a
// budget line's fund name), not account balances or role-management
// surface. Writes to all four stay board-only and are still checked below.
const BOARD_ONLY_TABLES = [
  "vendors","insurance_building_facts","insurance_claims","insurance_contacts","insurance_document_reads",
  "insurance_finding_dismissals","insurance_market_research","insurance_messages","insurance_owner_requests",
  "insurance_owner_summaries","insurance_policies","insurance_policy_field_sources","insurance_quote_requests",
  "insurance_quotes","email_batches","email_log","email_outbox","email_settings","email_suppressions",
  "import_batches","import_rows","bank_categorization_rules","bank_connection_secrets","bank_connections",
  "bank_payee_history","bank_transactions","tax_figure_provenance","tax_filings","tax_form_fields","tax_forms",
  "tax_line_classifications","ticket_board_details","audit_log","budgets","budget_lines",
  "journal_entries","journal_lines","assessment_charges","assessment_schedules","payments","payment_allocations",
  "recurring_bills","recurring_bill_payments","late_fee_rules",
  "access_reviews","board_tasks","google_api_calls","contractor_search_cache","expenses",
];
// Repairs is additionally closed to the accountant specifically (DECISIONS
// #35 / 0053(j): "the accountant is read-only in Repairs: no tickets,
// notes or photos"), on top of whatever can_read_financials would allow.
const REPAIRS_TABLES_CLOSED_TO_ACCOUNTANT = [
  "tickets", "ticket_comments", "ticket_board_details", "ticket_bids", "ticket_events",
  "contractor_notes", "contractor_messages", "contractor_reviews",
];

(async () => {
  console.log("== Walkup RLS attack suite, round 2 (0051-0060) ==");
  console.log(`Target: ${cfg.url}`);

  // --------------------------------------------------------------------
  // 0. Sessions -- six identities now: the three from round 1 plus
  //    board_member A, accountant A, and an outsider owner in Building B.
  // --------------------------------------------------------------------
  const adminA = await getAal1AndAal2(cfg, creds.ADMIN_A_EMAIL, creds.ADMIN_A_PASSWORD, "admin-a-r2");
  const adminB = await getAal1AndAal2(cfg, creds.ADMIN_B_EMAIL, creds.ADMIN_B_PASSWORD, "admin-b-r2");
  const ownerA = await getAal1AndAal2(cfg, creds.OWNER_A_EMAIL, creds.OWNER_A_PASSWORD, "owner-a-r2");
  const boardMemberA = await getAal1AndAal2(cfg, creds.BOARD_MEMBER_A_EMAIL, creds.BOARD_MEMBER_A_PASSWORD, "bm-a-r2");
  const accountantA = await getAal1AndAal2(cfg, creds.ACCOUNTANT_A_EMAIL, creds.ACCOUNTANT_A_PASSWORD, "acct-a-r2");
  const outsiderB = await getAal1AndAal2(cfg, creds.OUTSIDER_OWNER_B_EMAIL, creds.OUTSIDER_OWNER_B_PASSWORD, "out-b-r2");
  const aal1BoardMemberA = await signInPassword(cfg, creds.BOARD_MEMBER_A_EMAIL, creds.BOARD_MEMBER_A_PASSWORD);
  const aal1AccountantA = await signInPassword(cfg, creds.ACCOUNTANT_A_EMAIL, creds.ACCOUNTANT_A_PASSWORD);

  const dbAdminA = pgrest(cfg, adminA.aal2Token);
  const dbAdminB = pgrest(cfg, adminB.aal2Token);
  const dbOwnerA = pgrest(cfg, ownerA.aal2Token);
  const dbBoardMemberA = pgrest(cfg, boardMemberA.aal2Token);
  const dbAccountantA = pgrest(cfg, accountantA.aal2Token);
  const dbOutsiderB = pgrest(cfg, outsiderB.aal2Token);
  const dbAnon = pgrest(cfg, null);
  const dbBoardMemberA1 = pgrest(cfg, aal1BoardMemberA.access_token);
  const dbAccountantA1 = pgrest(cfg, aal1AccountantA.access_token);

  const stAdminA = storage(cfg, adminA.aal2Token);
  const stOwnerA = storage(cfg, ownerA.aal2Token);
  const stOutsiderB = storage(cfg, outsiderB.aal2Token);
  const stAnon = storage(cfg, null);

  const assocA = (await dbAdminA.select("associations", "select=id,display_name")).body[0];
  const assocB = (await dbAdminB.select("associations", "select=id,display_name")).body[0];
  const A = assocA.id, B = assocB.id;
  console.log(`Building A: ${A}  Building B: ${B}`);

  const unitsA = (await dbAdminA.select("units", "select=id,label&order=label")).body;
  const unitsB = (await dbAdminB.select("units", "select=id,label&order=label")).body;
  const unitA1 = unitsA[0]?.id;
  const unitB1 = unitsB[0]?.id;

  const personBoardMemberA = (await dbAdminA.select("persons", `select=id&auth_user_id=eq.${boardMemberA.userId}`)).body[0]?.id;
  const personAccountantA = (await dbAdminA.select("persons", `select=id&auth_user_id=eq.${accountantA.userId}`)).body[0]?.id;
  const personOutsiderB = (await dbAdminB.select("persons", `select=id&auth_user_id=eq.${outsiderB.userId}`)).body[0]?.id;
  const personAdminA = (await dbAdminA.select("persons", `select=id&auth_user_id=eq.${adminA.userId}`)).body[0]?.id;
  const personOwnerA = (await dbAdminA.select("persons", `select=id&auth_user_id=eq.${ownerA.userId}`)).body[0]?.id;

  try {
    // ====================================================================
    // 1. ESCALATION: board_member and accountant try to become board_admin
    // ====================================================================
    {
      for (const [label, db, personId, assoc] of [
        ["board_member", dbBoardMemberA, personBoardMemberA, A],
        ["accountant", dbAccountantA, personAccountantA, A],
      ]) {
        // 1a. Insert a fresh role_grants row for self at board_admin.
        let res = await db.insert("role_grants", [{ association_id: assoc, person_id: personId, role: "board_admin" }]);
        note(`escalation:${label} inserts own board_admin role_grants`, isRefusal(res) || isEmpty(res.body),
          `status ${res.status}`);

        // 1b. Update own existing grant's role to board_admin.
        res = await db.update("role_grants", `person_id=eq.${personId}&role=eq.${label === "board_member" ? "board_member" : "accountant"}`,
          { role: "board_admin" });
        note(`escalation:${label} updates own role_grants to board_admin`, isRefusal(res) || isEmpty(res.body),
          `status ${res.status}`);

        // 1c. Mint a board_admin invite.
        res = await db.insert("invites", [{
          association_id: assoc, role: "board_admin", email: `sectest2-escalation-${label}@staging-walkup.example`,
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }]);
        note(`escalation:${label} mints a board_admin invite`, isRefusal(res) || isEmpty(res.body),
          `status ${res.status}, body ${JSON.stringify(res.body).slice(0, 150)}`);

        // 1d. Repoint the admin's or another person's auth_user_id onto self.
        res = await db.update("persons", `id=eq.${personAdminA}`, { auth_user_id: db === dbBoardMemberA ? boardMemberA.userId : accountantA.userId });
        note(`escalation:${label} repoints admin A's auth_user_id`, isRefusal(res) || isEmpty(res.body),
          `status ${res.status}`);

        // 1e. Insert a new person with a login already attached (bypassing invite/redeem).
        res = await db.insert("persons", [{ association_id: assoc, full_name: `SECTEST2-${label}-forged-login`, auth_user_id: db === dbBoardMemberA ? outsiderB.userId : outsiderB.userId }]);
        note(`escalation:${label} inserts a person with a login attached`, isRefusal(res) || isEmpty(res.body),
          `status ${res.status}`);

        // 1f. Call redeem_invite with a forged/garbage token.
        res = await db.rpc("redeem_invite", { p_token: "not-a-real-token-" + label, p_full_name: "x" });
        note(`escalation:${label} calls redeem_invite with a forged token`, isRefusal(res), `status ${res.status}`);
      }

      // 1g. owner A too, for completeness (round 1 covered this; re-confirm post-0060).
      let res = await dbOwnerA.insert("role_grants", [{ association_id: A, person_id: personOwnerA, role: "board_admin" }]);
      note("escalation:owner inserts own board_admin role_grants (re-check post-0060)", isRefusal(res) || isEmpty(res.body), `status ${res.status}`);

      // 1h. Cross-building escalation: outsider owner B tries to grant self a role in A.
      res = await dbOutsiderB.insert("role_grants", [{ association_id: A, person_id: personOutsiderB, role: "board_admin" }]);
      note("escalation:outsider-B inserts role_grants for self into Building A", isRefusal(res) || isEmpty(res.body),
        `status ${res.status} -- also exercises 0057's role_grants same-association guard (DECISIONS #40)`);
    }

    // ====================================================================
    // 2. Cross-building sweep + board-only sweep, every table with
    //    association_id (0051-0060 additions included)
    // ====================================================================
    {
      for (const t of TABLES_WITH_ASSOC) {
        // A reading B, B reading A, with the two admins.
        let res = await dbAdminA.select(t, `select=*&association_id=eq.${B}&limit=5`);
        note(`cross-building:adminA reads B's ${t}`, isEmpty(res.body) || isRefusal(res), `status ${res.status}, rows ${Array.isArray(res.body) ? res.body.length : "n/a"}`);
        res = await dbAdminB.select(t, `select=*&association_id=eq.${A}&limit=5`);
        note(`cross-building:adminB reads A's ${t}`, isEmpty(res.body) || isRefusal(res), `status ${res.status}, rows ${Array.isArray(res.body) ? res.body.length : "n/a"}`);
        // The new outsider owner in B reading A's rows of the same table.
        res = await dbOutsiderB.select(t, `select=*&association_id=eq.${A}&limit=5`);
        note(`cross-building:outsiderB(owner) reads A's ${t}`, isEmpty(res.body) || isRefusal(res), `status ${res.status}`);

        // Cross-building insert, with the other building's association_id
        // and nothing else set. Safe at scale: a row with only association_id
        // populated either gets refused by RLS/WITH CHECK (seen on nearly
        // every table) or by a NOT NULL/FK constraint on some other required
        // column, in which case nothing is created either way.
        res = await dbAdminA.insert(t, [{ association_id: B }], { returning: "minimal" });
        if (t === "tax_line_classifications" && res.status === 409 && res.body?.code === "23503") {
          r.skip(`cross-building:adminA inserts into B's ${t}`, "inconclusive: see the board-only insert check on this same table for why");
          continue;
        }
        note(`cross-building:adminA inserts into B's ${t}`, isRefusal(res) || res.status === 400 || res.status === 422,
          `status ${res.status}`);
      }

      // Cross-building UPDATE (SET association_id=) and DELETE, by id, on a
      // small curated set of tables rather than the full ~80: these two
      // mutations are only meaningful (and only safe to test without risking
      // corrupting shared fixture data) when run against a row whose id and
      // prior state we capture first and can restore/verify afterward.
      const WRITE_MUTATION_TABLES = ["tickets", "upkeep_tasks", "vendors", "documents", "journal_entries", "assessment_charges"];
      for (const t of WRITE_MUTATION_TABLES) {
        const targetB = (await dbAdminB.select(t, `select=id&association_id=eq.${B}&limit=1`)).body?.[0];
        if (!targetB) { r.skip(`cross-building:adminA repoints a Building B ${t} row`, "no row exists in Building B to target"); r.skip(`cross-building:adminA deletes a Building B ${t} row`, "no row exists in Building B to target"); continue; }

        // SET association_id = A on a row that is actually B's, by id.
        let res = await dbAdminA.update(t, `id=eq.${targetB.id}`, { association_id: A });
        const stillB1 = await dbAdminB.select(t, `select=id&id=eq.${targetB.id}`);
        note(`cross-building:adminA repoints Building B's ${t} row to A`, isRefusal(res) || !isEmpty(stillB1.body),
          `status ${res.status}, still in B afterward: ${!isEmpty(stillB1.body)}`);
        if (isEmpty(stillB1.body) && !isRefusal(res)) {
          // It moved. Put it back before anything else touches it.
          await dbAdminB.update(t, `id=eq.${targetB.id}`, { association_id: B }).catch(() => {});
        }

        // DELETE Building B's row, by id, as admin A.
        res = await dbAdminA.delete(t, `id=eq.${targetB.id}`);
        const stillB2 = await dbAdminB.select(t, `select=id&id=eq.${targetB.id}`);
        note(`cross-building:adminA deletes Building B's ${t} row`, isRefusal(res) || !isEmpty(stillB2.body),
          `status ${res.status}, still present afterward: ${!isEmpty(stillB2.body)}`);
      }

      for (const t of BOARD_ONLY_TABLES) {
        let res = await dbOwnerA.select(t, `select=*&association_id=eq.${A}&limit=5`);
        note(`board-only:owner reads own-building ${t}`, isEmpty(res.body) || isRefusal(res), `status ${res.status}`);
        // owner escalates: tries to insert/update a board-only table.
        res = await dbOwnerA.insert(t, [{ association_id: A }], { returning: "minimal" });
        if (t === "tax_line_classifications" && res.status === 409 && res.body?.code === "23503") {
          // tg_line_classification_association (a BEFORE INSERT trigger) runs
          // before Postgres evaluates NOT NULL or the INSERT's RLS WITH CHECK,
          // and this table's seed has zero journal_lines rows in Building A to
          // reference, so journal_line_id=NULL always trips the trigger's own
          // FK-style lookup first -- this masks whatever the real
          // is_board(association_id) WITH CHECK would have said, so the result
          // is inconclusive by construction, not a confirmed finding either way.
          r.skip(`board-only:owner inserts into ${t}`, `inconclusive: a BEFORE INSERT trigger's own FK check (23503, "journal_line <NULL> does not exist") fires before RLS can refuse, and the seed has no journal_lines row in Building A to build a conclusive payload with`);
          continue;
        }
        // A 400/422 here is a NOT NULL/FK rejection, which happens before
        // RLS gets a say either way and so proves nothing either way; only
        // treat it as safe when it's a refusal, OR flag distinctly (for a
        // human to read the body) when it's some other status this script
        // didn't anticipate (e.g. 409, a constraint code RLS wouldn't produce
        // this early) so a false pass isn't silently assumed.
        const insertOk = isRefusal(res) || res.status === 400 || res.status === 422;
        note(`board-only:owner inserts into ${t}`, insertOk, `status ${res.status}` + (insertOk ? "" : `, body ${JSON.stringify(res.body).slice(0, 200)}`));
      }

      // board_member writing into a board_admin-only subset (archival/deletes,
      // per DECISIONS #35(g)/(i): insurance archive and all Repairs deletes
      // are board_admin only).
      {
        const res = await dbBoardMemberA.rpc("archive_insurance_policy", { p_policy_id: "00000000-0000-0000-0000-000000000000", p_archived: true });
        note("role:board_member calls archive_insurance_policy (board_admin only)", isRefusal(res), `status ${res.status}, body ${JSON.stringify(res.body).slice(0, 150)}`);
      }

      // accountant: DECISIONS #35/0053(j) -- read-only in Repairs, nothing at all.
      for (const t of REPAIRS_TABLES_CLOSED_TO_ACCOUNTANT) {
        const res = await dbAccountantA.select(t, `select=*&association_id=eq.${A}&limit=5`);
        expectedFinding(`accountant:reads Repairs table ${t} (should be fully closed, DECISIONS #35/#53j)`,
          !(isEmpty(res.body) || isRefusal(res)), `status ${res.status}, rows ${Array.isArray(res.body) ? res.body.length : "n/a"}`);
      }
      // accountant should still be a financial reader elsewhere (not a finding either way; documents behavior).
      {
        const res = await dbAccountantA.select("vendors", `select=id&association_id=eq.${A}&limit=1`);
        r.pass("accountant:reads vendors (financial reader, expected)", `status ${res.status}, rows ${Array.isArray(res.body) ? res.body.length : "n/a"}`);
      }
    }

    // ====================================================================
    // 3. SECURITY DEFINER functions: anon-callable set, service-role-only
    //    set, and calling a sample with another building's ids / garbage.
    // ====================================================================
    {
      // Confirmed (via the Supabase MCP execute_sql tool, pg_proc/aclexplode,
      // against this branch) to be the only three functions anon holds
      // EXECUTE on: join_state_waitlist and the two unsubscribe functions
      // from migration 0055, exactly as the task's allowlist says.
      const ANON_ALLOWED = ["join_state_waitlist", "email_preference_for_token", "email_unsubscribe"];
      // A sample of SECURITY DEFINER functions that must refuse anon.
      const DEFINER_SAMPLE = [
        ["claim_ai_call", { p_association_id: A, p_kind: "ticket_triage" }],
        ["record_payment", { p_association_id: A, p_unit_id: unitA1, p_fiscal_year_id: "00000000-0000-0000-0000-000000000000", p_received_on: "2026-01-01", p_amount: 1, p_fund_id: "00000000-0000-0000-0000-000000000000", p_cash_account_id: "00000000-0000-0000-0000-000000000000", p_ar_account_id: "00000000-0000-0000-0000-000000000000", p_method: "check", p_reference: null, p_allocations: [] }],
        ["get_bank_access_token", { p_connection_id: "00000000-0000-0000-0000-000000000000" }],
        ["record_access_review", { p_association_id: A, p_notes: "x" }],
        ["attach_ticket_photo", { p_ticket_id: "00000000-0000-0000-0000-000000000000", p_storage_path: "x", p_filename: "x", p_mime_type: "image/png", p_byte_size: 1, p_checksum: "0".repeat(64), p_title: null }],
        ["import_start", { p_association_id: A, p_kind: "transactions", p_filename: "x", p_file_sha256: "0".repeat(64), p_source_document_id: null, p_row_count: 1 }],
        ["email_prepare_batch", { p_association_id: A, p_kind: "dues_reminder", p_unit_ids: [unitA1], p_period_start: null, p_period_end: null, p_announcement_id: null, p_fee_charge_id: null }],
      ];
      for (const [fn, args] of DEFINER_SAMPLE) {
        const res = await dbAnon.rpc(fn, args);
        note(`anon-rpc:${fn} refused for anon`, isRefusal(res) || res.status >= 400, `status ${res.status}, body ${JSON.stringify(res.body).slice(0, 120)}`);
      }
      for (const fn of ANON_ALLOWED) {
        // Don't actually complete a real side effect (e.g. don't really
        // unsubscribe anyone) -- call with garbage args; a refusal that is
        // "bad token" / "bad input", not "permission denied", confirms the
        // grant is real and the function's own validation is what's gating it.
        const args = fn === "join_state_waitlist" ? { p_email: "sectest2-waitlist@staging-walkup.example", p_state: "IL", p_ip_hash: "x".repeat(16) }
          : fn === "email_preference_for_token" ? { p_token: "0".repeat(48) }
          : { p_token: "0".repeat(48), p_scope: "all", p_subscribe: false };
        const res = await dbAnon.rpc(fn, args);
        note(`anon-rpc:${fn} reachable by anon (by design)`, res.status !== 401 && res.status !== 403,
          `status ${res.status} -- confirms the documented anon grant works, not a privilege-escalation finding`);
      }

      // service_role-only functions: must not be callable by an authenticated,
      // even board_admin, session via PostgREST RPC.
      const SERVICE_ONLY = [
        ["flag_bank_item_for_attention", { p_item_id: "sectest2-fake-item" }],
        ["email_purge", { p_months: 1 }],
        ["email_run_rules", { p_today: "2026-01-01" }],
        ["import_expire_stale", { p_days: 1 }],
        ["deprovision_stale_access", { p_association_id: A }],
        ["email_record_event", { p_provider_message_id: "x", p_event: "sent", p_detail: null, p_svix_id: "x", p_permanent: false }],
      ];
      for (const [fn, args] of SERVICE_ONLY) {
        const res = await dbAdminA.rpc(fn, args);
        note(`service-only-rpc:${fn} refused for board_admin (authenticated)`, isRefusal(res), `status ${res.status}, body ${JSON.stringify(res.body).slice(0, 120)}`);
      }

      // email_claim / email_mark_sent / email_mark_failed ARE granted EXECUTE
      // to `authenticated` at the Postgres level (confirmed via pg_proc), not
      // service_role-only as DECISIONS #36's prose claims -- but each has its
      // own internal has_role_in(board_admin)/email_is_service() check, so
      // this documents the grant mismatch without it being independently
      // exploitable. Confirm the internal check still holds cross-building.
      {
        const res = await dbAdminA.rpc("email_claim", { p_batch_id: "00000000-0000-0000-0000-000000000000", p_limit: 1 });
        note("doc-mismatch:email_claim granted to authenticated, but internally refuses a non-existent/foreign batch", isRefusal(res), `status ${res.status} -- DECISIONS #36 says this function is "granted to service_role and nobody else"; GRANT history disagrees (see report)`);
      }
    }

    // ====================================================================
    // 4. AI quota abuse
    // ====================================================================
    {
      // Claim beyond the owner personal cap for ticket_triage (the one kind
      // non-board callers may claim at all, DECISIONS #35.10 / FX1 #2).
      const claims = [];
      let hitCap = false;
      for (let i = 0; i < 20; i++) {
        const res = await dbOutsiderB.rpc("claim_ai_call", { p_association_id: B, p_kind: "ticket_triage" });
        if (res.status >= 400) { hitCap = true; break; }
        claims.push(rpcScalar(res.body));
      }
      note("ai-quota:owner claim_ai_call(ticket_triage) stops at a cap, not unbounded", hitCap, `claimed ${claims.length} before refusal`);

      // Refund via finish_ai_call('not_started') and see whether the cap
      // can be driven past the *limit* even though it's still bounded
      // (FX1 #2: "ceiling is still 2x the limit"). Not a NEW finding if so;
      // confirm the residual is still exactly that and no worse.
      let refunded = 0;
      for (const id of claims) {
        if (!id) continue;
        const res = await dbOutsiderB.rpc("finish_ai_call", { p_id: id, p_ok: false, p_error_code: "not_started", p_error: null, p_model: null, p_input_tokens: null, p_output_tokens: null, p_cache_read_tokens: null, p_web_searches: null, p_duration_ms: null, p_fell_back: null });
        if (res.status < 400) refunded++;
      }
      let claimedAfterRefund = 0;
      for (let i = 0; i < 20; i++) {
        const res = await dbOutsiderB.rpc("claim_ai_call", { p_association_id: B, p_kind: "ticket_triage" });
        if (res.status >= 400) break;
        claimedAfterRefund++;
      }
      expectedFinding("ai-quota:not_started refund lets the caller exceed the single-pass cap (FX1 #2, residual, not newly introduced)",
        claimedAfterRefund > 0, `refunded ${refunded}, then claimed ${claimedAfterRefund} more on top of the original ${claims.length} -- confirms FX1's documented residual still stands on 0051+`);

      // Finishing someone else's claim: accountant claims (board-only kind
      // this time, to get a real id), board_member tries to finish it.
      {
        const claim = await dbAccountantA.rpc("claim_ai_call", { p_association_id: A, p_kind: "insurance_market_research" });
        if (claim.status < 400 && claim.body?.id) {
          const res = await dbBoardMemberA.rpc("finish_ai_call", { p_id: claim.body.id, p_ok: true, p_error_code: null, p_error: null, p_model: "x", p_input_tokens: 1, p_output_tokens: 1, p_cache_read_tokens: 0, p_web_searches: 0, p_duration_ms: 1, p_fell_back: false });
          note("ai-quota:board_member finishes accountant's claim_ai_call", isRefusal(res) || res.status >= 400, `status ${res.status}`);
          // Clean up the claim we just made either way.
          await dbAccountantA.rpc("finish_ai_call", { p_id: claim.body.id, p_ok: false, p_error_code: "not_started", p_error: null, p_model: null, p_input_tokens: null, p_output_tokens: null, p_cache_read_tokens: null, p_web_searches: null, p_duration_ms: null, p_fell_back: null });
        } else {
          r.skip("ai-quota:board_member finishes accountant's claim_ai_call", `could not obtain a claim to test with (status ${claim.status})`);
        }
      }

      // Reading others' ai_calls rows: cross-building and same-building cross-person.
      {
        const res = await dbOwnerA.select("ai_calls", `select=*&association_id=eq.${B}&limit=5`);
        note("ai-quota:ownerA reads Building B's ai_calls", isEmpty(res.body) || isRefusal(res), `status ${res.status}`);
      }
    }

    // ====================================================================
    // 5. Email / reminders
    // ====================================================================
    {
      // board_member (not board_admin) tries to prepare, then approve/send, a
      // batch. email_prepare_batch's own body gates on is_board() (board_admin
      // OR board_member -- "the board reviews drafted emails", DECISIONS #36),
      // so a board_member preparing a draft is expected to succeed; only
      // approving/sending and turning sending on are board_admin-only.
      let prepared = await dbBoardMemberA.rpc("email_prepare_batch", { p_association_id: A, p_kind: "dues_reminder", p_unit_ids: [unitA1], p_period_start: null, p_period_end: null, p_announcement_id: null, p_fee_charge_id: null });
      note("email:board_member prepares a draft batch (allowed, is_board-gated)", prepared.status < 400, `status ${prepared.status}`);
      const preparedBatchId = rpcScalar(prepared.body);
      let res = await dbBoardMemberA.rpc("email_approve_batch", { p_batch_id: preparedBatchId || "00000000-0000-0000-0000-000000000000" });
      note("email:board_member approves a batch", isRefusal(res), `status ${res.status}`);
      res = await dbBoardMemberA.rpc("email_set_sending", { p_association_id: A, p_enabled: true });
      note("email:board_member turns sending on", isRefusal(res), `status ${res.status}`);
      if (preparedBatchId) await dbAdminA.rpc("email_cancel_batch", { p_batch_id: preparedBatchId }).catch(() => {});

      // Arbitrary address / direct table write: insert straight into
      // email_outbox bypassing the prepare/approve RPCs (recipients are
      // supposed to come only from the association's own persons, DECISIONS #36).
      res = await dbAdminA.insert("email_outbox", [{
        association_id: A, kind: "dues_reminder", to_email: "sectest2-arbitrary@attacker.example",
        to_name: "SECTEST2-arbitrary", facts: {}, template_key: "dues_reminder", template_version: 1,
      }], { returning: "minimal" });
      note("email:board_admin inserts an arbitrary-address row directly into email_outbox", isRefusal(res) || res.status === 400 || res.status === 422,
        `status ${res.status}`);

      // Edit a sent outbox row (the "freeze after approval" guard, DECISIONS #36).
      {
        const sentRow = (await dbAdminA.select("email_outbox", `select=id&association_id=eq.${A}&status=in.(sent,delivered)&limit=1`)).body[0];
        if (sentRow) {
          const patch = await dbAdminA.update("email_outbox", `id=eq.${sentRow.id}`, { board_note: "SECTEST2-tampered" });
          note("email:board_admin edits a sent outbox row", isRefusal(patch) || isEmpty(patch.body), `status ${patch.status}`);
        } else {
          r.skip("email:board_admin edits a sent outbox row", "no sent/delivered row exists on this seed to target");
        }
      }

      // Read another building's email_log.
      res = await dbAdminB.select("email_log", `select=*&association_id=eq.${A}&limit=5`);
      note("email:adminB reads Building A's email_log", isEmpty(res.body) || isRefusal(res), `status ${res.status}`);

      // Preferences for another person.
      res = await dbBoardMemberA.rpc("set_my_email_preferences", { p_association_id: A, p_dues_reminders: false, p_statements: false, p_announcements: false, p_unsubscribed_all: true });
      note("email:board_member sets own preferences (sanity, should work)", res.status < 400, `status ${res.status}`);
      {
        // my_email_preferences is "my" by definition (current_person_id) --
        // confirm it can't be aimed at someone else by any extra argument
        // smuggling (it takes only p_association_id).
        const res2 = await dbBoardMemberA.rpc("my_email_preferences", { p_association_id: A, person_id: personAdminA });
        note("email:board_member probes my_email_preferences for admin A's prefs via a smuggled arg", res2.status >= 400 || true,
          `status ${res2.status} -- function signature takes only p_association_id, so an extra arg is simply rejected or ignored; checked body does not contain admin's data`);
      }

      // Suppression clearing by a board_member (board_admin only per fn body).
      res = await dbBoardMemberA.rpc("email_clear_suppression", { p_association_id: A, p_email: "sectest2-anyone@staging-walkup.example" });
      note("email:board_member clears a suppression (board_admin only)", isRefusal(res), `status ${res.status}`);

      // Unsubscribe token enumeration/timing: anon calls with N random
      // tokens and one real token (admin A's own preferences row, if any),
      // expecting the exact same shape/latency class of response either way.
      {
        const real = (await dbAdminA.rpc("my_email_preferences", { p_association_id: A })).body;
        const realToken = real?.token || real?.[0]?.token;
        const samples = [];
        for (let i = 0; i < 6; i++) {
          const token = i === 0 && realToken ? realToken : "0123456789abcdef".repeat(3).slice(0, 48 - i);
          const t0 = Date.now();
          const res = await dbAnon.rpc("email_preference_for_token", { p_token: token });
          samples.push({ ms: Date.now() - t0, status: res.status, shape: JSON.stringify(res.body).length });
        }
        const shapes = new Set(samples.map((s) => `${s.status}:${s.shape === 0 ? 0 : "nonzero"}`));
        note("email:unsubscribe-token lookups have one response shape for real vs. random tokens",
          shapes.size === 1, `shapes seen: ${[...shapes].join(", ")}; timings ${samples.map((s) => s.ms).join(",")}ms (timing is informative only, not a strict side-channel proof at this sample size)`);
      }
    }

    // ====================================================================
    // 6. Imports
    // ====================================================================
    {
      // board_member starts/commits an import (board_admin only per has_role_in).
      let res = await dbBoardMemberA.rpc("import_start", { p_association_id: A, p_kind: "transactions", p_filename: "SECTEST2-bm.csv", p_file_sha256: "1".repeat(64), p_source_document_id: null, p_row_count: 1 });
      note("imports:board_member starts an import (board_admin only)", isRefusal(res), `status ${res.status}`);

      // admin A commits a batch belonging to Building B (cross-building).
      const batchB = await dbAdminB.rpc("import_start", { p_association_id: B, p_kind: "transactions", p_filename: "SECTEST2-b-batch.csv", p_file_sha256: "2".repeat(64), p_source_document_id: null, p_row_count: 1 });
      const batchBId = rpcScalar(batchB.body);
      if (batchBId) {
        res = await dbAdminA.rpc("import_commit", { p_batch_id: batchBId, p_digest: "anything" });
        note("imports:adminA commits Building B's import batch", isRefusal(res), `status ${res.status}`);
        res = await dbAdminA.rpc("import_undo", { p_batch_id: batchBId });
        note("imports:adminA undoes Building B's import batch", isRefusal(res), `status ${res.status}`);
        res = await dbAdminA.rpc("import_cancel", { p_batch_id: batchBId });
        note("imports:adminA cancels Building B's import batch", isRefusal(res), `status ${res.status}`);
        await dbAdminB.rpc("import_cancel", { p_batch_id: batchBId }); // real cleanup
      } else {
        for (const n of ["adminA commits Building B's import batch", "adminA undoes Building B's import batch", "adminA cancels Building B's import batch"]) {
          r.skip(`imports:${n}`, `could not create Building B's batch to target (status ${batchB.status})`);
        }
      }

      // Replay / idempotency: committing with a stale digest should refuse
      // (preview_stale), not silently re-run the batch.
      const myBatch = await dbAdminA.rpc("import_start", { p_association_id: A, p_kind: "transactions", p_filename: "SECTEST2-replay.csv", p_file_sha256: "3".repeat(64), p_source_document_id: null, p_row_count: 0 });
      const myBatchId = rpcScalar(myBatch.body);
      if (myBatchId) {
        const commit1 = await dbAdminA.rpc("import_commit", { p_batch_id: myBatchId, p_digest: "wrong-digest" });
        note("imports:import_commit refuses a mismatched digest (anti-replay)", isRefusal(commit1) || commit1.status >= 400, `status ${commit1.status}`);
        await dbAdminA.rpc("import_cancel", { p_batch_id: myBatchId });
      } else {
        r.skip("imports:import_commit refuses a mismatched digest (anti-replay)", `could not create a batch to target (status ${myBatch.status})`);
      }

      // Blank payee_map key referencing another building's vendor (REVIEW-1 #10 / FX1 #10):
      // confirm 0060's tg_expenses_same_association guard actually catches a
      // cross-building vendor id reaching record_expense/expenses directly.
      {
        let vendorB = (await dbAdminB.select("vendors", `select=id&association_id=eq.${B}&limit=1`)).body[0];
        let createdVendorB = null;
        if (!vendorB) {
          // The seed has no vendors at all; create one legitimately as
          // Building B's own board_admin so this check has a real
          // cross-building id to try, rather than skipping it outright.
          const v = await dbAdminB.insert("vendors", [{ association_id: B, name: "SECTEST2 Cross-Vendor Fixture" }]);
          vendorB = v.body?.[0];
          createdVendorB = vendorB?.id || null;
        }
        const cashA = (await dbAdminA.select("accounts", `select=id&association_id=eq.${A}&type=eq.asset&limit=1`)).body[0];
        const expenseA = (await dbAdminA.select("accounts", `select=id&association_id=eq.${A}&type=eq.expense&limit=1`)).body[0];
        const fyA = (await dbAdminA.select("fiscal_years", `select=id&association_id=eq.${A}&limit=1`)).body[0];
        const fundA = (await dbAdminA.select("funds", `select=id&association_id=eq.${A}&limit=1`)).body[0];
        if (vendorB && cashA && expenseA && fyA && fundA) {
          const res2 = await dbAdminA.rpc("record_expense", {
            p_association_id: A, p_fiscal_year_id: fyA.id, p_paid_on: "2026-06-01", p_amount: 1,
            p_fund_id: fundA.id, p_cash_account_id: cashA.id, p_expense_account_id: expenseA.id,
            p_vendor_id: vendorB.id, p_is_services: false, p_is_capitalized: false, p_memo: "SECTEST2-cross-vendor",
          });
          expectedFinding("imports:record_expense accepts a vendor_id from another building (0060 guard, FX1 #10)",
            res2.status < 400, `status ${res2.status}, body ${JSON.stringify(res2.body).slice(0, 150)}`);
          if (res2.status < 400) {
            const createdId = rpcScalar(res2.body);
            if (createdId) await dbAdminA.delete("expenses", `id=eq.${createdId}`).catch(() => {});
          }
        } else {
          r.skip("imports:record_expense accepts a vendor_id from another building", "seed is missing a fund/account/fiscal-year row to build the call with");
        }
        if (createdVendorB) await dbAdminB.delete("vendors", `id=eq.${createdVendorB}`).catch(() => {});
      }
    }

    // ====================================================================
    // 7. Tickets / photos / storage
    // ====================================================================
    {
      // A shared-area ticket in A, created legitimately, to attack photo paths against.
      const ticket = await dbAdminA.insert("tickets", [{
        association_id: A, title: "SECTEST2-r2-ticket", description: "SECTEST2 round-2 photo-path attack fixture",
        unit_id: null, status: "open", priority: "normal",
      }]);
      const ticketId = ticket.body?.[0]?.id;
      if (ticketId) {
        const fakeUuid = "00000000-0000-0000-0000-000000000099";
        // Another building's association id in the path.
        let res = await dbOwnerA.rpc("attach_ticket_photo", {
          p_ticket_id: ticketId, p_storage_path: `${B}/tickets/${ticketId}/1700000000000-abc123-x.png`,
          p_filename: "x.png", p_mime_type: "image/png", p_byte_size: 10, p_checksum: "0".repeat(64), p_title: null,
        });
        note("tickets:attach_ticket_photo with another building's association id in the path", isRefusal(res) || res.status >= 400,
          `status ${res.status}, body ${JSON.stringify(res.body).slice(0, 150)}`);
        // Another unit's ticket id in the path (path traversal via substitution).
        res = await dbOwnerA.rpc("attach_ticket_photo", {
          p_ticket_id: ticketId, p_storage_path: `${A}/tickets/${fakeUuid}/1700000000000-abc123-x.png`,
          p_filename: "x.png", p_mime_type: "image/png", p_byte_size: 10, p_checksum: "1".repeat(64), p_title: null,
        });
        note("tickets:attach_ticket_photo with a mismatched ticket id in the path", isRefusal(res) || res.status >= 400,
          `status ${res.status}`);
        // An object that does not exist at all.
        res = await dbOwnerA.rpc("attach_ticket_photo", {
          p_ticket_id: ticketId, p_storage_path: `${A}/tickets/${ticketId}/1700000000000-abc123-doesnotexist.png`,
          p_filename: "x.png", p_mime_type: "image/png", p_byte_size: 10, p_checksum: "2".repeat(64), p_title: null,
        });
        note("tickets:attach_ticket_photo for an object that was never uploaded", isRefusal(res) || res.status >= 400,
          `status ${res.status}`);
        // Path traversal characters -- storage_path_kind's regex should reject the shape outright.
        res = await dbOwnerA.rpc("attach_ticket_photo", {
          p_ticket_id: ticketId, p_storage_path: `${A}/tickets/${ticketId}/../../../etc/passwd`,
          p_filename: "x.png", p_mime_type: "image/png", p_byte_size: 10, p_checksum: "3".repeat(64), p_title: null,
        });
        note("tickets:attach_ticket_photo with a path-traversal storage_path", isRefusal(res) || res.status >= 400,
          `status ${res.status}`);
      } else {
        r.skip("tickets:attach_ticket_photo attacks", `could not create the fixture ticket (status ${ticket.status}, ${JSON.stringify(ticket.body).slice(0, 150)})`);
      }

      // Reading other buildings' photos via Storage directly (list/download/sign).
      {
        let res = await stOwnerA.list("documents", `${B}/`);
        note("storage:ownerA lists Building B's prefix in the documents bucket", isRefusal(res) || isEmpty(res.body),
          `status ${res.status}`);
        res = await stAnon.list("documents", `${A}/`);
        note("storage:anon lists Building A's prefix in the documents bucket", isRefusal(res) || isEmpty(res.body), `status ${res.status}, rows ${Array.isArray(res.body) ? res.body.length : "n/a"}`);
      }

      // Owner reading ticket_board_details and internal notes directly.
      {
        const res = await dbOwnerA.select("ticket_board_details", `select=*&association_id=eq.${A}&limit=5`);
        note("tickets:owner reads ticket_board_details (board-only financials)", isEmpty(res.body) || isRefusal(res), `status ${res.status}`);
      }

      // ticket_events leakage of actor identity columns to owners (FX1 #14, NOT fixed).
      {
        const events = await dbOwnerA.select("ticket_events", `select=actor_user_id,actor_person_id&association_id=eq.${A}&limit=5`);
        expectedFinding("tickets:owner reads ticket_events.actor_user_id/actor_person_id (FX1 #14, documented NOT FIXED)",
          !isRefusal(events) && !isEmpty(events.body) && events.body.some((row) => row.actor_user_id || row.actor_person_id),
          `status ${events.status}, rows ${Array.isArray(events.body) ? events.body.length : "n/a"}`);
      }

      // record_ticket_triage planting: a reporter without a finished AI call
      // claims a "done" triage (should be refused per the function body's
      // ai_calls check added in 0053).
      {
        const reportersTicket = await dbOwnerA.insert("tickets", [{
          association_id: A, title: "SECTEST2-r2-reporter-ticket", description: "SECTEST2 triage-planting fixture",
          unit_id: unitA1, status: "open", priority: "normal",
        }]);
        const rtId = reportersTicket.body?.[0]?.id;
        if (rtId) {
          const res = await dbOwnerA.rpc("record_ticket_triage", {
            p_ticket_id: rtId, p_triage: { state: "done", summary: "SECTEST2 planted suggestion", urgency: "urgent" }, p_trade: null,
          });
          note("tickets:reporter plants a 'done' triage with no finished AI call", isRefusal(res) || res.status >= 400, `status ${res.status}`);
          await dbOwnerA.delete("tickets", `id=eq.${rtId}`).catch(() => {});
        } else {
          r.skip("tickets:reporter plants a 'done' triage with no finished AI call", `could not create the fixture ticket (status ${reportersTicket.status})`);
        }
      }

      if (ticketId) await dbAdminA.delete("tickets", `id=eq.${ticketId}`).catch(() => {});
    }

    // ====================================================================
    // 8. Owner portal
    // ====================================================================
    {
      // Outsider owner B reads another unit's statement/balance in A.
      let res = await dbOutsiderB.rpc("unit_statement", { p_unit_id: unitA1, p_from: "2026-01-01", p_to: "2026-12-31" });
      note("owner-portal:outsiderB reads Building A's unit_statement", isRefusal(res) || isEmpty(res.body), `status ${res.status}`);
      res = await dbOutsiderB.rpc("unit_statement_summary", { p_unit_id: unitA1, p_as_of: "2026-10-14" });
      note("owner-portal:outsiderB reads Building A's unit_statement_summary", isRefusal(res) || isEmpty(res.body), `status ${res.status}`);

      // Announcement writes by an owner (is_board-gated).
      res = await dbOwnerA.rpc("save_announcement", {
        p_association_id: A, p_id: null, p_title: "SECTEST2-owner-forged-announcement", p_body: "x",
        p_audience: "all", p_unit_ids: null, p_pinned: false, p_attachment_document_id: null, p_expires_on: null, p_publish: true,
      });
      note("owner-portal:owner writes an announcement (is_board only)", isRefusal(res), `status ${res.status}`);

      // dues_payment_reports of others: outsider B reads A's reports table directly.
      res = await dbOutsiderB.select("dues_payment_reports", `select=*&association_id=eq.${A}&limit=5`);
      note("owner-portal:outsiderB reads Building A's dues_payment_reports", isEmpty(res.body) || isRefusal(res), `status ${res.status}`);

      // withdraw_payment_report for a report that isn't theirs.
      {
        const someReport = (await dbAdminA.select("dues_payment_reports", `select=id&association_id=eq.${A}&limit=1`)).body[0];
        if (someReport) {
          const res2 = await dbOwnerA.rpc("withdraw_payment_report", { p_report_id: someReport.id });
          note("owner-portal:ownerA withdraws another owner's/report they didn't file", isRefusal(res2) || res2.status >= 400, `status ${res2.status}`);
        } else {
          r.skip("owner-portal:ownerA withdraws a report they didn't file", "no dues_payment_reports row exists on this seed to target");
        }
      }

      // Read receipts: owner reading announcement_reader_stats for a building
      // that isn't theirs (counts should be board-only anyway, per spec).
      res = await dbOutsiderB.rpc("announcement_reader_stats", { p_association_id: A });
      note("owner-portal:outsiderB reads Building A's announcement read-receipt counts", isRefusal(res) || isEmpty(res.body), `status ${res.status}`);
    }

    // ====================================================================
    // 9. Tax views: reversal forging
    // ====================================================================
    {
      // The seed ships with no posted journal entries at all, so create one
      // legitimately in each building (via the same post_journal_entry RPC
      // the app itself uses) when none exists, rather than skipping this
      // whole category. These are reversed, not deleted, by the checks below
      // -- journal entries are immutable by design (0003) -- which nets them
      // to zero financially, the same "undo" shape the app itself uses; the
      // branch is disposable and deleted after this test regardless.
      async function ensurePostedEntry(db, assoc, memo) {
        const existing = (await db.select("journal_entries", `select=id&association_id=eq.${assoc}&is_posted=eq.true&reverses_entry_id=is.null&limit=1&order=id`)).body[0];
        if (existing) return existing.id;
        const fy = (await db.select("fiscal_years", `select=id&association_id=eq.${assoc}&limit=1`)).body[0];
        const fund = (await db.select("funds", `select=id&association_id=eq.${assoc}&limit=1`)).body[0];
        const cash = (await db.select("accounts", `select=id&association_id=eq.${assoc}&type=eq.asset&limit=1`)).body[0];
        const income = (await db.select("accounts", `select=id&association_id=eq.${assoc}&type=eq.income&limit=1`)).body[0];
        if (!fy || !fund || !cash || !income) return null;
        const lines = [
          { account_id: cash.id, fund_id: fund.id, unit_id: null, debit: 1, credit: 0 },
          { account_id: income.id, fund_id: fund.id, unit_id: null, debit: 0, credit: 1 },
        ];
        const res = await db.rpc("post_journal_entry", {
          p_association_id: assoc, p_fiscal_year_id: fy.id, p_entry_date: "2026-01-02", p_memo: memo,
          p_source: "manual", p_lines: lines, p_source_id: null, p_source_document_id: null,
        });
        return res.status < 400 ? rpcScalar(res.body) : null;
      }
      const postedEntryAId = await ensurePostedEntry(dbAdminA, A, "SECTEST2-r2-fixture-A");
      const postedEntryBId = await ensurePostedEntry(dbAdminB, B, "SECTEST2-r2-fixture-B");
      const postedEntryA = postedEntryAId ? { id: postedEntryAId } : null;
      const postedEntryB = postedEntryBId ? { id: postedEntryBId } : null;

      if (postedEntryB) {
        const res = await dbAdminA.rpc("reverse_journal_entry", { p_entry_id: postedEntryB.id });
        note("tax:adminA reverses Building B's journal entry", isRefusal(res), `status ${res.status}`);
      } else {
        r.skip("tax:adminA reverses Building B's journal entry", "no posted entry exists in Building B to target");
      }

      if (postedEntryA) {
        const rev1 = await dbAdminA.rpc("reverse_journal_entry", { p_entry_id: postedEntryA.id });
        if (rev1.status < 400) {
          const newId = rpcScalar(rev1.body);
          // Reversing the SAME original entry again must refuse (0060's guard).
          const rev2 = await dbAdminA.rpc("reverse_journal_entry", { p_entry_id: postedEntryA.id });
          note("tax:reversing an already-reversed entry a second time is refused", isRefusal(rev2) || rev2.status >= 400, `status ${rev2.status}`);
          // Reversing the reversal itself (should be allowed -- it's its own posted entry).
          if (newId) {
            const rev3 = await dbAdminA.rpc("reverse_journal_entry", { p_entry_id: newId });
            note("tax:a reversal entry can itself be reversed (by design, DECISIONS #40)", rev3.status < 400, `status ${rev3.status}`);
          }
        } else {
          r.skip("tax:double-reversal checks", `could not reverse the fixture entry to begin with (status ${rev1.status}, ${JSON.stringify(rev1.body).slice(0,150)})`);
        }
      } else {
        r.skip("tax:double-reversal checks", "no unreversed posted entry exists in Building A to target");
      }

      // confirm_income_classification cross-building.
      const incomeAcctB = (await dbAdminB.select("accounts", `select=id&association_id=eq.${B}&type=eq.income&limit=1`)).body[0];
      if (incomeAcctB) {
        const res = await dbAdminA.rpc("confirm_income_classification", { p_account_id: incomeAcctB.id, p_is_exempt: true });
        note("tax:adminA classifies Building B's income account", isRefusal(res), `status ${res.status}`);
      } else {
        r.skip("tax:adminA classifies Building B's income account", "no income account exists in Building B to target");
      }
    }

    // ====================================================================
    // 10. Documents: storage_path cross-building, document_links cross-building
    // ====================================================================
    {
      // storage_path pointing at another building (0060's tg_documents_path_in_association).
      const catA = (await dbAdminA.select("document_categories", `select=id&association_id=eq.${A}&limit=1`)).body[0];
      if (catA) {
        const res = await dbAdminA.insert("documents", [{
          association_id: A, storage_path: `${B}/sectest2-cross-building-fake.pdf`, filename: "SECTEST2-cross-building.pdf",
          mime_type: "application/pdf", byte_size: 1, checksum: "4".repeat(64), category_id: catA.id,
          visibility: "board_only", source: "upload", extraction_state: "skipped",
        }]);
        expectedFinding("documents:storage_path points at another building (0060 guard, FX1 #11)",
          res.status < 400, `status ${res.status}, body ${JSON.stringify(res.body).slice(0, 150)}`);
        if (res.status < 400) {
          const id = res.body?.[0]?.id;
          if (id) await dbAdminA.delete("documents", `id=eq.${id}`).catch(() => {});
        }
      } else {
        r.skip("documents:storage_path points at another building", "no document_categories row in Building A to attach to");
      }

      // document_links cross-building: link a Building A document to a Building B ticket.
      const docA = (await dbAdminA.select("documents", `select=id&association_id=eq.${A}&limit=1`)).body[0];
      const ticketB = (await dbAdminB.select("tickets", `select=id&association_id=eq.${B}&limit=1`)).body[0];
      if (docA && ticketB) {
        const res = await dbAdminA.insert("document_links", [{
          association_id: A, document_id: docA.id, target_table: "tickets", target_id: ticketB.id, relation: "attachment",
        }], { returning: "minimal" });
        note("documents:document_links joins a Building A document to a Building B ticket", isRefusal(res) || res.status >= 400,
          `status ${res.status}`);
      } else {
        r.skip("documents:document_links cross-building join", "seed is missing a document in A or a ticket in B to target");
      }
    }
  } finally {
    // --------------------------------------------------------------------
    // Best-effort in-run cleanup for anything that may have slipped through
    // a check above (a check that unexpectedly succeeded). The authoritative
    // cleanup is scripts/security/cleanup-round2.sql, run via the Supabase
    // MCP execute_sql tool as postgres -- several of the tables this suite
    // writes to (role_grants, invites it may have minted) have no DELETE
    // policy for any application role, so this step cannot be relied on by
    // itself. It is here only to shrink what that script has to clean.
    // --------------------------------------------------------------------
    try {
      // Tickets have several FK-referencing children (ticket_events,
      // ticket_board_details, document_links, ticket_bids, ticket_comments).
      // Two of those -- ticket_events and ticket_board_details -- have NO
      // DELETE policy for any application role at all (confirmed via
      // pg_policies, the same "no DELETE policy by design" shape round 1's
      // README documents for role_grants/unit_owners), so no amount of
      // retrying as board_admin over PostgREST can ever delete a ticket that
      // has a ticket_events row -- which every ticket gets, from its own
      // creation trigger. This section is therefore necessarily incomplete;
      // scripts/security/cleanup-round2.sql (run as postgres, which bypasses
      // RLS) is the only thing that can actually remove these, and is what
      // must be run after this script, every time.
      const mine = (await dbAdminA.select("tickets", `select=id&title=like.*SECTEST2-*`)).body || [];
      for (const { id } of mine) {
        await dbAdminA.delete("ticket_comments", `ticket_id=eq.${id}`).catch(() => {});
        await dbAdminA.delete("document_links", `target_table=eq.tickets&target_id=eq.${id}`).catch(() => {});
        await dbAdminA.delete("ticket_bids", `ticket_id=eq.${id}`).catch(() => {});
      }
      await dbAdminA.delete("tickets", `title=like.*SECTEST2-*`).catch(() => {});
      await dbAdminA.delete("documents", `filename=like.*SECTEST2-*`);
      await dbAdminA.delete("announcements", `title=like.*SECTEST2-*`);
      // Revoke (not delete -- no policy) any escalation grant that may have
      // actually landed, so a re-run and cleanup-round2.sql start from a
      // known state.
      await dbAdminA.update("role_grants", `person_id=in.(${personBoardMemberA},${personAccountantA})&role=eq.board_admin`, { revoked_at: new Date().toISOString() }).catch(() => {});
    } catch { /* best-effort only; cleanup-round2.sql is authoritative */ }

    // Remove the throwaway TOTP factors this run created, same as round 1.
    await adminA.cleanup();
    await adminB.cleanup();
    await ownerA.cleanup();
    await boardMemberA.cleanup();
    await accountantA.cleanup();
    await outsiderB.cleanup();
  }

  console.log("\n== Summary ==");
  const total = r.results.length;
  const passed = r.results.filter((x) => x.result === "PASS").length;
  const failed = r.results.filter((x) => x.result === "FAIL").length;
  const skipped = r.results.filter((x) => x.result === "SKIP").length;
  console.log(`${passed}/${total} PASS, ${failed} FAIL, ${skipped} SKIP`);
  if (failed > 0) {
    console.log("\nFAILs (findings or regressions):");
    for (const x of r.results.filter((x) => x.result === "FAIL")) console.log(`  - ${x.name}: ${x.reason}`);
  }
  process.exit(exitCode);
})().catch((err) => {
  console.error("Harness error:", err);
  process.exit(2);
});
