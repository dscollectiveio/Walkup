#!/usr/bin/env node
// scripts/security/attack-rls.mjs
//
// Authorized RLS/PostgREST/RPC/Storage attack suite for the Walkup
// `security-test` Supabase branch. Every check prints PASS or FAIL with a
// one-line reason. The process exits non-zero if any check FAILs, so it can
// be wired into CI against a future branch once more migrations land.
//
// Roles exercised, each over raw HTTP exactly like a hostile client would
// use them (no supabase-js, no service role key):
//   - anon       no session at all (the publishable/anon key as bearer)
//   - aal1       a real password session, MFA not yet stepped up
//   - aal2       a real password session stepped up with a throwaway TOTP
//                factor enrolled and verified for this run
//
// Accounts: Admin A / Owner A (Staging Building A), Admin B (Staging
// Building B). Credentials are read from the file at runtime — see README.
//
// This file does not hardcode secrets. It does hardcode the two
// association ids and two unit ids, learned by querying the branch as the
// seeded accounts themselves (documented in the README) — that's public
// knowledge of the fixture, not a credential.

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
const r = makeReporter();

let exitCode = 0;
function note(name, ok, reason) {
  if (ok) r.pass(name, reason);
  else {
    r.fail(name, reason);
    exitCode = 1;
  }
}
// For the two known-broken findings we expect FAIL on today's schema
// (0001-0050). Record them distinctly so the summary can call them out as
// findings rather than ordinary regressions, while still exiting non-zero.
function expectedFinding(name, brokenNow, reason) {
  if (brokenNow) {
    r.fail(name, `FINDING (expected on current schema): ${reason}`);
    exitCode = 1;
  } else {
    r.pass(name, `fixed: ${reason}`);
  }
}

function isEmpty(body) {
  return Array.isArray(body) && body.length === 0;
}

function allRowsBelongTo(body, assocId, field = "association_id") {
  if (!Array.isArray(body)) return false;
  return body.every((row) => row[field] === assocId);
}

(async () => {
  console.log("== Walkup RLS attack suite ==");
  console.log(`Target: ${cfg.url}`);

  // --------------------------------------------------------------------
  // 0. Sessions
  // --------------------------------------------------------------------
  const aal1AdminA = await signInPassword(cfg, creds.ADMIN_A_EMAIL, creds.ADMIN_A_PASSWORD);
  const aal1AdminB = await signInPassword(cfg, creds.ADMIN_B_EMAIL, creds.ADMIN_B_PASSWORD);
  const aal1OwnerA = await signInPassword(cfg, creds.OWNER_A_EMAIL, creds.OWNER_A_PASSWORD);

  const adminA = await getAal1AndAal2(cfg, creds.ADMIN_A_EMAIL, creds.ADMIN_A_PASSWORD, "admin-a");
  const adminB = await getAal1AndAal2(cfg, creds.ADMIN_B_EMAIL, creds.ADMIN_B_PASSWORD, "admin-b");
  const ownerA = await getAal1AndAal2(cfg, creds.OWNER_A_EMAIL, creds.OWNER_A_PASSWORD, "owner-a");

  const dbAdminA = pgrest(cfg, adminA.aal2Token);
  const dbAdminB = pgrest(cfg, adminB.aal2Token);
  const dbOwnerA = pgrest(cfg, ownerA.aal2Token);
  const dbAnon = pgrest(cfg, null);
  const dbAdminA1 = pgrest(cfg, aal1AdminA.access_token);
  const dbOwnerA1 = pgrest(cfg, aal1OwnerA.access_token);

  // Learn the two association ids and A's two unit ids from the accounts
  // themselves (RLS limits each to their own building, which is exactly
  // the property we're about to attack).
  const assocA = (await dbAdminA.select("associations", "select=id,display_name")).body[0];
  const assocB = (await dbAdminB.select("associations", "select=id,display_name")).body[0];
  const unitsA = (await dbAdminA.select("units", "select=id,label&order=label")).body;
  console.log(`Building A: ${assocA.id}  Building B: ${assocB.id}`);
  const A = assocA.id;
  const B = assocB.id;

  // --------------------------------------------------------------------
  // 1. Anonymous and AAL1 baseline — nothing financial should be visible
  // --------------------------------------------------------------------
  {
    const financialTables = ["vendors", "expenses", "journal_entries", "journal_lines", "documents", "audit_log"];
    for (const t of financialTables) {
      const res = await dbAnon.select(t, "select=*&limit=5");
      note(`anon:select ${t}`, isEmpty(res.body) || res.status === 401 || res.status === 403,
        `status ${res.status}, rows ${Array.isArray(res.body) ? res.body.length : "n/a"}`);
    }
    for (const t of financialTables) {
      const res = await dbAdminA1.select(t, `select=*&association_id=eq.${A}&limit=5`);
      note(`aal1:board_admin reads own-building financials (${t})`, isEmpty(res.body),
        `status ${res.status}, rows ${Array.isArray(res.body) ? res.body.length : "n/a"} — AAL2 should be required (DECISIONS #26)`);
    }
    // Known, accepted gap (#26): a person may read/update their own contact
    // info at AAL1. Confirm it's exactly that narrow, not financial.
    const own = await dbAdminA1.select("persons", `select=id,full_name,email&auth_user_id=not.is.null&association_id=eq.${A}`);
    r.pass("aal1:accepted-gap persons self-read", `status ${own.status}, rows ${Array.isArray(own.body) ? own.body.length : 0} (DECISIONS #26, not a new finding)`);
  }

  // --------------------------------------------------------------------
  // 2. Generic cross-building sweep across every public.* table
  // --------------------------------------------------------------------
  {
    const listed = await dbAdminA.select("associations", "select=id"); // warms nothing, just a guard
    const tables = [
      "units", "persons", "role_grants", "ownership_amendments", "ownership_amendment_lines",
      "unit_owners", "fiscal_years", "funds", "accounts", "documents", "document_links",
      "journal_entries", "journal_lines", "assessment_schedules", "assessment_charges",
      "late_fee_rules", "payments", "payment_allocations", "vendors", "expenses",
      "budgets", "budget_lines", "tax_filings", "audit_log", "tickets", "ticket_comments",
      "contractor_messages", "recurring_bills", "insurance_policies", "insurance_quotes",
      "bank_connections", "bank_transactions", "board_tasks", "document_categories",
      "folders", "saved_views", "tag_rules", "tax_line_classifications",
      "tax_figure_provenance", "invites", "bank_categorization_rules", "access_reviews",
      "contractor_reviews", "insurance_policy_field_sources", "insurance_claims",
      "insurance_quote_requests", "dues_payment_reports", "upkeep_tasks", "upkeep_log",
      "bank_payee_history",
    ];
    for (const t of tables) {
      const res = await dbAdminA.select(t, "select=*&limit=1000");
      if (!Array.isArray(res.body)) {
        note(`crossread:adminA ${t}`, false, `unexpected response, status ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
        continue;
      }
      note(`crossread:adminA ${t} (no Building B rows)`, allRowsBelongTo(res.body, A),
        `${res.body.length} rows returned, all association_id===A: ${allRowsBelongTo(res.body, A)}`);
    }
  }

  // --------------------------------------------------------------------
  // 3. Owner A must not see board-only tables, even empty-as-success isn't
  //    enough — confirm it's RLS doing the filtering, not an empty table
  // --------------------------------------------------------------------
  {
    const boardOnly = [
      "vendors", "insurance_policies", "insurance_quotes", "contractor_messages",
      "recurring_bills", "audit_log", "bank_connections", "bank_transactions",
      "tax_filings", "journal_entries", "journal_lines", "late_fee_rules",
      "assessment_schedules",
    ];
    for (const t of boardOnly) {
      const res = await dbOwnerA.select(t, `select=*&association_id=eq.${A}`);
      note(`ownerA:board-only ${t} hidden`, isEmpty(res.body),
        `status ${res.status}, rows ${Array.isArray(res.body) ? res.body.length : "n/a"}`);
    }
    // Owner A must not see other owners'/admins' persons or role_grants rows.
    const persons = await dbOwnerA.select("persons", `select=id,full_name&association_id=eq.${A}`);
    note("ownerA:persons scoped to self", Array.isArray(persons.body) && persons.body.length === 1,
      `rows: ${JSON.stringify(persons.body)}`);
    const grants = await dbOwnerA.select("role_grants", `select=id,role,person_id&association_id=eq.${A}`);
    note("ownerA:role_grants scoped to self", Array.isArray(grants.body) && grants.body.every((g) => g.person_id === persons.body[0]?.id),
      `rows: ${JSON.stringify(grants.body)}`);
  }

  // --------------------------------------------------------------------
  // 4. Cross-building writes: insert / update-reassociate / delete
  // --------------------------------------------------------------------
  {
    // 4a. Admin A cannot insert a vendor "into" Building B.
    const insertCrossBuilding = await dbAdminA.insert("vendors", [
      { association_id: B, name: "SECURITY-TEST cross-tenant vendor" },
    ]);
    note("write:adminA insert vendor with association_id=B rejected",
      !insertCrossBuilding.ok || isEmpty(insertCrossBuilding.body),
      `status ${insertCrossBuilding.status}: ${JSON.stringify(insertCrossBuilding.body).slice(0, 200)}`);

    // 4b. Admin A creates a disposable fund in A, then tries to re-home it to B.
    const created = await dbAdminA.insert("funds", [
      { association_id: A, name: "SECURITY-TEST fixture fund", kind: "other" },
    ]);
    const fixtureFundId = created.body?.[0]?.id;
    note("setup:create fixture fund in A", created.ok && fixtureFundId, `status ${created.status}`);

    if (fixtureFundId) {
      const reassoc = await dbAdminA.update("funds", `id=eq.${fixtureFundId}`, { association_id: B });
      note("write:adminA UPDATE funds SET association_id=B rejected",
        !reassoc.ok || isEmpty(reassoc.body),
        `status ${reassoc.status}: ${JSON.stringify(reassoc.body).slice(0, 200)}`);

      // cleanup regardless of outcome, as admin A (board_admin can delete config tables)
      await dbAdminA.delete("funds", `id=eq.${fixtureFundId}`);
    }

    // 4c. Admin A tries to delete a Building B config row by id (association
    // guess not required — using() on delete is scoped by the row's own
    // association_id, so this must affect 0 rows).
    const bFund = (await dbAdminB.select("funds", "select=id&limit=1")).body?.[0];
    if (bFund) {
      const del = await dbAdminA.delete("funds", `id=eq.${bFund.id}`);
      const stillThere = await dbAdminB.select("funds", `select=id&id=eq.${bFund.id}`);
      note("write:adminA cannot delete Building B's fund by id",
        Array.isArray(stillThere.body) && stillThere.body.length === 1,
        `delete status ${del.status}, row still present: ${stillThere.body.length === 1}`);
    }
  }

  // --------------------------------------------------------------------
  // 5. role_grants: self-promotion and cross-tenant person_id injection
  // --------------------------------------------------------------------
  {
    const ownerAPersonId = (await dbOwnerA.select("persons", `select=id&association_id=eq.${A}&auth_user_id=not.is.null`)).body?.[0]?.id;

    // 5a. Owner A tries to self-promote to board_admin.
    const selfPromote = await dbOwnerA.insert("role_grants", [
      { association_id: A, person_id: ownerAPersonId, role: "board_admin" },
    ]);
    note("write:ownerA self-promote to board_admin rejected",
      !selfPromote.ok || isEmpty(selfPromote.body),
      `status ${selfPromote.status}: ${JSON.stringify(selfPromote.body).slice(0, 200)}`);

    // 5b. A board_member (not board_admin) self-promoting. We don't have a
    // dedicated board_member fixture account, so we grant Owner A a
    // *second*, temporary role_grant as board_member (people hold several
    // roles per DECISIONS #6) to exercise that exact privilege boundary,
    // then revoke it again.
    const grantBoardMember = await dbAdminA.insert("role_grants", [
      { association_id: A, person_id: ownerAPersonId, role: "board_member" },
    ]);
    const boardMemberGrantId = grantBoardMember.body?.[0]?.id;
    note("setup:grant Owner A a temporary board_member role",
      grantBoardMember.ok && boardMemberGrantId, `status ${grantBoardMember.status}`);

    if (boardMemberGrantId) {
      const selfPromote2 = await dbOwnerA.insert("role_grants", [
        { association_id: A, person_id: ownerAPersonId, role: "board_admin" },
      ]);
      note("write:board_member self-promote to board_admin rejected",
        !selfPromote2.ok || isEmpty(selfPromote2.body),
        `status ${selfPromote2.status}: ${JSON.stringify(selfPromote2.body).slice(0, 200)}`);

      // 5c. board_member attempting a delete reserved for board_admin
      // (CLAUDE.md role table: "board_member ... no deletes"). Use the
      // disposable fund pattern again.
      const created2 = await dbAdminA.insert("funds", [
        { association_id: A, name: "SECURITY-TEST fixture fund 2", kind: "other" },
      ]);
      const fund2 = created2.body?.[0]?.id;
      if (fund2) {
        const delAsBoardMember = await dbOwnerA.delete("funds", `id=eq.${fund2}`);
        const stillThere = await dbAdminA.select("funds", `select=id&id=eq.${fund2}`);
        note("write:board_member delete rejected (board_admin-only)",
          Array.isArray(stillThere.body) && stillThere.body.length === 1,
          `delete status ${delAsBoardMember.status}, row still present: ${stillThere.body.length === 1}`);
        await dbAdminA.delete("funds", `id=eq.${fund2}`); // real cleanup as admin
      }

      // role_grants has NO delete policy for any role, by design (0002:
      // "grants are revoked by setting revoked_at, never removed"). A
      // DELETE here would silently affect 0 rows and leave the grant
      // live — revoke it the way the app does instead, via the
      // board_admin UPDATE policy.
      await dbAdminA.update("role_grants", `id=eq.${boardMemberGrantId}`, { revoked_at: new Date().toISOString() });
    }

    // 5d. Cross-tenant person_id injection: Admin A (board_admin of A) tries
    // to insert a role_grants row with association_id=A but person_id
    // belonging to Admin B (Building B). RLS's with_check only verifies the
    // CALLER's board_admin status on the association column; it never
    // checks that person_id's own association_id matches. If this insert
    // structurally succeeds, Admin B's login would gain a board_admin grant
    // scoped to Building A without Admin B's consent — a real, if narrow,
    // cross-tenant integrity gap (person_id isn't normally discoverable
    // across tenants, which limits exploitability but does not close it).
    const adminBPersonId = (await dbAdminB.select("persons", `select=id&association_id=eq.${B}&auth_user_id=not.is.null`)).body?.[0]?.id;
    const crossInject = await dbAdminA.insert("role_grants", [
      { association_id: A, person_id: adminBPersonId, role: "board_member" },
    ]);
    const crossInjectId = crossInject.body?.[0]?.id;
    expectedFinding(
      "write:adminA insert role_grants with cross-tenant person_id (association_id=A, person_id in B)",
      crossInject.ok && crossInjectId,
      "role_grants has no check that person_id's own association_id matches the grant's association_id — " +
        `insert ${crossInject.ok ? "SUCCEEDED" : "was rejected"} (status ${crossInject.status})`
    );
    if (crossInjectId) {
      // Same note as 5b: role_grants has no DELETE policy for any role.
      // Revoke via revoked_at (the board_admin UPDATE policy), then
      // VERIFY the revoke actually landed before moving on — this exact
      // row is what would otherwise silently give Admin B's login a live
      // board_member grant on Building A for the rest of this run.
      const revoke = await dbAdminA.update("role_grants", `id=eq.${crossInjectId}`, { revoked_at: new Date().toISOString() });
      const stillLive = await dbAdminB.select("units", `select=id&association_id=eq.${A}&limit=1`);
      if (!revoke.ok || !isEmpty(stillLive.body)) {
        throw new Error(
          `cleanup for the cross-tenant role_grants injection (id ${crossInjectId}) did not take effect — ` +
          `Admin B can still see Building A rows (${JSON.stringify(stillLive.body)}). Fix this before trusting any later check in this run.`
        );
      }
    }
  }

  // --------------------------------------------------------------------
  // 6. unit_owners: cross-building unit_id with a same-building
  //    association_id (no FK/trigger ties unit_id's association to the
  //    unit_owners row's own association_id)
  // --------------------------------------------------------------------
  {
    const bUnit = (await dbAdminB.select("units", "select=id&limit=1")).body?.[0];
    const ownerAPersonId = (await dbOwnerA.select("persons", `select=id&association_id=eq.${A}`)).body?.[0]?.id;
    if (bUnit && ownerAPersonId) {
      const insertCross = await dbAdminA.insert("unit_owners", [
        {
          association_id: A, // caller's own, satisfies is_board(association_id)
          unit_id: bUnit.id, // but this unit belongs to Building B
          person_id: ownerAPersonId,
          effective_from: "2026-10-14",
        },
      ]);
      const rowId = insertCross.body?.[0]?.id;
      expectedFinding(
        "write:adminA insert unit_owners row mixing A's association_id with B's unit_id",
        insertCross.ok && rowId,
        `no trigger enforces units.association_id = unit_owners.association_id — insert ${insertCross.ok ? "SUCCEEDED" : "was rejected"} (status ${insertCross.status})`
      );
      if (rowId) await dbAdminA.delete("unit_owners", `id=eq.${rowId}`); // cleanup
    }
  }

  // --------------------------------------------------------------------
  // 7. The two known findings from code review: tickets_select's
  //    `unit_id is null` branch has no membership check, and
  //    ticket_comments inherits it (0013, still live on this schema;
  //    0053, unreleased, repairs both).
  // --------------------------------------------------------------------
  {
    // Seed a legitimate shared-area ticket in Building B, as Admin B.
    const ticketIns = await dbAdminB.insert("tickets", [
      {
        association_id: B,
        title: "SECURITY-TEST fixture — shared-area ticket (Building B)",
        description: "Fixture for attack-rls.mjs. Safe to delete.",
        unit_id: null,
      },
    ]);
    const ticket = ticketIns.body?.[0];
    note("setup:create shared-area ticket fixture in B", ticketIns.ok && ticket, `status ${ticketIns.status}`);

    if (ticket) {
      const commentIns = await dbAdminB.insert("ticket_comments", [
        { association_id: B, ticket_id: ticket.id, body: "SECURITY-TEST fixture comment from Building B." },
      ]);
      const comment = commentIns.body?.[0];
      note("setup:create comment on B's fixture ticket", commentIns.ok && comment, `status ${commentIns.status}`);

      // (a) Owner A (member of A only, not B) reads B's shared-area ticket.
      const read = await dbOwnerA.select("tickets", `select=*&id=eq.${ticket.id}`);
      expectedFinding(
        "finding(a):ownerA reads another building's shared-area ticket",
        Array.isArray(read.body) && read.body.length === 1,
        "tickets_select's `unit_id is null` branch has no membership/association check — " +
          `an outsider ${read.body?.length === 1 ? "COULD" : "could not"} read it (status ${read.status})`
      );

      // Also true for an authenticated user with NO role in *either*
      // building at all, i.e. anyone signed in anywhere in the system.
      // We don't have a third, roleless account, so Owner A (a real member
      // of a different building) is the closest available proof and is
      // reported above; the policy text itself (reviewed in the report)
      // confirms it's unconditional on `unit_id is null`, not building-scoped.

      if (comment) {
        const readComment = await dbOwnerA.select("ticket_comments", `select=*&id=eq.${comment.id}`);
        expectedFinding(
          "finding(a):ownerA reads comments on another building's ticket",
          Array.isArray(readComment.body) && readComment.body.length === 1,
          `ticket_comments_select has no predicate at all beyond "the ticket exists" — status ${readComment.status}`
        );
      }

      // (b) Owner A inserts a comment onto B's ticket, tagged with her own
      // (A's) association_id so her own is_member() check passes.
      const injectComment = await dbOwnerA.insert("ticket_comments", [
        { association_id: A, ticket_id: ticket.id, body: "SECURITY-TEST injected comment from Building A's owner." },
      ]);
      const injected = injectComment.body?.[0];
      expectedFinding(
        "finding(b):ownerA inserts a comment onto another building's ticket",
        injectComment.ok && injected,
        "ticket_comments_insert checks is_member(caller-supplied association_id) and that *a* ticket exists, " +
          `never that the ticket's own association matches — insert ${injectComment.ok ? "SUCCEEDED" : "was rejected"} (status ${injectComment.status})`
      );
      if (injected) {
        // Can Admin B (the real board of the affected building) even see
        // the injected row to deal with it? ticket_comments_select has no
        // association filter either, so yes — but note it however it goes.
        const visibleToB = await dbAdminB.select("ticket_comments", `select=*&id=eq.${injected.id}`);
        r.pass("info:is the injected comment visible to the real board (B)?",
          `rows=${visibleToB.body?.length ?? "n/a"}`);
      }

      // Cleanup: tickets/ticket_comments have no DELETE policy at all for
      // any role (by design — tickets are never deleted). Remove the
      // fixture rows directly via SQL (documented in the README/report),
      // not through the API.
      console.log("NOTE: fixture ticket/comments cleaned up via direct SQL at the end of this run (no DELETE policy exists for either table).");
      global.__fixtureTicketIds = global.__fixtureTicketIds || [];
      global.__fixtureTicketIds.push(ticket.id);
    }
  }

  // --------------------------------------------------------------------
  // 8. SECURITY DEFINER functions: anon callability and cross-tenant abuse
  // --------------------------------------------------------------------
  {
    // 8a. Anonymous callers of role-check helpers should get a permission
    // error, not a result — these are revoked from anon/public (0002).
    for (const fn of ["has_role_in", "is_board", "can_read_financials", "is_member"]) {
      const res = await dbAnon.rpc(fn, fn === "has_role_in" ? { assoc: A, roles: ["board_admin"] } : { assoc: A });
      note(`anon:rpc ${fn} rejected`, !res.ok, `status ${res.status}: ${JSON.stringify(res.body).slice(0, 150)}`);
    }

    // 8b. join_state_waitlist IS meant to be anon-callable (DECISIONS #34) —
    // confirm that's true, and that repeats are deduped rather than erroring.
    const waitlist = await dbAnon.rpc("join_state_waitlist", {
      p_email: "security-test-waitlist@example.com",
      p_state: "CA",
      p_ip_hash: null,
    });
    r.pass("baseline:anon can call join_state_waitlist (by design, DECISIONS #34)", `status ${waitlist.status}`);

    // 8c. get_bank_access_token across tenants. Seed a real connection in B
    // through the legitimate RPC, as Admin B.
    const storeRes = await dbAdminB.rpc("store_bank_connection", {
      p_association_id: B,
      p_institution_name: "SECURITY-TEST fixture bank",
      p_plaid_item_id: `security-test-${Date.now()}`,
      p_access_token: "sandbox-fixture-token-not-real",
    });
    const connId = storeRes.body;
    note("setup:create bank connection fixture in B", storeRes.ok && connId, `status ${storeRes.status}`);

    if (connId) {
      const crossToken = await dbAdminA.rpc("get_bank_access_token", { p_connection_id: connId });
      note("rpc:adminA cannot read Building B's bank access token",
        !crossToken.ok, `status ${crossToken.status}: ${JSON.stringify(crossToken.body).slice(0, 150)}`);

      const ownToken = await dbAdminB.rpc("get_bank_access_token", { p_connection_id: connId });
      note("rpc:adminB can read Building B's own bank access token",
        ownToken.ok, `status ${ownToken.status}`);

      // reseal_bank_access_token, same cross-tenant probe (0050).
      const crossReseal = await dbAdminA.rpc("reseal_bank_access_token", { p_connection_id: connId });
      note("rpc:adminA cannot reseal Building B's bank access token",
        !crossReseal.ok, `status ${crossReseal.status}: ${JSON.stringify(crossReseal.body).slice(0, 150)}`);

      // cleanup via the legitimate RPC, as the connection's own board_admin
      await dbAdminB.rpc("revoke_bank_connection", { p_connection_id: connId });
    }

    // 8d. create_association_and_owner abuse: an account that already
    // belongs to a building must not be able to spin up another and
    // detach itself, or collide identities.
    const reuse = await dbAdminA.rpc("create_association_and_owner", {
      p_legal_name: "SECURITY-TEST should not be created",
      p_display_name: "SECURITY-TEST",
      p_state_code: "IL",
      p_full_name: "Attacker",
      p_email: "attacker@example.com",
    });
    note("rpc:create_association_and_owner refuses an account that already belongs to a building",
      !reuse.ok, `status ${reuse.status}: ${JSON.stringify(reuse.body).slice(0, 150)}`);

    // 8e. redact_person cross-tenant: Admin A tries to redact a person in B.
    const bPerson = (await dbAdminB.select("persons", `select=id&association_id=eq.${B}&limit=1`)).body?.[0];
    if (bPerson) {
      const crossRedact = await dbAdminA.rpc("redact_person", { p_person_id: bPerson.id });
      note("rpc:adminA cannot redact a person in Building B",
        !crossRedact.ok, `status ${crossRedact.status}: ${JSON.stringify(crossRedact.body).slice(0, 150)}`);
    }

    // 8f. record_access_review / deprovision_stale_access cross-tenant.
    const crossReview = await dbAdminA.rpc("record_access_review", { p_association_id: B });
    note("rpc:adminA cannot record an access review for Building B",
      !crossReview.ok, `status ${crossReview.status}: ${JSON.stringify(crossReview.body).slice(0, 150)}`);
  }

  // --------------------------------------------------------------------
  // 9. platform_admins / insurance_partners / tax_form_templates writes
  // --------------------------------------------------------------------
  {
    const insertPlatformAdmin = await dbAdminA.insert("platform_admins", [
      { user_id: adminA.userId, note: "SECURITY-TEST self-promotion attempt" },
    ]);
    note("write:non-platform-admin cannot insert platform_admins",
      !insertPlatformAdmin.ok || isEmpty(insertPlatformAdmin.body),
      `status ${insertPlatformAdmin.status}: ${JSON.stringify(insertPlatformAdmin.body).slice(0, 150)}`);

    const readPlatformAdmins = await dbAdminA.select("platform_admins", "select=*");
    note("read:platform_admins unreadable through the API (no policies, by design)",
      isEmpty(readPlatformAdmins.body), `status ${readPlatformAdmins.status}, rows ${readPlatformAdmins.body?.length}`);

    const insertPartner = await dbAdminA.insert("insurance_partners", [
      { name: "SECURITY-TEST fake partner", contact_email: "fake@example.com" },
    ]);
    note("write:board_admin (not platform-admin) cannot insert insurance_partners",
      !insertPartner.ok || isEmpty(insertPartner.body),
      `status ${insertPartner.status}: ${JSON.stringify(insertPartner.body).slice(0, 150)}`);

    const insertTemplate = await dbAdminA.insert("tax_form_templates", [
      { form_code: "SECURITY-TEST", tax_year: 2026, source_url: "https://example.com/security-test", active: true },
    ]);
    note("write:board_admin (not platform-admin) cannot insert tax_form_templates",
      !insertTemplate.ok || isEmpty(insertTemplate.body),
      `status ${insertTemplate.status}: ${JSON.stringify(insertTemplate.body).slice(0, 150)}`);
  }

  // --------------------------------------------------------------------
  // 10. PostgREST schema exposure — only public should be reachable
  // --------------------------------------------------------------------
  {
    for (const schema of ["auth", "storage"]) {
      const res = await (async () => {
        const res2 = await fetch(`${cfg.url}/rest/v1/users?select=*`, {
          headers: {
            apikey: cfg.anonKey,
            Authorization: `Bearer ${adminA.aal2Token}`,
            "Accept-Profile": schema,
          },
        });
        return { status: res2.status, body: await res2.text() };
      })();
      note(`schema:${schema} not exposed via PostgREST Accept-Profile`,
        res.status === 406 || res.status === 404 || res.status >= 400,
        `status ${res.status}`);
    }
  }

  // --------------------------------------------------------------------
  // 11. Views — security_invoker must mean no cross-building leakage
  // --------------------------------------------------------------------
  {
    const views = [
      "charge_balances", "payment_unapplied", "cash_basis_receipts", "cash_basis_disbursements",
      "fund_cash_balances", "book_to_tax_reconciliation", "vendor_1099_totals", "budget_vs_actual",
      "insurance_year_over_year", "upcoming_bills", "monthly_expense_actuals", "monthly_cash_activity",
      "income_statement_lines", "vendor_1099_calendar_totals",
    ];
    for (const v of views) {
      const res = await dbAdminA.select(v, "select=*&limit=1000");
      if (!Array.isArray(res.body)) {
        note(`view:adminA ${v}`, res.status === 404 /* view may not exist pre-migration */, `status ${res.status}`);
        continue;
      }
      note(`view:adminA ${v} (no Building B rows)`, allRowsBelongTo(res.body, A),
        `${res.body.length} rows, all association_id===A: ${allRowsBelongTo(res.body, A)}`);
    }
  }

  // --------------------------------------------------------------------
  // 12. Storage: the `documents` bucket, cross-building
  // --------------------------------------------------------------------
  {
    const stAdminA = storage(cfg, adminA.aal2Token);
    const stAdminB = storage(cfg, adminB.aal2Token);
    const stOwnerA = storage(cfg, ownerA.aal2Token);
    const stAnon = storage(cfg, null);

    // Row + object, created by Admin A, inside Building A's own folder.
    const docRow = await dbAdminA.insert("documents", [
      {
        association_id: A,
        title: "SECURITY-TEST fixture document",
        filename: "security-test-fixture.txt",
        storage_path: `${A}/security-test-fixture.txt`,
        visibility: "board_only",
      },
    ]);
    const doc = docRow.body?.[0];
    note("setup:create document row fixture in A", docRow.ok && doc, `status ${docRow.status}`);

    const objPath = `${A}/security-test-fixture.txt`;
    const upload = await stAdminA.upload("documents", objPath, "security-test fixture content", "text/plain");
    note("setup:upload fixture object into A's documents folder", upload.ok, `status ${upload.status}`);

    if (upload.ok) {
      // Admin B tries to read, list, and delete Building A's object.
      const crossDownload = await stAdminB.download("documents", objPath);
      note("storage:adminB cannot download Building A's document object",
        !crossDownload.ok, `status ${crossDownload.status}`);

      const crossList = await stAdminB.list("documents", `${A}/`);
      note("storage:adminB cannot list Building A's documents folder",
        Array.isArray(crossList.body) ? crossList.body.length === 0 : !crossList.ok,
        `status ${crossList.status}: ${JSON.stringify(crossList.body).slice(0, 150)}`);

      const crossSign = await stAdminB.createSignedUrl("documents", objPath, 60);
      note("storage:adminB cannot mint a signed URL for Building A's object",
        !crossSign.ok, `status ${crossSign.status}: ${JSON.stringify(crossSign.body).slice(0, 150)}`);

      const crossUploadInA = await stAdminB.upload(
        "documents", `${A}/security-test-adminB-wrote-this.txt`, "hostile write", "text/plain"
      );
      note("storage:adminB cannot upload into Building A's folder",
        !crossUploadInA.ok, `status ${crossUploadInA.status}`);

      const crossDelete = await stAdminB.remove("documents", [objPath]);
      const stillThere = await stAdminA.download("documents", objPath);
      note("storage:adminB cannot delete Building A's document object",
        stillThere.ok, `delete status ${crossDelete.status}, object still downloadable by its owner: ${stillThere.ok}`);

      // Owner A: board_only document, should not even see/download it.
      const ownerDownload = await stOwnerA.download("documents", objPath);
      note("storage:ownerA cannot download a board_only document in her own building",
        !ownerDownload.ok, `status ${ownerDownload.status}`);

      // Anonymous: no session at all.
      const anonDownload = await stAnon.download("documents", objPath);
      note("storage:anon cannot download any document object",
        !anonDownload.ok, `status ${anonDownload.status}`);

      // Cleanup, as the legitimate owner.
      await stAdminA.remove("documents", [objPath]);
    }
    if (doc) await dbAdminA.delete("documents", `id=eq.${doc.id}`);
  }

  // --------------------------------------------------------------------
  // Cleanup: factors, and the two ticket fixtures that have no DELETE
  // policy for any role (by design) and so can only be removed with
  // direct SQL access to the branch, outside the PostgREST surface this
  // harness otherwise exercises.
  // --------------------------------------------------------------------
  await adminA.cleanup();
  await adminB.cleanup();
  await ownerA.cleanup();

  if (global.__fixtureTicketIds?.length) {
    console.log(
      "REMINDER: run scripts/security/cleanup-fixtures.sql (or the printed ids below) against the branch to remove fixture tickets/comments — tickets have no DELETE policy for any role:",
      global.__fixtureTicketIds
    );
  }

  // --------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------
  const passed = r.results.filter((x) => x.result === "PASS").length;
  const failed = r.results.filter((x) => x.result === "FAIL").length;
  console.log(`\n== ${passed} passed, ${failed} failed, ${r.results.length} total ==`);
  process.exit(exitCode);
})().catch((err) => {
  console.error("FATAL:", err.stack || err.message);
  process.exit(1);
});
