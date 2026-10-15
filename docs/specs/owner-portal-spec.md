# Owner portal: spec

Doug, 2026-10-14: "Owner portal. A clear owner view: what they owe, how to pay,
repairs, announcements." This spec designs it. It follows the quality bar and
ownership rules of `docs/specs/insurance-repairs-overhaul.md` (section 4: RLS
and a same-association guard on every new table, SECURITY DEFINER functions
with a pinned `search_path` and revoked from `anon`, money as text, plain
English with no em dashes, owners never see an empty board page pretending
nothing exists). It reuses `docs/specs/repairs-spec.md` section 14 (owner
repairs view) and section 3.10 (emergency facts), and the foundation's
`DirectUpload`, `DraftEmail` and mailto kit.

Status: design only. Nothing here has been applied. The SQL in section 3 was
applied to a scratch PGlite database (migrations 0001 to 0053 plus this file)
and exercised before it was written down here; the test plan in section 10
turns those checks into `tests/db/owner-portal.test.ts`.

Companion specs: `money-and-reminders-spec.md` (statements as PDF and email,
reminders) and `import-spec.md` (importing owners). Migration order is fixed:
**0054 owner portal, 0055 email reminders and statements, 0056 imports.**
0055 uses `unit_position_core` and `unit_statement_core` from this file, and
`associations.board_contact_email`.

---

## 0. Contents

1. Scope, what exists today, decisions
2. Information architecture: routes, `/` for owners, guards for board-only pages
3. Migration `0054_owner_portal.sql` (complete draft SQL)
4. Libraries and components
5. Server actions
6. Pages, with copy and states
7. Role-aware navigation: exact change list
8. Security and privacy notes
9. Mobile and accessibility
10. Test plan
11. Build order
12. Integration tasks
13. Deliberately left out

---

## 1. Scope, what exists today, decisions

### 1.1 What an owner gets

| Doug's ask | Owner sees | Built from |
|---|---|---|
| What they owe | Per unit they own: balance, what is past due, next due date, a statement with charges, payments and a running balance | `unit_statement_summary()`, `unit_statement()` (0054), over `assessment_charges`, `payments`, `payment_allocations` |
| How to pay | The association's payment details with a Copy button per field, a suggested memo, a fraud warning | `associations.dues_*` columns (0033), readable by every member |
| Report a payment I made | The existing "I paid another way" form, the owner's reports with status, and Withdraw | `dues_payment_reports` (0044), `reportOutsidePayment` (existing), `withdraw_payment_report()` (0054) |
| Repairs | Their reports, problems in their unit, shared areas, status, visit dates | repairs-spec section 14, unchanged; the portal home shows a summary and links in |
| Announcements | Board posts to everyone or to chosen units, pinned first, with an optional attachment | `announcements`, `announcement_units`, `announcement_reads` (0054) |
| Documents the board shared | Latest shared documents and a link to the hub | `documents_select` (0020), unchanged |
| Building contacts and emergency info | Board contact, who is on the board, the building's emergency facts and numbers | `associations.board_contact_*` (0054), `board_roster()` (0054), `building_emergency_info()` (0053) |
| Their own profile | Phone and mailing address (editable), name and email (read-only), their units | `update_my_profile()` (0054) |

### 1.2 What exists today (read from the code on 2026-10-14)

- `/` shows every signed-in person the board Dashboard. For an owner almost
  every card is empty because RLS returns `[]` from board-only tables.
- `/dues` has an inline owner branch (balance per unit, open charges, "How to
  pay", the report form). It is the seed of this portal; the portal replaces
  it and `/dues` redirects owner-only users to `/owner`.
- `/units/[unitId]` is a plain statement for owners and board with no running
  balance and no way to choose a period.
- `/delinquency`, `/bank-feed`, `/ledger`, `/tax`, `/financial-statements`,
  `/building` answer an owner with "No bank connected", "Nobody is behind" or
  "You don't have access to X". Section 2.4 fixes each.
- The sidebar is not role-aware: every signed-in person sees Bank Feed, Taxes,
  and so on.
- **A hole this spec must close.** `redeem_invite()` (0027) always inserts a
  NEW `persons` row. An owner the board already entered (with their unit,
  charges and history) who redeems an invite gets a second, empty person with
  no unit, so the portal would show them nothing. If the invite is prefilled
  with the owner's email and that email is already on the existing person, the
  insert fails on `persons_association_email_key`. Section 3 adds
  `invites.person_id` ("claim your record") and redefines `redeem_invite`.
- `persons_update` (0002) lets any person edit every column of their own row,
  including `full_name` and `email`. DECISIONS #26 accepted this for contact
  details. Section 3 narrows it to phone and mailing address for non-board
  callers (a trigger), which the portal's profile page relies on.

### 1.3 Decisions taken (proposed DECISIONS #38)

1. **`/owner` is the owner's home; `/` stays the URL everyone lands on.** An
   owner-only person (no board or accountant grant) is redirected from `/` to
   `/owner`. A board member who also owns a unit keeps the Dashboard at `/`
   and gets a "My unit" item in the sidebar that opens `/owner`.
2. **One statement rule everywhere.** A unit's net balance is open charge
   balances (`unit_balances.balance_owed`) minus payments not yet applied to a
   charge (`payment_unapplied`). Waived and written-off charges appear as
   adjustment lines. The statement's last running balance equals that net, and
   a DB test proves it. Portal, PDF (money spec) and email (money spec) all call
   the same two SQL functions.
3. **Owners read statements only through SECURITY DEFINER functions** that
   check `can_read_financials` or "owns this unit", and return no rows
   otherwise (same as a unit that does not exist, DECISIONS #17). No new
   direct policy on the ledger.
4. **Announcements are written only through RPCs** (like the ledger): the
   tables have SELECT policies and nothing else. Plain text only, no HTML, no
   comments, no replies. At most three pinned at once.
5. **An attachment must already be readable by the announcement's audience.**
   The Document Hub decides who can open a file (`documents_select`, and the
   storage policy defers to it). The announcement cannot widen that. Audience
   "everyone" needs an `all_owners` document; audience "chosen units" allows an
   attachment only when it is `all_owners`, or when exactly one unit is chosen
   and the document is pinned to that unit. The composer offers "Share this file
   with all owners" (an ordinary document update the board can already do)
   before posting.
6. **Read receipts are counts, to the board only.** The board sees "Read by 3
   of 4 owners who can sign in" and "1 owner has no login yet". Never names.
7. **Board contact is association data.** `associations.board_contact_name`,
   `board_contact_email`, `board_contact_phone`, set by a board admin, visible
   to members. It is where owners are told to write, and later (money spec) the
   reply-to on emails.
8. **Every board-only page shows an owner something honest.** A shared
   `BoardOnly` component says "This part is for the board", says what the page
   is, and points to the owner page that serves the same need. `Restricted`
   ("You don't have access") stays for genuinely unauthorised cases only.
9. **Signing in as yourself needs a linked record.** Owner invites can carry a
   `person_id`. Building Info gets "Invite to sign in" on each person without a
   login.
10. **Owners can change phone and mailing address, not name or email.** Name
    and email are the board's record (statements, notices and the audit trail
    depend on them).
11. **No money moves and nothing is sent.** DECISIONS #22 and #24 hold for the
    portal. (Email sending is DECISIONS #36 in the money spec.)

### 1.4 New DECISIONS #38 text

> **38. The owner portal: what an owner can read, and the one thing that was
> missing for them to sign in as themselves.** Decided by the lead engineer
> on Doug's behalf, 2026-10-14. Owners get a home page (`/owner`), a unit
> statement with a running balance, the payment instructions, their reports,
> board announcements (to everyone or chosen units, pinned, optional
> attachment, no comments), the documents the board shared, building contacts
> and emergency facts, and a profile. Everything an owner reads that is not
> already under RLS comes through a SECURITY DEFINER function that returns
> nothing to anyone but the unit's owner or a financial reader. Announcements
> are written only through RPCs; read receipts are counts for the board only.
> Invites can now point at an existing person (`invites.person_id`) so the
> owner who signs in IS the owner whose unit and history the board entered;
> before this an invited owner got a second, empty person. Owners may edit
> their phone and mailing address but not their name or email. Board-only
> pages show owners a `BoardOnly` page that says so and links to the owner
> page that serves the same need; they never show an empty state. The
> statement rule is one rule: net = open charge balances minus unapplied
> payments, waivers and write-offs as adjustment lines.

---

## 2. Information architecture

### 2.1 Routes

| Route | Who | What |
|---|---|---|
| `/owner` | anyone who owns a unit; board and accountant see "This page is for owners" (section 6.1) | Owner home |
| `/owner/statement` | owners | Redirects to the only unit's statement, or shows a unit chooser |
| `/owner/statement/[unitId]` | the unit's owners; financial readers (preview) | Statement with period picker |
| `/owner/pay` | owners | How to pay, report a payment, my reports |
| `/owner/building` | all members | Your building: contacts, board, emergency facts |
| `/owner/profile` | all members with a person | Profile |
| `/announcements` | all members | Owner: list. Board: list with compose, pin, archive, read counts |
| `/announcements/[id]` | audience, board | One announcement |
| `/announcements/new`, `/announcements/[id]/edit` | board | Composer |
| `/units/[unitId]` | board, accountant | Unchanged for them. Owners are redirected to `/owner/statement/[unitId]` |
| `/dues` | board, accountant | Unchanged for them. Owner-only users are redirected to `/owner/pay` |

Files:

```
src/app/owner/page.tsx                         server, owner home
src/app/owner/loading.tsx
src/app/owner/statement/page.tsx               redirect or chooser
src/app/owner/statement/[unitId]/page.tsx
src/app/owner/statement/[unitId]/statement-table.tsx   server-safe, no client state
src/app/owner/pay/page.tsx
src/app/owner/pay/copy-field.tsx               client
src/app/owner/pay/my-reports.tsx               client (Withdraw)
src/app/owner/building/page.tsx
src/app/owner/profile/page.tsx
src/app/owner/profile/profile-form.tsx         client
src/app/owner/profile/email-preferences-slot.tsx   returns null until the money spec replaces it
src/app/owner/actions.ts                       "use server": updateMyProfile, withdrawPaymentReport
src/app/announcements/page.tsx
src/app/announcements/[id]/page.tsx
src/app/announcements/[id]/mark-read.tsx       client
src/app/announcements/new/page.tsx
src/app/announcements/[id]/edit/page.tsx
src/app/announcements/composer.tsx             client
src/app/announcements/board-row.tsx            client (pin, archive, restore, delete draft)
src/app/announcements/actions.ts               "use server"
src/components/board-only.tsx                  BoardOnly
src/components/owner/money-answer.tsx          the balance Answer for one unit
src/components/owner/statement-download.tsx    PDF link, hidden until the money spec ships its route
src/lib/owner/viewer.ts                        server-only, cached per request
src/lib/owner/statement.ts                     pure: grouping, labels, formatting
src/lib/owner/standing.ts                      pure: summary row -> Answer props
src/lib/owner/announcements.ts                 pure + zod
src/lib/owner/repairs-summary.ts               server-only
src/lib/owner/flags.ts                         STATEMENT_PDF_ENABLED
tests/db/owner-portal.test.ts
tests/unit/owner-*.test.ts
```

### 2.2 `/` for owners

At the top of `HomePage` (after `getUser()`), call `getViewer()` (4.1). If the
viewer has a person and `isStaff` is false (no `board_admin`, `board_member` or
`accountant` grant), `redirect("/owner")`. A person with no person row yet
falls through to the existing behaviour (the proxy already sends them to
onboarding). Board members and accountants see the Dashboard as today. The
Dashboard does not change for them; the sidebar gains a "My unit" item when
`ownedUnitIds.length > 0` (section 7).

### 2.3 `getViewer`

```ts
// src/lib/owner/viewer.ts  (server-only; React cache() so layout and page share one call)
export interface Viewer {
  associationId: string;
  associationName: string;
  personId: string;
  fullName: string;
  firstName: string;               // first word of fullName, "there" if empty
  roles: ("board_admin" | "board_member" | "accountant" | "owner")[];
  isBoard: boolean;
  isBoardAdmin: boolean;
  canReadFinancials: boolean;
  isStaff: boolean;                // board or accountant
  ownedUnitIds: string[];
  boardContact: { name: string | null; email: string | null; phone: string | null };
}
export const getViewer: () => Promise<Viewer | null>;
// associations select (id, display_name, board_contact_*) limit 1, then rpc("viewer_context", { p_association_id }).
// Null when signed out, no association, or viewer_context returns no row (no person, or not aal2).
```

### 2.4 Guard for every board-only page

A new component, used by each page below in place of its empty state or its
`Restricted`:

```tsx
// src/components/board-only.tsx (server-safe)
export function BoardOnly(props: {
  what: string;                    // "The bank feed"
  why: string;                     // one sentence: what the page is
  alternative?: { label: string; href: string };   // the owner page that serves the same need
}): JSX.Element;
```

Renders (exact): H1 `This part is for the board`; paragraph `{what} is open to board members and the accountant. {why}`; if `alternative`, a button-styled link with its label; always, a muted line `Questions? Write to {boardContact.name ?? "the board"}` with a mailto link when `board_contact_email` is set, otherwise `Ask a board member.` It uses the standard `Card` look and `role="status"` is not needed (it is a page, not an alert).

Per-page change list (the pages are owned by other workstreams; these are
Integration tasks, section 12):

| Page | An owner sees today | Required |
|---|---|---|
| `/bank-feed` | renders "no bank connected" (RLS returns `[]`, so `connections` is not null) | at the top of the component, after the role rpc, `if (!viewer.isStaff) return <BoardOnly what="The bank feed" why="It shows the association's bank transactions, which only the board and the accountant can see." alternative={{ label: "See your statement", href: "/owner" }} />` |
| `/financial-statements` | `Restricted` | `BoardOnly what="Financial statements" why="Profit and loss reports are shared with owners as documents when the board decides to." alternative={{ label: "See documents shared with you", href: "/documents" }}` |
| `/budget` | the plan without actuals (already an owner view) | keep. Owners keep the Budget item; the page's own owner copy stays |
| `/dues` | inline owner view | owner-only users: `redirect("/owner/pay")`. Board unchanged |
| `/delinquency` | their own rows with "Nobody is behind" wording | `BoardOnly what="Who owes money" why="It lists every unit's balance, which is private to the board." alternative={{ label: "See your own balance", href: "/owner" }}` |
| `/ledger` | `Restricted` | `BoardOnly what="The general ledger" why="It holds every transaction, including other owners' payments." alternative={{ label: "See your statement", href: "/owner" }}` |
| `/tax` | `Restricted` | `BoardOnly what="Taxes" why="The association's tax returns and 1099s are prepared by the board with the accountant." alternative={{ label: "See documents shared with you", href: "/documents" }}` |
| `/building` | `Restricted` | `BoardOnly what="Building Info" why="It is where the board manages units, owners and who can sign in." alternative={{ label: "See your building", href: "/owner/building" }}` |
| `/units/[unitId]` | statement | owners: `redirect("/owner/statement/" + unitId)` when they own it; otherwise `BoardOnly`-free `Restricted what="this unit's ledger"` stays (it is a genuine "not yours") |
| `/insurance` | insurance-spec owner view | unchanged (insurance-spec) |
| `/repairs`, `/maintenance/[ticketId]`, `/repairs/emergency-info` | repairs-spec owner views | unchanged (repairs-spec). `view=contractors`, `view=today` and the pipeline fall back to `problems` for non-financial readers (repairs-spec 14) |
| `/documents` | entitled documents only | unchanged |
| `/contractors/[vendorId]`, `/admin/*`, `/tax/forms/*`, `/account/mfa` | | unchanged (not owner pages; `/contractors/[vendorId]` should `BoardOnly what="Contractor details"` for non-financial readers: Integration) |

The `BoardOnly` guard uses `getViewer()` (cached), so it costs no extra query
where the layout already loaded it.

---

## 3. Migration `supabase/migrations/0054_owner_portal.sql`

Complete SQL. Applied after 0053. It touches: `associations`, `invites`
(`redeem_invite` redefined with the same signature), `persons` (a trigger),
`dues_payment_reports` (a trigger), `document_links` (constraint widened), and
adds `announcements`, `announcement_units`, `announcement_reads`.

What it checks (all verified on PGlite before writing): owners get their own
unit only from `unit_statement_summary` and `unit_statement` and nothing for a
neighbour's; the statement's last balance equals owed minus unapplied credit
with a partial payment, an unapplied remainder and a waived late fee in play;
an owner cannot insert into `announcements` or call `save_announcement`; a
targeted announcement is invisible to a non-audience owner and to another
association; read counts reach the board only; a claimed invite links the
existing person and keeps the name the board typed; the persons guard refuses a
rename by an owner but not by a board admin; the eleventh pending report for a
unit is refused. The two lint tests in `tests/db/migrations.test.ts` and
`rls.test.ts` still pass (no new `anon`-callable function, search paths pinned,
RLS on, `association_id` on every table, numerics unchanged).

```sql
-- ============================================================================
-- Walkup — migration 0054: the owner portal
--
-- What an owner needs to see, read through narrow SECURITY DEFINER functions
-- or ordinary RLS, never through a board table:
--
--   1. Association contact details (who to write to), readable by members.
--   2. "Claim your record": an owner invite can point at a persons row the
--      board already created, so the person who signs in IS the person the
--      units, charges and payments belong to (redeem_invite, redefined).
--   3. A guard so an owner can change their own phone and mailing address but
--      not their name or email (those are the board's records).
--   4. viewer_context(): who am I, what do I hold, which units do I own, in
--      one round trip.
--   5. Statements: unit_statement() and unit_statement_summary(). One source
--      for the portal, the PDF and the email (money-and-reminders-spec).
--   6. Announcements: board posts to all owners or chosen units, pinned,
--      optional attachment from the Document Hub, read receipts (counts to
--      the board only). Written only through RPCs.
--   7. Small owner conveniences: board_roster(), update_my_profile(),
--      withdraw_payment_report(), a cap on pending payment reports.
--
-- DECISIONS #22/#24 hold: nothing here sends anything or moves money.
-- Money crosses the API as text (#20). Aggregates are SECURITY DEFINER (#23).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Association contact details
-- ----------------------------------------------------------------------------

alter table public.associations
  add column board_contact_name  text check (board_contact_name  is null or char_length(board_contact_name)  <= 120),
  add column board_contact_email text check (board_contact_email is null or (char_length(board_contact_email) <= 254 and board_contact_email ~ '^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$')),
  add column board_contact_phone text check (board_contact_phone is null or char_length(board_contact_phone) <= 40);

comment on column public.associations.board_contact_name is
  'Who owners write to ("The board", "Maria, treasurer"). Shown to every member. Also the reply-to name on emails Walkup sends for the board.';
comment on column public.associations.board_contact_email is
  'The address owners write to. Shown to every member. The only reply-to Walkup puts on association email. Set by a board admin.';
comment on column public.associations.board_contact_phone is
  'Optional phone number owners may call for non-emergencies. Emergency numbers live in building_emergency_contacts.';

-- ----------------------------------------------------------------------------
-- 2. Claim your record: invites that point at an existing person
-- ----------------------------------------------------------------------------

alter table public.invites
  add column person_id uuid references public.persons(id) on delete restrict;

create index invites_person_idx on public.invites (person_id) where person_id is not null;

comment on column public.invites.person_id is
  'When set, redeeming this invite links the signing-in login to this existing persons row (which must have no login yet) instead of creating a new person. This is how an owner the board already entered, with their unit and history, signs in as themselves.';

create or replace function public.tg_invite_person_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.person_id is not null then
    if not exists (
      select 1 from public.persons p
       where p.id = new.person_id and p.association_id = new.association_id
    ) then
      raise exception 'person belongs to a different association' using errcode = '42501';
    end if;
    if new.role <> 'owner' then
      raise exception 'an invite for an existing person can only grant the owner role'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.tg_invite_person_guard() from public, anon;
grant execute on function public.tg_invite_person_guard() to authenticated;

create trigger invites_person_guard
  before insert or update on public.invites
  for each row execute function public.tg_invite_person_guard();

-- Same signature as 0027, so existing callers are unaffected.
create or replace function public.redeem_invite(
  p_token     text,
  p_full_name text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_invite public.invites%rowtype;
  v_person public.persons%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_invite from public.invites where token = p_token;

  if v_invite.id is null then
    raise exception 'this invite link is not valid' using errcode = 'no_data_found';
  end if;
  if v_invite.redeemed_at is not null then
    raise exception 'this invite link has already been used' using errcode = 'no_data_found';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'this invite link has expired' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.persons where auth_user_id = v_uid) then
    raise exception 'this account already belongs to a building' using errcode = '23505';
  end if;

  if v_invite.person_id is not null then
    -- Claim an existing record. The name the board typed stays; the login is
    -- attached. A person who already has a login cannot be claimed twice.
    select * into v_person from public.persons
     where id = v_invite.person_id and association_id = v_invite.association_id
     for update;
    if not found then
      raise exception 'this invite link is not valid' using errcode = 'no_data_found';
    end if;
    if v_person.auth_user_id is not null then
      raise exception 'this person already has an account' using errcode = '23505';
    end if;
    update public.persons set auth_user_id = v_uid where id = v_person.id;
    insert into public.role_grants (association_id, person_id, role, granted_by)
    values (v_invite.association_id, v_person.id, 'owner', v_invite.created_by)
    on conflict (association_id, person_id, role)
    do update set revoked_at = null, revoked_by = null, expires_on = null;
  else
    insert into public.persons (association_id, full_name, email, auth_user_id)
    values (v_invite.association_id, p_full_name, v_invite.email, v_uid);

    insert into public.role_grants (association_id, person_id, role, granted_by)
    select v_invite.association_id, p.id, v_invite.role, v_invite.created_by
      from public.persons p
     where p.association_id = v_invite.association_id and p.auth_user_id = v_uid;
  end if;

  update public.invites
     set redeemed_at = now(), redeemed_by = v_uid
   where id = v_invite.id;

  return v_invite.association_id;
end $$;

revoke all on function public.redeem_invite(text, text) from public, anon;
grant execute on function public.redeem_invite(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Owners may edit their own phone and mailing address, nothing else
-- ----------------------------------------------------------------------------
-- persons_update (0002) lets anyone edit their own row. That was meant for
-- contact details. This trigger makes it so: when the caller is a signed-in
-- non-board user (current_user is the API role, not a definer function's
-- owner), name, email, association and login must not change.

create or replace function public.tg_persons_self_edit_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon')
     and not public.is_board(old.association_id) then
    if new.full_name is distinct from old.full_name
       or new.email is distinct from old.email
       or new.association_id is distinct from old.association_id
       or new.auth_user_id is distinct from old.auth_user_id then
      raise exception 'ask the board to change your name or email'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.tg_persons_self_edit_guard() from public, anon;
grant execute on function public.tg_persons_self_edit_guard() to authenticated;

create trigger persons_self_edit_guard
  before update on public.persons
  for each row execute function public.tg_persons_self_edit_guard();

create or replace function public.update_my_profile(
  p_association_id  uuid,
  p_phone           text,
  p_mailing_address text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_person uuid := public.current_person_id(p_association_id);
  v_phone  text := nullif(btrim(p_phone), '');
  v_addr   text := nullif(btrim(p_mailing_address), '');
begin
  if v_person is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_phone is not null and char_length(v_phone) > 40 then
    raise exception 'phone number is too long' using errcode = '22023';
  end if;
  if v_addr is not null and char_length(v_addr) > 300 then
    raise exception 'mailing address is too long' using errcode = '22023';
  end if;
  update public.persons set phone = v_phone, mailing_address = v_addr where id = v_person;
end $$;

revoke all on function public.update_my_profile(uuid, text, text) from public, anon;
grant execute on function public.update_my_profile(uuid, text, text) to authenticated;

comment on function public.update_my_profile(uuid, text, text) is
  'The signed-in person edits their own phone and mailing address. Name and email are the board''s record.';

-- ----------------------------------------------------------------------------
-- 4. viewer_context
-- ----------------------------------------------------------------------------

create or replace function public.viewer_context(p_association_id uuid)
returns table (
  person_id          uuid,
  full_name          text,
  roles              text[],
  is_board           boolean,
  is_board_admin     boolean,
  can_read_financials boolean,
  owned_unit_ids     uuid[]
)
language sql stable security definer set search_path = ''
as $$
  select p.id,
         p.full_name,
         coalesce((
           select array_agg(distinct g.role::text order by g.role::text)
             from public.role_grants g
            where g.person_id = p.id and g.revoked_at is null
              and (g.expires_on is null or g.expires_on >= current_date)
         ), '{}'::text[]),
         public.is_board(p_association_id),
         public.has_role_in(p_association_id, array['board_admin']::public.app_role[]),
         public.can_read_financials(p_association_id),
         coalesce((select array_agg(u) from public.owned_unit_ids(p_association_id) u), '{}'::uuid[])
    from public.persons p
   where p.id = public.current_person_id(p_association_id)
$$;

revoke all on function public.viewer_context(uuid) from public, anon;
grant execute on function public.viewer_context(uuid) to authenticated;

comment on function public.viewer_context(uuid) is
  'The caller''s own person, active roles and owned units in one call. Zero rows when the caller has no person here or the session is not aal2.';

-- ----------------------------------------------------------------------------
-- 5. Statements
-- ----------------------------------------------------------------------------
-- One rule everywhere: a unit's NET balance = open charge balances (what
-- unit_balances calls balance_owed) minus payments not yet applied to a
-- charge (payment_unapplied). The running balance on a statement ends at the
-- same figure. Waived and written-off charges appear as adjustment lines.
-- Gate: a financial reader, or the owner of that unit. Anyone else gets zero
-- rows, the same as a unit that does not exist (DECISIONS #17).

create or replace function public.unit_position_core(p_unit_id uuid, p_as_of date default current_date)
returns table (
  unit_id              uuid,
  unit_label           text,
  as_of                date,
  owed                 text,
  overdue              text,
  credit               text,
  net                  text,
  open_charges         integer,
  oldest_overdue_on    date,
  next_due_on          date,
  next_due_amount      text,
  last_payment_on      date,
  last_payment_amount  text
)
language sql stable security definer set search_path = ''
as $$
  with u as (
    select un.id, un.label, un.association_id
      from public.units un
     where un.id = p_unit_id
  ),
  ch as (
    select c.id, c.due_on,
           c.amount - coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.charge_id = c.id), 0) as bal
      from public.assessment_charges c
      join u on u.id = c.unit_id
     where c.waived_at is null and c.written_off_at is null
  ),
  open_ch as (select * from ch where bal > 0),
  cr as (
    select coalesce(sum(p.amount - coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.payment_id = p.id), 0)), 0) as credit
      from public.payments p join u on u.id = p.unit_id
  ),
  nd as (
    select min(due_on) as d from open_ch where due_on >= p_as_of
  ),
  lp as (
    select p.received_on, p.amount
      from public.payments p join u on u.id = p.unit_id
     order by p.received_on desc, p.created_at desc limit 1
  )
  select u.id, u.label, p_as_of,
         coalesce((select sum(bal) from open_ch), 0)::numeric(14,2)::text,
         coalesce((select sum(bal) from open_ch where due_on < p_as_of), 0)::numeric(14,2)::text,
         (select credit from cr)::numeric(14,2)::text,
         (coalesce((select sum(bal) from open_ch), 0) - (select credit from cr))::numeric(14,2)::text,
         (select count(*) from open_ch)::integer,
         (select min(due_on) from open_ch where due_on < p_as_of),
         (select d from nd),
         (select sum(bal)::numeric(14,2)::text from open_ch where due_on = (select d from nd)),
         (select received_on from lp),
         (select amount::numeric(14,2)::text from lp)
    from u
$$;

-- Internal: no access check, so it also serves the email sender (which has no
-- signed-in user). Nobody but other SECURITY DEFINER functions may call it.
revoke all on function public.unit_position_core(uuid, date) from public, anon, authenticated;

create or replace function public.unit_statement_summary(p_unit_id uuid, p_as_of date default current_date)
returns table (
  unit_id uuid, unit_label text, as_of date, owed text, overdue text, credit text, net text,
  open_charges integer, oldest_overdue_on date, next_due_on date, next_due_amount text,
  last_payment_on date, last_payment_amount text)
language sql stable security definer set search_path = ''
as $$
  select c.*
    from public.unit_position_core(p_unit_id, p_as_of) c
    join public.units un on un.id = c.unit_id
   where public.can_read_financials(un.association_id)
      or un.id in (select public.owned_unit_ids(un.association_id))
$$;

revoke all on function public.unit_statement_summary(uuid, date) from public, anon;
grant execute on function public.unit_statement_summary(uuid, date) to authenticated;

comment on function public.unit_statement_summary(uuid, date) is
  'One unit''s position as of a day: owed (open charges), overdue, unapplied credit, net, next due and last payment. Money as text. Financial readers and the unit''s owners only; anyone else gets no rows.';

create or replace function public.unit_statement_core(p_unit_id uuid, p_from date default null, p_to date default null)
returns table (
  seq         integer,
  line_date   date,
  kind        text,
  description text,
  charge      text,
  payment     text,
  adjustment  text,
  balance     text,
  charge_id   uuid,
  payment_id  uuid
)
language sql stable security definer set search_path = ''
as $$
  with u as (
    select un.id, un.association_id
      from public.units un
     where un.id = p_unit_id
  ),
  ev as (
    select c.due_on as d, 1 as ord, 'charge'::text as k,
           case c.charge_type
             when 'assessment'         then 'Dues for ' || to_char(c.period_start, 'FMMonth YYYY')
             when 'special_assessment' then 'Special assessment'
             when 'late_fee'           then 'Late fee'
             else coalesce(nullif(btrim(je.memo), ''), 'Charge')
           end as descr,
           c.amount as chg, 0::numeric as pay, 0::numeric as adj,
           c.id as cid, null::uuid as pid, c.created_at as ts
      from public.assessment_charges c
      join u on u.id = c.unit_id
      left join public.journal_entries je on je.id = c.journal_entry_id
    union all
    select p.received_on, 2, 'payment',
           'Payment received' || case p.method
             when 'check' then ' by check' when 'ach' then ' by bank transfer'
             when 'cash' then ' in cash' when 'card' then ' by card' else '' end
             || coalesce(' (' || nullif(left(btrim(p.reference), 40), '') || ')', ''),
           0, p.amount, 0, null::uuid, p.id, p.created_at
      from public.payments p join u on u.id = p.unit_id
    union all
    select (coalesce(c.waived_at, c.written_off_at) at time zone 'America/Chicago')::date, 3,
           case when c.waived_at is not null then 'waiver' else 'write_off' end,
           case when c.waived_at is not null then 'Charge waived: ' else 'Charge written off: ' end
             || case c.charge_type
                  when 'assessment' then 'dues for ' || to_char(c.period_start, 'FMMonth YYYY')
                  when 'special_assessment' then 'special assessment'
                  when 'late_fee' then 'late fee' else 'charge' end,
           0, 0,
           c.amount - coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.charge_id = c.id), 0),
           c.id, null::uuid, coalesce(c.waived_at, c.written_off_at)
      from public.assessment_charges c join u on u.id = c.unit_id
     where c.waived_at is not null or c.written_off_at is not null
  ),
  run as (
    select ev.*,
           sum(chg - pay - adj) over (order by d, ord, ts, coalesce(cid, pid)
                                      rows between unbounded preceding and current row) as bal
      from ev
  ),
  opening as (
    select coalesce(sum(chg - pay - adj) filter (where d < p_from), 0) as bal from ev where p_from is not null
  ),
  lines as (
    select 0 as s, p_from as ld, 'opening'::text as k, 'Balance before this statement'::text as descr,
           null::numeric as chg, null::numeric as pay, null::numeric as adj, o.bal as bal,
           null::uuid as cid, null::uuid as pid
      from opening o where p_from is not null
    union all
    select (row_number() over (order by d, ord, ts, coalesce(cid, pid)))::integer, d, k, descr, chg, pay, adj, bal, cid, pid
      from run
     where (p_from is null or d >= p_from) and (p_to is null or d <= p_to)
  )
  select s, ld, k, descr,
         chg::numeric(14,2)::text, pay::numeric(14,2)::text, adj::numeric(14,2)::text,
         bal::numeric(14,2)::text, cid, pid
    from lines
   order by s
$$;

revoke all on function public.unit_statement_core(uuid, date, date) from public, anon, authenticated;

create or replace function public.unit_statement(p_unit_id uuid, p_from date default null, p_to date default null)
returns table (
  seq integer, line_date date, kind text, description text, charge text, payment text,
  adjustment text, balance text, charge_id uuid, payment_id uuid)
language sql stable security definer set search_path = ''
as $$
  select c.*
    from public.unit_statement_core(p_unit_id, p_from, p_to) c
   where exists (
     select 1 from public.units un
      where un.id = p_unit_id
        and (public.can_read_financials(un.association_id)
             or un.id in (select public.owned_unit_ids(un.association_id))))
$$;

revoke all on function public.unit_statement(uuid, date, date) from public, anon;
grant execute on function public.unit_statement(uuid, date, date) to authenticated;

comment on function public.unit_statement(uuid, date, date) is
  'A unit''s charges, payments and adjustments with a running balance (owed minus unapplied credit), dates inclusive. An opening line carries the balance before p_from. Money as text. Financial readers and the unit''s owners only.';

-- ----------------------------------------------------------------------------
-- 6. Announcements
-- ----------------------------------------------------------------------------

create table public.announcements (
  id                     uuid primary key default gen_random_uuid(),
  association_id         uuid not null references public.associations(id) on delete restrict,
  title                  text not null check (char_length(btrim(title)) between 1 and 120),
  body                   text not null check (char_length(btrim(body)) between 1 and 5000),
  audience               text not null default 'all' check (audience in ('all', 'units')),
  pinned                 boolean not null default false,
  status                 text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  attachment_document_id uuid references public.documents(id) on delete restrict,
  expires_on             date,
  published_at           timestamptz,
  edited_at              timestamptz,
  archived_at            timestamptz,
  created_by             uuid references auth.users(id) default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check ((status = 'draft') = (published_at is null)),
  check ((status = 'archived') = (archived_at is not null)),
  check (not pinned or status = 'published')
);

create index announcements_assoc_idx on public.announcements (association_id, status, published_at desc);

comment on table public.announcements is
  'A board post to owners: everyone or chosen units, optionally pinned, with an optional Document Hub attachment. Plain text, no comments. Written only by save_announcement / set_announcement_status / delete_announcement_draft.';

create table public.announcement_units (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references public.associations(id) on delete restrict,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  unit_id         uuid not null references public.units(id) on delete restrict,
  unique (announcement_id, unit_id)
);

create index announcement_units_unit_idx on public.announcement_units (unit_id);

comment on table public.announcement_units is
  'The units an audience = units announcement is for. Empty for audience = all.';

create table public.announcement_reads (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references public.associations(id) on delete restrict,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  person_id       uuid not null references public.persons(id) on delete restrict,
  read_at         timestamptz not null default now(),
  unique (announcement_id, person_id)
);

comment on table public.announcement_reads is
  'Who has opened an announcement. A person reads only their own rows; the board sees counts through announcement_reader_stats(), never names.';

-- Same-association guards ----------------------------------------------------

create or replace function public.tg_announcements_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'announcements' then
    if new.attachment_document_id is not null and not exists (
      select 1 from public.documents d
       where d.id = new.attachment_document_id and d.association_id = new.association_id
    ) then
      raise exception 'document belongs to a different association' using errcode = '42501';
    end if;
  elsif tg_table_name = 'announcement_units' then
    if not exists (select 1 from public.units u where u.id = new.unit_id and u.association_id = new.association_id)
       or not exists (select 1 from public.announcements a where a.id = new.announcement_id and a.association_id = new.association_id) then
      raise exception 'unit or announcement belongs to a different association' using errcode = '42501';
    end if;
  elsif tg_table_name = 'announcement_reads' then
    if not exists (select 1 from public.persons p where p.id = new.person_id and p.association_id = new.association_id)
       or not exists (select 1 from public.announcements a where a.id = new.announcement_id and a.association_id = new.association_id) then
      raise exception 'person or announcement belongs to a different association' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.tg_announcements_same_association() from public, anon;
grant execute on function public.tg_announcements_same_association() to authenticated;

create trigger announcements_same_association before insert or update on public.announcements
  for each row execute function public.tg_announcements_same_association();
create trigger announcement_units_same_association before insert or update on public.announcement_units
  for each row execute function public.tg_announcements_same_association();
create trigger announcement_reads_same_association before insert or update on public.announcement_reads
  for each row execute function public.tg_announcements_same_association();

-- Lifecycle trigger ----------------------------------------------------------

create or replace function public.tg_announcements_lifecycle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if new.status = 'published' then new.published_at := coalesce(new.published_at, now()); end if;
    return new;
  end if;

  if old.status in ('published', 'archived') and new.status = 'draft' then
    raise exception 'a posted announcement cannot go back to a draft; archive it instead' using errcode = 'check_violation';
  end if;
  if old.status = 'draft' and new.status = 'published' then
    new.published_at := now();
  end if;
  if new.status = 'archived' then
    new.archived_at := coalesce(old.archived_at, now());
    new.pinned := false;
  elsif old.status = 'archived' and new.status = 'published' then
    new.archived_at := null;
  end if;
  if old.status <> 'draft' and (new.title is distinct from old.title
        or new.body is distinct from old.body
        or new.attachment_document_id is distinct from old.attachment_document_id) then
    new.edited_at := now();
  end if;
  if new.pinned and new.status = 'published' and
     (select count(*) from public.announcements a
       where a.association_id = new.association_id and a.pinned and a.status = 'published' and a.id <> new.id) >= 3 then
    raise exception 'only three announcements can be pinned at once' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.tg_announcements_lifecycle() from public, anon;
grant execute on function public.tg_announcements_lifecycle() to authenticated;

create trigger announcements_lifecycle before insert or update on public.announcements
  for each row execute function public.tg_announcements_lifecycle();

create trigger audit_announcements after insert or update or delete on public.announcements
  for each row execute function public.tg_audit();
create trigger audit_announcement_units after insert or update or delete on public.announcement_units
  for each row execute function public.tg_audit();

-- RLS ------------------------------------------------------------------------

alter table public.announcements       enable row level security;
alter table public.announcement_units  enable row level security;
alter table public.announcement_reads  enable row level security;

-- Board sees everything, the accountant everything posted, an owner what was
-- posted to everyone or to a unit they own, until it expires. No write
-- policies on any of the three: the RPCs below are the only way in.
create policy announcements_select on public.announcements
  for select to authenticated
  using (
    public.is_board(association_id)
    or (public.can_read_financials(association_id) and status <> 'draft')
    or (
      status = 'published'
      and (expires_on is null or expires_on >= current_date)
      and public.is_member(association_id)
      and (
        audience = 'all'
        or exists (
          select 1 from public.announcement_units au
           where au.announcement_id = announcements.id
             and au.unit_id in (select public.owned_unit_ids(announcements.association_id))
        )
      )
    )
  );

create policy announcement_units_select on public.announcement_units
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or unit_id in (select public.owned_unit_ids(association_id))
  );

create policy announcement_reads_select on public.announcement_reads
  for select to authenticated
  using (person_id = public.current_person_id(association_id));

-- save_announcement ----------------------------------------------------------

create or replace function public.save_announcement(
  p_association_id uuid,
  p_id             uuid,
  p_title          text,
  p_body           text,
  p_audience       text,
  p_unit_ids       uuid[],
  p_pinned         boolean,
  p_attachment_document_id uuid,
  p_expires_on     date,
  p_publish        boolean
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id     uuid;
  v_status text;
  v_units  uuid[] := coalesce(p_unit_ids, '{}');
  v_doc    public.documents%rowtype;
begin
  if not public.is_board(p_association_id) then
    raise exception 'only the board can post announcements' using errcode = '42501';
  end if;
  if p_audience not in ('all', 'units') then
    raise exception 'audience must be all or units' using errcode = '22023';
  end if;
  if p_audience = 'units' and cardinality(v_units) = 0 then
    raise exception 'choose at least one unit' using errcode = '22023', hint = 'no_units';
  end if;
  if p_audience = 'all' then v_units := '{}'; end if;
  if exists (select 1 from unnest(v_units) x where not exists (
       select 1 from public.units u where u.id = x and u.association_id = p_association_id)) then
    raise exception 'unit belongs to a different association' using errcode = '42501';
  end if;
  if p_expires_on is not null and p_expires_on < current_date then
    raise exception 'the end date is in the past' using errcode = '22023', hint = 'expires_past';
  end if;

  -- An attachment must already be readable by exactly this audience (the
  -- Document Hub decides who can open a file; the announcement cannot widen it).
  if p_attachment_document_id is not null then
    select * into v_doc from public.documents
     where id = p_attachment_document_id and association_id = p_association_id and deleted_at is null;
    if not found then
      raise exception 'attachment not found' using errcode = '22023', hint = 'attachment_missing';
    end if;
    if not (
      (v_doc.restricted_to_unit_id is null and v_doc.visibility = 'all_owners')
      or (p_audience = 'units' and cardinality(v_units) = 1 and v_doc.restricted_to_unit_id = v_units[1])
    ) then
      raise exception 'owners cannot open that file yet' using errcode = '22023', hint = 'attachment_not_shared';
    end if;
  end if;

  v_status := case when p_publish then 'published' else 'draft' end;

  if p_id is null then
    insert into public.announcements
      (association_id, title, body, audience, pinned, status, attachment_document_id, expires_on)
    values
      (p_association_id, btrim(p_title), btrim(p_body), p_audience,
       coalesce(p_pinned, false) and p_publish, v_status, p_attachment_document_id, p_expires_on)
    returning id into v_id;
  else
    select a.id, a.status into v_id, v_status from public.announcements a
     where a.id = p_id and a.association_id = p_association_id for update;
    if v_id is null then
      raise exception 'announcement not found' using errcode = '22023';
    end if;
    if v_status = 'archived' then
      raise exception 'restore it before editing' using errcode = '22023';
    end if;
    update public.announcements set
      title = btrim(p_title), body = btrim(p_body), audience = p_audience,
      pinned = coalesce(p_pinned, false) and (p_publish or v_status = 'published'),
      attachment_document_id = p_attachment_document_id, expires_on = p_expires_on,
      status = case when v_status = 'draft' and p_publish then 'published' else v_status end
     where id = v_id;
  end if;

  delete from public.announcement_units where announcement_id = v_id;
  insert into public.announcement_units (association_id, announcement_id, unit_id)
  select p_association_id, v_id, x from unnest(v_units) x;

  return v_id;
end $$;

revoke all on function public.save_announcement(uuid, uuid, text, text, text, uuid[], boolean, uuid, date, boolean) from public, anon;
grant execute on function public.save_announcement(uuid, uuid, text, text, text, uuid[], boolean, uuid, date, boolean) to authenticated;

create or replace function public.set_announcement_status(p_announcement_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a public.announcements%rowtype;
begin
  select * into a from public.announcements where id = p_announcement_id;
  if not found or not public.is_board(a.association_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_status not in ('archived', 'published') then
    raise exception 'status must be archived or published' using errcode = '22023';
  end if;
  if a.status = 'draft' and p_status = 'archived' then
    raise exception 'delete a draft instead' using errcode = '22023';
  end if;
  update public.announcements set status = p_status where id = a.id;
end $$;

revoke all on function public.set_announcement_status(uuid, text) from public, anon;
grant execute on function public.set_announcement_status(uuid, text) to authenticated;

create or replace function public.set_announcement_pinned(p_announcement_id uuid, p_pinned boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a public.announcements%rowtype;
begin
  select * into a from public.announcements where id = p_announcement_id;
  if not found or not public.is_board(a.association_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.status <> 'published' then
    raise exception 'only a posted announcement can be pinned' using errcode = '22023';
  end if;
  update public.announcements set pinned = p_pinned where id = a.id;
end $$;

revoke all on function public.set_announcement_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_announcement_pinned(uuid, boolean) to authenticated;

create or replace function public.delete_announcement_draft(p_announcement_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a public.announcements%rowtype;
begin
  select * into a from public.announcements where id = p_announcement_id;
  if not found or not public.is_board(a.association_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.status <> 'draft' then
    raise exception 'only a draft can be deleted; archive a posted announcement' using errcode = '22023';
  end if;
  delete from public.announcements where id = a.id;
end $$;

revoke all on function public.delete_announcement_draft(uuid) from public, anon;
grant execute on function public.delete_announcement_draft(uuid) to authenticated;

-- Reading ----------------------------------------------------------------------

create or replace function public.mark_announcement_read(p_announcement_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a public.announcements%rowtype;
  v_person uuid;
begin
  select * into a from public.announcements where id = p_announcement_id;
  if not found then return; end if;
  v_person := public.current_person_id(a.association_id);
  if v_person is null then return; end if;
  -- Only what the caller could see counts as read (the same rule as the policy).
  if not (
    a.status = 'published'
    and (a.expires_on is null or a.expires_on >= current_date)
    and public.is_member(a.association_id)
    and (a.audience = 'all' or exists (
          select 1 from public.announcement_units au
           where au.announcement_id = a.id
             and au.unit_id in (select public.owned_unit_ids(a.association_id))))
  ) then
    return;
  end if;
  insert into public.announcement_reads (association_id, announcement_id, person_id)
  values (a.association_id, a.id, v_person)
  on conflict (announcement_id, person_id) do nothing;
end $$;

revoke all on function public.mark_announcement_read(uuid) from public, anon;
grant execute on function public.mark_announcement_read(uuid) to authenticated;

create or replace function public.announcements_unread(p_association_id uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::integer
    from public.announcements a
   where a.association_id = p_association_id
     and public.current_person_id(p_association_id) is not null
     and a.status = 'published'
     and (a.expires_on is null or a.expires_on >= current_date)
     and a.published_at > now() - interval '90 days'
     and public.is_member(p_association_id)
     and (a.audience = 'all' or exists (
           select 1 from public.announcement_units au
            where au.announcement_id = a.id
              and au.unit_id in (select public.owned_unit_ids(p_association_id))))
     and not exists (
           select 1 from public.announcement_reads r
            where r.announcement_id = a.id and r.person_id = public.current_person_id(p_association_id))
$$;

revoke all on function public.announcements_unread(uuid) from public, anon;
grant execute on function public.announcements_unread(uuid) to authenticated;

-- Board only: for each announcement, how many owners it reaches who can sign
-- in, how many have opened it, and how many it reaches who have no login.
create or replace function public.announcement_reader_stats(p_association_id uuid)
returns table (announcement_id uuid, readers_total integer, readers_read integer, no_login integer)
language sql stable security definer set search_path = ''
as $$
  with aud as (
    select a.id as aid, p.id as pid, p.auth_user_id
      from public.announcements a
      join public.unit_owners uo
        on uo.association_id = a.association_id
       and (uo.effective_to is null or uo.effective_to >= current_date)
       and uo.effective_from <= current_date
       and (a.audience = 'all' or exists (
             select 1 from public.announcement_units au
              where au.announcement_id = a.id and au.unit_id = uo.unit_id))
      join public.persons p on p.id = uo.person_id
     where a.association_id = p_association_id
       and a.status in ('published', 'archived')
       and public.is_board(p_association_id)
  )
  select aid,
         count(distinct pid) filter (where auth_user_id is not null)::integer,
         count(distinct pid) filter (where auth_user_id is not null and exists (
           select 1 from public.announcement_reads r where r.announcement_id = aud.aid and r.person_id = aud.pid))::integer,
         count(distinct pid) filter (where auth_user_id is null)::integer
    from aud
   group by aid
$$;

revoke all on function public.announcement_reader_stats(uuid) from public, anon;
grant execute on function public.announcement_reader_stats(uuid) to authenticated;

-- The Document Hub may link a file to an announcement.
alter table public.document_links drop constraint document_links_target_table_known;
alter table public.document_links
  add constraint document_links_target_table_known
  check (target_table in (
    'associations', 'units', 'persons', 'vendors',
    'journal_entries', 'expenses', 'assessment_charges', 'payments',
    'insurance_policies', 'tickets', 'recurring_bills', 'fiscal_years',
    'tax_forms', 'insurance_quotes', 'insurance_claims',
    'announcements'
  ));

-- ----------------------------------------------------------------------------
-- 7. Owner conveniences
-- ----------------------------------------------------------------------------

-- Names of the people on the board, for "who is the board" (no contact details:
-- those are the board contact on associations and building_emergency_contacts).
create or replace function public.board_roster(p_association_id uuid)
returns table (full_name text, role text)
language sql stable security definer set search_path = ''
as $$
  select p.full_name, g.role::text
    from public.role_grants g
    join public.persons p on p.id = g.person_id
   where g.association_id = p_association_id
     and g.role in ('board_admin', 'board_member')
     and g.revoked_at is null
     and (g.expires_on is null or g.expires_on >= current_date)
     and public.is_member(p_association_id)
   order by (g.role = 'board_admin') desc, p.full_name
$$;

revoke all on function public.board_roster(uuid) from public, anon;
grant execute on function public.board_roster(uuid) to authenticated;

-- An owner takes back a report they have not had answered (wrong amount).
create or replace function public.withdraw_payment_report(p_report_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.dues_payment_reports%rowtype;
begin
  select * into r from public.dues_payment_reports where id = p_report_id;
  if not found or r.reported_by is distinct from auth.uid() or not public.session_is_aal2() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'the board has already answered this report' using errcode = '22023';
  end if;
  update public.dues_payment_reports
     set status = 'dismissed', resolution_note = 'Withdrawn by the person who sent it',
         resolved_at = now(), resolved_by = auth.uid()
   where id = r.id;
end $$;

revoke all on function public.withdraw_payment_report(uuid) from public, anon;
grant execute on function public.withdraw_payment_report(uuid) to authenticated;

-- At most ten reports waiting per unit, so the form cannot be used to bury the
-- treasurer's queue.
create or replace function public.tg_dues_report_pending_cap()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.dues_payment_reports r
       where r.unit_id = new.unit_id and r.status = 'pending') >= 10 then
    raise exception 'there are already ten reports waiting for this unit' using errcode = '53400', hint = 'report_cap';
  end if;
  return new;
end $$;

revoke all on function public.tg_dues_report_pending_cap() from public, anon;
grant execute on function public.tg_dues_report_pending_cap() to authenticated;

create trigger dues_payment_reports_pending_cap
  before insert on public.dues_payment_reports
  for each row execute function public.tg_dues_report_pending_cap();
```

### 3.1 Notes on the SQL

- **Gate by returning no rows.** `unit_statement_summary` and `unit_statement`
  are thin wrappers over `unit_position_core` and `unit_statement_core`, which
  have no access check and are revoked from `authenticated`. The wrappers join
  `units` and require `can_read_financials` or `owned_unit_ids`. The money spec
  calls the `_core` functions from the email sender, where there is no signed-in
  user. Nothing but a SECURITY DEFINER function can call a `_core` function.
- **`current_date`.** Postgres runs in UTC on Supabase; the app passes the
  building's day (`buildingTodayIso()`) as `p_as_of` so "overdue" matches what
  the person sees. Announcement expiry uses `current_date` (UTC): an
  announcement ending "today" disappears at 7 pm Central in summer. The
  composer says "Shows through the end date" and the list page treats the end
  date as inclusive in the building's zone as a display rule only. Accepted.
- **`viewer_context` and aal2.** `current_person_id` returns null below aal2,
  so a password-only session gets zero rows and the portal shows nothing
  private. The proxy sends such sessions to MFA anyway.
- **Why `redeem_invite` keeps the board's spelling of the name.** The board
  typed it, the ledger and statements print it, and the person can still ask
  for a correction through the board.
- **Why an invite with `person_id` is owner-only.** A board role should be a
  deliberate grant to a deliberate invite; the `invites_person_guard` trigger
  refuses `person_id` with any other role.
- **Audit.** `announcements` and `announcement_units` are audited (`tg_audit`);
  `announcement_reads` is a log and is not.

---

## 4. Libraries and components

### 4.1 `src/lib/owner/viewer.ts`

As in 2.3. Implementation notes: `import "server-only"; import { cache } from "react";`
`createClient()` from `@/lib/supabase/server`; do not call `getUser()` (the
proxy already verified the session; `viewer_context` returns nothing without a
valid `auth.uid()`).

### 4.2 `src/lib/owner/standing.ts` (pure)

```ts
export interface UnitSummary {          // one row of unit_statement_summary(), money as text
  unit_id: string; unit_label: string; as_of: string;
  owed: string; overdue: string; credit: string; net: string;
  open_charges: number;
  oldest_overdue_on: string | null; next_due_on: string | null; next_due_amount: string | null;
  last_payment_on: string | null; last_payment_amount: string | null;
}

export type OwnerStanding = "behind" | "due_soon" | "current" | "ahead" | "not_charged";

export function ownerStanding(s: UnitSummary, hasEverBeenCharged: boolean, todayIso: string): OwnerStanding;
// THE NET RULE (section 1.3, decision 2; REVIEW-4 #5): credit (payments not yet
// applied to a charge) comes off what is owed and what is overdue, never below zero.
//   owedNet = max(owed - credit, 0)    overdueNet = max(overdue - credit, 0)
// behind    overdueNet > 0
// due_soon  overdueNet = 0 and owedNet > 0
// ahead     credit > owed (ahead by credit - owed)
// current   owedNet = 0 and credit <= owed and hasEverBeenCharged
// not_charged  otherwise
// "hasEverBeenCharged" is true when open_charges > 0 or last_payment_on is not null or the statement has any line;
// the page passes (statement lines length > 0).

export interface MoneyAnswer { status: "good" | "attention" | "bad" | "neutral"; headline: string; detail: string }
export function moneyAnswer(s: UnitSummary, standing: OwnerStanding, todayIso: string): MoneyAnswer;
```

Copy for `moneyAnswer` (exact; `{$}` formats through `money()`; `{date}` through
`longDate`; singular/plural handled in code):

| Standing | status | headline | detail |
|---|---|---|---|
| behind | bad | `You owe {$owedNet}` | `{$overdueNet} of that was due on or before {oldest_overdue_on, longDate}.` plus, when `next_due_on`: ` Next payment of {$next_due_amount} is due {date}.` plus, when `credit > 0`: ` That is after taking off your {$credit} in payments not yet applied; the board applies them to charges.` |
| due_soon | attention | `You owe {$owedNet}` | `Nothing is late. The next payment of {$next_due_amount} is due {date}.` (if `next_due_on` is null: `Nothing is late.`) |
| current | good | `You're all paid up` | `Your last payment was {$last_payment_amount} on {date}.` (no payment on file: `Nothing is owed right now.`) |
| ahead | neutral | `You're {$credit - $owed} ahead` | `That is money you paid that has not been applied to a charge yet. It will cover your next charges.` |
| not_charged | neutral | `Nothing has been charged yet` | `When the board posts dues for {unit_label}, they show here.` |

### 4.3 `src/lib/owner/statement.ts` (pure)

```ts
export interface StatementLine {
  seq: number; line_date: string | null;
  kind: "opening" | "charge" | "payment" | "waiver" | "write_off";
  description: string;
  charge: string | null; payment: string | null; adjustment: string | null;
  balance: string;               // running, text
  charge_id: string | null; payment_id: string | null;
}
export interface StatementPeriod { from: string | null; to: string | null; label: string }

export function presetPeriods(todayIso: string): { key: "this_year" | "last_year" | "all"; label: string; from: string | null; to: string | null }[];
// this_year = Jan 1 to Dec 31 of todayIso's year, label `{year}`; last_year; all = null/null, label "Everything".
// (Fiscal years are calendar years for Illinois HOAs by default; associations.fiscal_year_end_month <> 12 uses the
// preset only as "calendar year" and says so in the label.)

export function parsePeriodParams(sp: { from?: string; to?: string; preset?: string }, todayIso: string): StatementPeriod;
// Invalid dates fall back to this_year. to < from swaps them. Span over 10 years is clamped to 10 years.

export function lineAmount(l: StatementLine): { text: string; tone: "good" | "neutral"; sign: "+" | "-" | "" };
// Charges are "+$x" in neutral ink; payments "-$x" in the good tone; waivers and write-offs "-$x" in neutral ink;
// the opening line has no amount (text "", sign ""). A running balance below zero is a credit: balanceWords() says so.

export function balanceWords(balanceText: string): string;
// "500.00" -> "$500.00 owed"; "-250.00" -> "$250.00 credit"; "0.00" -> "Paid up"
```

Money formatting goes through `money()` from `@/components/ui` for display only
(display-only money may use JSON numbers, DECISIONS #20, but these arrive as
text and `Intl.NumberFormat` receives `Number(text)`; nothing is summed in the
browser).

### 4.4 `src/lib/owner/announcements.ts` (pure + zod)

```ts
import { z } from "zod";

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 5000;
export const MAX_PINNED = 3;

export const announcementInput = z.object({
  id: z.guid().nullable(),
  title: z.string().trim().min(1, "Add a title.").max(ANNOUNCEMENT_TITLE_MAX, "Keep the title under 120 characters."),
  body: z.string().trim().min(1, "Write the message.").max(ANNOUNCEMENT_BODY_MAX, "Keep the message under 5,000 characters."),
  audience: z.enum(["all", "units"]),
  unitIds: z.array(z.guid()).max(100).default([]),
  pinned: z.boolean().default(false),
  attachmentDocumentId: z.guid().nullable().default(null),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  publish: z.boolean(),
}).superRefine((v, ctx) => {
  if (v.audience === "units" && v.unitIds.length === 0)
    ctx.addIssue({ code: "custom", path: ["unitIds"], message: "Choose at least one unit." });
  if (v.pinned && !v.publish)
    ctx.addIssue({ code: "custom", path: ["pinned"], message: "Only a posted announcement can be pinned." });
});
export type AnnouncementInput = z.infer<typeof announcementInput>;

export type AnnouncementStatus = "draft" | "published" | "archived";
export interface AnnouncementRow {
  id: string; title: string; body: string; audience: "all" | "units"; pinned: boolean;
  status: AnnouncementStatus; attachment_document_id: string | null; expires_on: string | null;
  published_at: string | null; edited_at: string | null; created_at: string;
}

export function announcementPreview(body: string, max = 140): string;   // collapses whitespace, cuts at a word, adds "..." (three dots, never an ellipsis character), no HTML
export function sortAnnouncements(rows: AnnouncementRow[]): AnnouncementRow[];  // pinned first, then published_at desc
export function readSummary(s: { readers_total: number; readers_read: number; no_login: number }): string;
// "Read by 3 of 4 owners who can sign in" / "Read by 1 of 1 owner who can sign in" / "No owner who can sign in sees this yet"
// and, when no_login > 0: " · 1 owner has no login yet" / " · 2 owners have no login yet"
export function audienceLabel(a: { audience: "all" | "units" }, unitLabels: string[]): string;
// "Everyone" / "Unit 2" / "Unit 2, Unit 3" / "Unit 2, Unit 3 and 4 more"
export function mapSaveError(code: string | undefined, hint: string | undefined, message: string): string;
// 42501 -> "Only the board can post announcements."; hint attachment_not_shared -> "Owners can't open that file yet. Share it with all owners first.";
// hint no_units -> "Choose at least one unit."; hint expires_past -> "The end date is in the past.";
// 23514 containing "three announcements" -> "Three announcements are already pinned. Unpin one first."; else "Couldn't save that. Try again."
```

Body is rendered as text only: `whitespace-pre-wrap`, never `dangerouslySetInnerHTML`,
no automatic linking (a board member's typo or a compromised account must not
turn into a clickable link on every owner's screen; links are typed as text and
copied).

### 4.5 `src/lib/owner/repairs-summary.ts` (server-only)

```ts
export interface OwnerRepairsSummary {
  open: number;                        // tickets the owner reported, not resolved or closed
  waitingOnYou: number;                // their reports resolved within 30 days, not yet confirmed
  latest: { id: string; reference: number; title: string; status: string; line: string } | null;
}
export async function ownerRepairsSummary(supabase: Supabase, viewer: Viewer, todayIso: string): Promise<OwnerRepairsSummary>;
```

One query on `tickets` under RLS selecting only the owner-visible columns listed in
repairs-spec section 14 (`id, reference, title, status, reported_by, resolved_at, scheduled_for, scheduled_window, updated_at`), `reported_by = viewer.personId`,
`order by updated_at desc limit 50`. `line` follows repairs-spec 14.1 rule 4 in
order of precedence (fixed within 30 days -> `Fixed {date}: is it fixed?`; visit
planned -> `Visit planned for {date}`; otherwise status words from
`src/lib/repairs/labels.ts`). It never selects a cost, an assignee or an
internal note. Contractor names are shown only on the ticket page (through
`ticket_contractor_names()`), not in this summary.

### 4.6 Components

- `MoneyAnswerCard({ summary, standing, todayIso, unitLabel })` wraps `Answer` and shows the three actions: `View statement` (link), `How to pay` (link), `I paid another way` (link to `/owner/pay#report`).
- `StatementDownload({ unitId, from, to })`: renders nothing while `STATEMENT_PDF_ENABLED` is false; otherwise an anchor `Download PDF` to `/statements/{unitId}/pdf?from=&to=` (money spec route), `download` attribute omitted (the route sets `Content-Disposition`).
- `CopyField({ label, value })` (client): a row with the label (`text-[11px] text-mute`), the value (`figures`), and a `Copy` button (`min-h-[44px]` on mobile). On click `navigator.clipboard.writeText(value)`; status line `Copied.` for 2 s in a `role="status"` span; on failure `Couldn't copy. Select the text and copy it.` and the value is `select-all`.
- `BoardOnly` (2.4).

---

## 5. Server actions

All start with `const supabase = await createClient(); const viewer = await getViewer(); if (!viewer) return { error: "Please sign in again." };`.
Error strings are exact. They return `{ ok: true } | { error: string }`.

### 5.1 `src/app/owner/actions.ts`

```ts
"use server";

export async function updateMyProfile(_prev: unknown, formData: FormData):
  Promise<{ ok: true } | { error: string; fieldErrors?: { phone?: string; mailingAddress?: string } }>;
```
Schema: `phone` trimmed, empty allowed, max 40, characters `0-9 + ( ) - . x` and spaces only (`Use digits, spaces and + ( ) - only.`); `mailingAddress` trimmed, empty allowed, max 300 (`Keep the address under 300 characters.`); control characters stripped. Calls `rpc("update_my_profile", { p_association_id, p_phone, p_mailing_address })`. `42501` -> `You can only change your own details.` Success: `revalidatePath("/owner/profile")`, `revalidatePath("/owner")`.

```ts
export async function withdrawPaymentReport(reportId: string): Promise<{ ok: true } | { error: string }>;
```
`isUuid` check; `rpc("withdraw_payment_report", { p_report_id })`. `42501` -> `You can only withdraw your own report.`; `22023` -> `The board has already answered this report.`; success revalidates `/owner/pay`, `/dues`, `/`.

`reportOutsidePayment` (existing, `src/app/dues/actions.ts`) is reused unchanged except for two edits owned by Integration: (a) map the new cap `53400` with hint `report_cap` to `There are already ten reports waiting for this unit. The board will answer them first.`; (b) reject a `paid_on` in the future (`Enter the date you paid, not a future date.`) and revalidate `/owner/pay` and `/owner`.

### 5.2 `src/app/announcements/actions.ts`

```ts
"use server";

export async function saveAnnouncement(input: AnnouncementInput):
  Promise<{ ok: true; id: string } | { error: string; fieldErrors?: Partial<Record<keyof AnnouncementInput, string>> }>;
// zod parse (4.4) -> first issue becomes fieldErrors; then rpc("save_announcement", { p_association_id, p_id, p_title, p_body, p_audience, p_unit_ids, p_pinned, p_attachment_document_id, p_expires_on, p_publish }).
// Errors through mapSaveError. Success revalidates /announcements, /owner, and /announcements/{id}.

export async function setAnnouncementStatus(id: string, status: "archived" | "published"): Promise<{ ok: true } | { error: string }>;
export async function setAnnouncementPinned(id: string, pinned: boolean): Promise<{ ok: true } | { error: string }>;
export async function deleteAnnouncementDraft(id: string): Promise<{ ok: true } | { error: string }>;
export async function markAnnouncementRead(id: string): Promise<{ ok: true }>;   // always ok; failures are swallowed (a receipt is not worth an error)
export async function shareDocumentWithOwners(documentId: string): Promise<{ ok: true } | { error: string }>;
// Board only (is_board). update documents set visibility = 'all_owners', restricted_to_unit_id = null where id = documentId and association_id = current.
// Refuses a document in category 'legal_notice' or 'unit_record' with: "Files like this stay private. Pick another file." (never widen a delinquency notice or a unit record).
// Error 0 rows -> "You can't change that file."
```

### 5.3 Building Info: claim-your-record invites (Integration edits `src/app/building/*`)

`createOwnerInvite(personId: string): Promise<{ ok: true; token: string } | { error: string }>` in `src/app/building/actions.ts`: board only; `persons` row must be in the association, `auth_user_id is null`, `email` optional; inserts `invites { association_id, role: "owner", person_id, email: person.email, created_by }`. Errors: `That person already has a login.`; `Only the board can send invites.`
UI: in `person-row.tsx`, for a person with no login and an owner role or unit, a button `Invite to sign in`. After success the new invite appears in the Invites list (existing `InviteRow` shows the link) and an inline `DraftEmail` is offered (not sent by Walkup, DECISIONS #22):

> Subject: `Your {association} page on Walkup`
> Body: `Hi {first name},\n\n{association} is using Walkup for dues, repairs and announcements. Use this link to sign in as yourself and see your balance, how to pay, and anything the board posts:\n\n{inviteUrl}\n\nThe link works once and expires in 7 days. You'll set up two-step sign-in the first time.\n\nThanks,\n{board contact name or "The board"}`

---

## 6. Pages, with copy and states

Tokens and components: `Card`, `Answer`, `Stat`, pill links, `figures`, `eyebrow`
from `src/components/ui.tsx`. Headings follow the existing pattern (`h1`
`text-[20px] font-bold tracking-tight text-ink`, sub-line `mt-1 text-mute`).
Dates through `longDate`/`shortDate`. No em dashes anywhere. "contractor", never
"vendor".

### 6.1 `/owner` (home)

Loading (`loading.tsx`, `RouteLoading`): H1 skeleton, an answer-sized block, two card blocks.

Header: H1 `Hi {firstName}`; sub-line `{associationName}`.

States, in order:

1. **Not an owner** (viewer has no `ownedUnitIds`):
   - Staff (board or accountant): `Card title="This page is for owners"`: `You don't own a unit in {associationName}, so there's no balance to show here. Your Dashboard has the association's numbers.` Button `Go to the Dashboard` (`/`).
   - Owner role but no unit linked (an owner grant, no `unit_owners` row): `Card title="No unit is linked to your account yet"`: `The board hasn't linked your sign-in to a unit. That usually means an invite was used that wasn't made for you. Ask {boardContactName ?? "a board member"} to send you a new invite from Building Info.` plus the board contact line (6.6).
2. **Per owned unit** (sorted by label), one `MoneyAnswerCard` each. With several units, a small `h2` `{unitLabel}` above each answer; with one unit the label is in the answer's detail line only where useful.
   Error: if `rpc` fails, the card shows `Answer status="neutral" headline="We couldn't load your balance" detail="Reload the page. If it keeps happening, tell the board."` (never a $0).
3. **Announcements** `Card title="Announcements"` (hidden when there are none and the board has never posted; otherwise): up to 3, pinned first, each row: title (link), `{shortDate(published_at)}` and `Pinned` pill when pinned, a 2-line preview, a `New` dot (`aria-label="Not read yet"`) when unread. Footer link `See all announcements`. Empty: `Nothing posted yet. When the board posts something, it shows up here.`
4. **Repairs** `Card title="Repairs"`: `You have {n} open report(s)` or `Nothing you reported is open`; the `latest.line`; buttons `Report a problem` (`/repairs/report`) and `See all repairs` (`/repairs`). When `waitingOnYou > 0`: a warning line `{n} fixed problem(s) waiting for you to confirm`. Empty: `Nothing has been reported yet. If something's broken, report it and the board sees it here.`
5. **Shared with owners** `Card title="Shared with you"`: the 5 most recent documents the viewer can see (`documents` under RLS, `deleted_at is null`, `order by uploaded_at desc limit 5`, columns `id, title, filename, category_id, uploaded_at`), each linking to `/documents/{id}`. Footer `Open the Document Hub`. Empty: `The board hasn't shared any documents yet.`
6. **Contacts** `Card title="Who to contact"`: the board contact (6.6) and the link `What to do in an emergency` (`/repairs/emergency-info`).

Mobile: single column, cards full width, the money answer first. At `min-[900px]` the announcements and repairs cards sit side by side in a two-column grid.

### 6.2 `/owner/statement` and `/owner/statement/[unitId]`

`/owner/statement`: if the viewer owns one unit, `redirect("/owner/statement/{id}")`. With several, a `Card title="Choose a unit"` listing each as a link row with the unit label and its net in words (`balanceWords`). With none, the same "No unit is linked" card as 6.1.

`/owner/statement/[unitId]`:

- Gate: `unit_statement_summary(unitId, today)` returns a row, else `Restricted what="this unit's statement"` (not `BoardOnly`: it is a genuine "not yours"). Financial readers see the page with a muted line `You're previewing {unitLabel} as the board.`
- H1 `{unitLabel} statement`; sub-line `What was charged, what was paid, and what is left.`
- `MoneyAnswerCard` for the unit (its action buttons omitted on this page; the PDF button instead).
- Period picker (GET form, no JS): pills `{thisYear}`, `{lastYear}`, `Everything` plus `From` and `To` date inputs and `Show`. Uses `parsePeriodParams`.
- Table (desktop, `sm` and up): columns Date, What, Charged, Paid, Balance. Rows from `unit_statement`. The first row, when a `from` is set, is `Balance before {from}` with only a Balance cell. Adjustment lines show their amount in the Paid column with the description `Charge waived: ...` or `Charge written off: ...`. The closing row `Balance on {to or today}` shows `balanceWords`. Right-aligned `figures`.
- Cards (below `sm`): each line is a block: first line description and date, second line the amount (`+$750.00 charged` / `-$750.00 paid`) and `Balance $x`. No horizontal scroll.
- Footer note: `Payments are listed when the board records them or the deposit lands. If a payment you made is missing, tell the board on the How to pay page.` with the link.
- `StatementDownload` (hidden until the money spec ships).
- Empty period: `Nothing happened in this period.` and the opening balance line still shows.
- Error: `We couldn't load this statement. Reload the page.` as a neutral `Answer`.

### 6.3 `/owner/pay`

H1 `How to pay`; sub-line `Set this up once in your bank's bill pay, and it runs on its own. No fee for anyone.`

1. `Answer` from `moneyAnswer` for each unit (compact: headline only) so the amount is in front of them.
2. `Card navy title="Send your payment here"`: fields in order, each a `CopyField`: `Payee name`, `Bank`, `Account number`, `Routing number`, `Zelle`, then `Notes from the board` as plain text. Below: `Suggested memo: {unitLabel} dues {Mon YYYY}` (one per unit, with Copy). Below that, in a `border-l` warning note: `Only use the details on this page. If an email or text asks you to send money anywhere else, call the board first.`
   - Not configured (`dues_payee_name`, `dues_account_number` and `dues_zelle_handle` all empty): `Empty`: `The board hasn't added payment details yet. Ask {boardContactName ?? "a board member"}.` plus the contact line.
3. `Card id="report" title="Tell the board you paid"`: the existing `ReportPaymentForm` (units = viewer's owned units, `defaultAmount` = the net if positive). Below it `My reports`, newest first, up to 10: `{shortDate(paid_on)} · {$amount} {method words}` then a status pill: `Waiting for the board` (pending), `Matched to a deposit` (matched), `Not matched` with the board's note in quotes (dismissed). Pending rows have a `Withdraw` button (`withdrawPaymentReport`, confirm inline: `Withdraw this report?` `Yes, withdraw` `Keep it`). Empty: `You haven't reported a payment.`
   - Hint above the form: `This does not move money. It tells the board to look for your payment. They record it when the deposit shows up at the bank.`

States: loading (skeleton), error on reports (`We couldn't load your reports.`), owner with no unit (6.1 case 1).

### 6.4 `/announcements`

**Owner view.** H1 `Announcements`; sub-line `Notices from the board.` List (`Card` per item, no Card title): pinned first. Row: title (link), meta `{longDate(published_at)}` and `Edited` when `edited_at`, `Pinned` pill, `New` dot when unread, preview, attachment chip `Has a file` when `attachment_document_id`. Archived and expired ones are not shown to owners (RLS). Empty: `Nothing posted yet. When the board posts something, it shows up here.` Error: `We couldn't load announcements. Reload the page.`

**Board view.** Same H1; sub-line `Post to everyone, or to chosen units.` Primary button `New announcement` (full width on mobile). Pill tabs `Posted`, `Drafts`, `Archived` (`?tab=`). Rows show audience (`audienceLabel`), `readSummary`, and actions: `Edit`, `Pin`/`Unpin`, `Archive` (posted), `Restore` (archived), `Delete` (drafts, inline confirm `Delete this draft?` `Yes, delete` `Keep it`). Pin refused at three: `Three announcements are already pinned. Unpin one first.` Empty tabs: Posted `Nothing posted yet. Post a notice and owners see it on their home page.`; Drafts `No drafts.`; Archived `Nothing archived.` The board's "Email this to owners" action (money spec 5.6) appears on posted rows when sending is on.

### 6.5 `/announcements/[id]`, composer

Detail: H1 title; meta line `{longDate(published_at)} · {audienceLabel}`; the body in a `Card` with `whitespace-pre-wrap break-words text-[15px] leading-relaxed`; attachment row (document title, size via `readableSize`, `Open` link to `/documents/{id}`); for the board, `readSummary`. Owners: `<MarkRead id />` (client) calls `markAnnouncementRead` once on mount. Not visible to the viewer (RLS returns no row): `Restricted what="this announcement"`... no: `This announcement isn't available. It may have ended, or it may be for other units.` with a link back. Draft/archived for the board: a neutral pill.

Composer (`/announcements/new`, `/announcements/[id]/edit`), board only (`BoardOnly what="Posting announcements" why="Only the board posts to owners." alternative={{label:"Back to announcements", href:"/announcements"}}` otherwise):

- `Title` (input, 120, counter appears at 100).
- `Message` (textarea, 5,000, counter, `text-[16px]` on mobile). Hint: `Plain text. Owners see it exactly as typed.`
- `Who is this for?` radio `All owners` / `Chosen units`; units checklist (label and owner name) appears for the second; with `Select all` / `Clear`.
- `Pin it to the top` checkbox; help `Up to three at a time. Pinned posts stay above newer ones.`
- `Show until` date (optional), help `After this day owners no longer see it. Leave empty to keep it up.`
- `Attach a file` (optional): `DirectUpload purpose="document" categorySlug="other" multiple={false} maxFiles={1} label="Add a file" help="PDF, photo or Office file. Owners can open it from the announcement."` or `Pick from the Document Hub` (select of live documents the board can see, newest 50, with each file's visibility pill). After a choice, if the file is not readable by the chosen audience, an inline warning (`Owners can't open this file yet.`) with `Share it with all owners` (`shareDocumentWithOwners`) and, for the chosen-units case with more than one unit, `Files can only be attached when you post to everyone or to one unit.` and the Post button disabled.
- Footer buttons: `Post announcement` (primary), `Save draft` (secondary), `Cancel`. Posting shows an inline confirm sentence under the button: `This goes to {n} owner(s) now. You can edit it later, but they may already have read it.` where `n` counts current owners in the audience (computed client-side from the unit list). Success toast `Posted.` / `Draft saved.`, then navigate to `/announcements`.
- Preview: a collapsed `Preview` disclosure renders the detail page card.
- Errors inline under fields (`fieldErrors`) and a top `role="alert"` summary for server errors via `mapSaveError`.

### 6.6 Contact line (shared)

`ContactLine({ contact })` renders: `{name ?? "The board"}` then, when set, `email` as `mailto:` (`Write to the board`) and `phone` as `tel:` (`Call`). If none set: `Ask a board member.` For a board admin viewing, a muted link `Add the board contact` to `/building#contact` appears (Integration adds the three fields to the association profile form, 12).

### 6.7 `/owner/building`

H1 `Your building`; sub-line `Who to contact, and what to do in an emergency.`

- `Card title="The association"`: display name; address from `associations.street_address, city, state_code, postal_code` (omitted lines when empty); `Your unit: {labels}`.
- `Card title="Who to contact"`: `ContactLine`; below it `Board members` list from `board_roster()` (names; the board admin first). Empty roster is impossible (a building has a board admin); if the call fails, omit the list silently and keep the contact line.
- `Card title="In an emergency"`: `Call 911 first if anyone is in danger.` then up to four facts from `building_emergency_info()` (water shut-off, gas company and number, electric panel, elevator company; labels as repairs-spec 14.3, rows with nothing entered left out) and the listed contacts with `tel:` links; button `Everything to do in an emergency` (`/repairs/emergency-info`). Nothing entered at all: `Your board hasn't added this building's emergency information yet.`
- `Card title="Documents"`: link row `Governing documents, minutes and statements the board shared` -> `/documents`.
- `Card title="Insurance"`: link row `What the master policy means for you` -> `/insurance` (insurance-spec owner view).

### 6.8 `/owner/profile`

H1 `Your profile`; sub-line `The board uses this to reach you.`

- Read-only block: `Name` and `Email` (from `persons`, through `viewer_context` for the name and `auth` email for the email) with the line `To change your name or email, ask {boardContactName ?? "the board"}.`
- Form (`ProfileForm`, client, `useActionState(updateMyProfile)`): `Phone`, `Mailing address` (textarea, 3 rows), `Save`. Success `Saved.` (`role="status"`). Errors under fields.
- `Your units`: list of labels with links to each statement.
- `EmailPreferencesSlot` (`email-preferences-slot.tsx`): returns `null` until the money spec replaces its body with the preferences card (money spec 6.9).
- `Your data`: `Your name, email, phone and mailing address are kept while you own a unit or have access. To have them removed, ask the board, or write to {SUPPORT_EMAIL}.` (links to `/privacy`).

### 6.9 Building Info edits (owned by Integration)

- Association profile form: add `Board contact name`, `Board contact email`, `Board contact phone` (all optional; email validated by the same regex as the DB check) under a heading `Who owners write to`, `id="contact"`. Saved through the existing `updateAssociationProfile` (board admin only by `associations_update`).
- `person-row.tsx`: `Invite to sign in` (5.3).

---

## 7. Role-aware navigation: exact change list

Roles: `owner` (owner-only person), `staff` (board_admin, board_member, accountant).
A staff person who owns a unit also sees the "My unit" item.

### 7.1 `src/components/sidebar/config.tsx`

1. Add icons to the lucide import: `Megaphone`, `UserRound`, `Receipt`, `LifeBuoy`.
2. Add to `NavItemConfig`: `roles?: ("owner" | "staff")[]` (default both), `ownsUnitOnly?: boolean`, and widen `badgeKey` doc to `"uncategorized" | "repairs" | "announcements"`.
3. Add to `NAV_GROUPS` (staff) in `Building`, after Building Info: `{ href: "/announcements", label: "Announcements", icon: Megaphone, tourId: "announcements" }`.
4. Add (staff who own a unit) `MY_UNIT_NAV: NavItemConfig[] = [{ href: "/owner", label: "My unit", icon: UserRound, tourId: "my-unit", ownsUnitOnly: true }]` rendered after `UNGROUPED_NAV`.
5. Add the owner navigation:

```tsx
export const OWNER_UNGROUPED_NAV: NavItemConfig[] = [
  { href: "/owner", label: "Home", icon: Home, featured: true, tourId: "dashboard" },
];

export const OWNER_NAV_GROUPS: NavGroupConfig[] = [
  {
    label: "My unit",
    items: [
      { href: "/owner/statement", label: "Statement", icon: Receipt, tourId: "owner-statement" },
      { href: "/owner/pay", label: "How to pay", icon: HandCoins, tourId: "dues" },
    ],
  },
  {
    label: "Building",
    items: [
      { href: "/announcements", label: "Announcements", icon: Megaphone, badgeKey: "announcements", tourId: "announcements" },
      { href: "/repairs", label: "Repairs", icon: Hammer, badgeKey: "repairs", tourId: "repairs" },
      { href: "/budget", label: "Budget", icon: BarChart3, tourId: "budget" },
      { href: "/insurance", label: "Building insurance", icon: Shield, tourId: "insurance" },
      { href: "/owner/building", label: "Your building", icon: LifeBuoy, tourId: "owner-building" },
    ],
  },
];

export const OWNER_TRAILING_NAV: NavItemConfig[] = [
  { href: "/documents", label: "Documents", icon: Folder, tourId: "documents" },
  { href: "/owner/profile", label: "My profile", icon: UserRound, tourId: "owner-profile" },
];

export type NavRole = "owner" | "staff";
export function navFor(role: NavRole, opts: { ownsUnit: boolean }): {
  ungrouped: NavItemConfig[]; groups: NavGroupConfig[]; trailing: NavItemConfig[];
} {
  if (role === "owner") return { ungrouped: OWNER_UNGROUPED_NAV, groups: OWNER_NAV_GROUPS, trailing: OWNER_TRAILING_NAV };
  return {
    ungrouped: [...UNGROUPED_NAV, ...(opts.ownsUnit ? MY_UNIT_NAV : [])],
    groups: NAV_GROUPS,
    trailing: TRAILING_NAV,
  };
}
```

6. `EXTRA_TITLES` additions (before the generic prefixes): `{ prefix: "/owner/statement/", label: "Statement" }`, `{ prefix: "/announcements/", label: "Announcement" }`. `pageTitleFor` must search `navFor("owner", ...)` items as well as the staff ones (concatenate both lists; hrefs do not collide).
7. `pageTitleFor("/owner")` returns `"Home"` for owners and `"My unit"` otherwise: simplest is a special case `if (pathname === "/owner") return "My unit"` and the owner Home item label stays `Home`; the top bar reads the owner label because `Sidebar` and `TopBar` share `pageTitleFor(pathname, role)`. Add an optional second argument `role?: NavRole`; with `"owner"` the owner lists are searched first.

### 7.2 `src/components/sidebar/sidebar.tsx`

- New props: `navRole: NavRole`, `ownsUnit: boolean`, `repairsCount?: number` (repairs-spec 18.6), `announcementsCount?: number`.
- Replace the three constants with `const nav = navFor(navRole, { ownsUnit })` and render `nav.ungrouped`, `nav.groups`, `nav.trailing`.
- `badges = { uncategorized: uncategorizedCount, repairs: repairsCount ?? 0, announcements: announcementsCount ?? 0 }`.
- `isActive`: `/owner` only matches exactly (so `/owner/pay` does not light Home); other items keep the prefix rule.

### 7.3 `src/app/layout.tsx`

- After `tourRole` is computed, derive `navRole = tourRole === "owner" ? "owner" : "staff"` (tourRole is the highest role).
- Call `getViewer()` (cached) only for owner-only people and for staff who may own a unit; to avoid an extra query for every staff page view, use the already fetched `myGrants` and add one `rpc("owned_unit_ids", { assoc })` call to the `Promise.all` for staff, giving `ownsUnit`.
- `announcementsCount`: `rpc("announcements_unread", { p_association_id })` in the same `Promise.all` (cheap, one count). Pass `navRole`, `ownsUnit`, `announcementsCount` to `Sidebar`.
- `uncategorizedCount` (a board-only query) is skipped for owners.

### 7.4 `src/lib/tour/steps.ts`

Replace the owner branch and add steps (no em dashes; the existing test enforces it):

```ts
ownerHome:      { id: "dashboard",       target: "dashboard",       title: "Home",
                  body: "What you owe, what the board posted, and your repairs, all in one place." },
ownerStatement: { id: "owner-statement", target: "owner-statement", title: "Statement",
                  body: "Every charge and payment for your unit, with a running balance. Download it when you need it." },
ownerPay:       { id: "dues",            target: "dues",            title: "How to pay",
                  body: "Where to send your dues, and a way to tell the board you've paid." },
announcements:  { id: "announcements",   target: "announcements",   title: "Announcements",
                  body: "Notices from the board show up here, with a dot until you've read them." },
ownerBuilding:  { id: "owner-building",  target: "owner-building",  title: "Your building",
                  body: "Who to contact, and the shut-offs and numbers to know in an emergency." },
myUnit:         { id: "my-unit",         target: "my-unit",         title: "My unit",
                  body: "You own a unit too. This is your balance and your statement, separate from the board's books." },
```
`repairsOwner.body` becomes repairs-spec 18.7's text. Update `tourStepsFor`:

- `owner`: `[WELCOME, s.ownerHome, s.ownerStatement, s.ownerPay, s.announcements, s.repairsOwner, s.ownerBuilding, FINISH]`
- `board_admin` / `board_member`: unchanged order, with `s.myUnit` inserted after `s.dashboard` and `s.announcements` inserted after `s.building`. `AppTour` already drops a step whose `data-tour` element is missing (`app-tour.tsx` line 53), so `my-unit` only appears for staff who own a unit.
- `accountant`: unchanged.
- Remove the old `duesOwner` entry; `tests/unit/tour-steps.test.ts` expected ids for owner become `["welcome","dashboard","owner-statement","dues","announcements","repairs","owner-building","finish"]`, and the "targets exist" test reads the combined nav of both roles.

---

## 8. Security and privacy notes

1. **Read paths.** An owner's statement comes from two definer functions that gate on `owned_unit_ids`. A test asserts an owner gets zero rows for a neighbour's `unit_id`, for a unit in another association, and with an aal1 session.
2. **Definer helpers.** `unit_position_core` and `unit_statement_core` are revoked from `authenticated`; only other definer functions reach them. The lint test "never let the anon role execute a SECURITY DEFINER function" stays green; no new exception.
3. **Announcement bodies are untrusted text rendered as text.** No HTML, no auto-links. A compromised board account can still write misleading text; mitigation is the audit trail (`announcements` is audited, edits stamp `edited_at`, an edited post shows "Edited") and the three-pinned cap. Payment details are never copied into an announcement by Walkup.
4. **Attachments cannot widen access** (decision 5) and `shareDocumentWithOwners` refuses `legal_notice` and `unit_record` categories.
5. **Read receipts.** Reads are inserted by a definer function that re-applies the visibility rule, so an owner cannot mark an announcement they cannot see. The board sees counts only.
6. **Payment instructions are association data the board enters**; the portal adds a fraud warning and never emails them. (A compromised admin changing the Zelle handle is an existing risk. Recommended and out of scope: notify all board admins when `dues_*` fields change. Left out, section 13.)
7. **Persons guard.** The trigger keys on `current_user in ('authenticated','anon')`. SECURITY DEFINER functions (invite redemption, redaction, deprovisioning) run as their owner and are unaffected; the test suite covers `redeem_invite` and `redact_person` after the trigger exists.
8. **Pending-report cap** bounds queue stuffing; a report is informational and never writes the ledger.
9. **Privacy page.** No change for the portal itself (no new processors). Announcement text and read receipts are stored; add one sentence to "What we collect" (12): `Announcements your board posts, and a record of which owners opened them. The board sees only how many.`
10. **Redaction.** `redact_person` already clears the person; `announcement_reads` keeps `person_id` (no PII) and goes with the person's history. Nothing else stores owner PII.

---

## 9. Mobile and accessibility

- Mobile first: single column, 16 px side gutters, every tap target at least 44 px, forms never inside card headers, the primary action of each page visible without scrolling on a 375 px phone (balance answer on `/owner`, Copy buttons on `/owner/pay`).
- The statement is a card list below `sm` (no horizontal scroll); the desktop table has `<caption class="sr-only">` and `<th scope="col">`.
- Status never relies on colour alone: pills carry words (`Pinned`, `Waiting for the board`), the unread dot has `aria-label="Not read yet"` and a visually hidden `, not read` in the title link.
- `CopyField` buttons announce `Copied.` through `role="status"`.
- Forms: labels tied to inputs, errors in `aria-describedby`, a top `role="alert"` summary for server errors, focus moves to the first error.
- The composer's units checklist is a `fieldset` with a `legend`.
- Reduced motion: no animation is required by anything here.

---

## 10. Test plan

### 10.1 DB tests: `tests/db/owner-portal.test.ts` (PGlite harness, `asUser`, fixture from `fixtures.ts`)

Fixture additions in the file: a second charge and a payment for Bo (unit 2) (record_payment with a partial allocation and an unapplied remainder, plus a waived late fee), an announcement set, a person without login, an invite with `person_id`. Numbering is the test order.

Statements
1. Ada reads her own `unit_statement_summary` (owed `500.00`, overdue `500.00`, credit `0.00`, net `500.00`).
2. Ada gets zero rows for Bo's unit from both functions.
3. Ada gets zero rows for the Hoyne unit; Zara (Hoyne owner) gets zero rows for a Damen unit.
4. Cy (board admin) reads any unit; Vic (expired accountant) gets zero rows; Nia (live accountant) reads any unit.
5. An aal1 session (`asUser(..., { aal: "aal1" })`) gets zero rows for her own unit.
6. Anon cannot execute either function (permission denied).
7. Authenticated cannot execute `unit_position_core` or `unit_statement_core` (permission denied).
8. Running balance: for Bo with a 750 January charge, a 750 February charge, a 25 late fee, a 1,000 payment allocating 750, and the late fee waived, the last `balance` equals `owed` minus `credit` from the summary (`500.00`) and `unit_balances.balance_owed` is `750.00` (the gap is the `250.00` unapplied credit).
9. With `p_from`, the first line is `opening` with the right balance and `seq = 0`.
10. `p_to` before the payment excludes the payment and the waiver.
11. A written-off charge appears as a `write_off` adjustment of the unpaid remainder and the totals still tie.
12. `next_due_on` / `next_due_amount` pick the earliest open charge not yet due; both are null when nothing is upcoming; `last_payment_*` is the latest payment.
13. Money columns are text with two decimals (`'0.00'`, never `'0'`).

Announcements
14. `save_announcement` by a board member posts; by an owner raises `42501`; by Zara for a Damen id raises.
15. An owner cannot `insert`, `update` or `delete` on any of the three tables (RLS violation or zero rows).
16. Audience all: both owners see it; an owner of another association does not; the live accountant sees it; a draft is invisible to owners and to the accountant, visible to the board.
17. Audience units [unit 2]: Bo sees it, Ada does not, Cy (owns unit 3 but is board) sees it.
18. Expired (`expires_on` in the past by direct SQL as superuser) disappears for owners, stays for the board; `expires_on` in the past is refused by the RPC (`22023`, hint `expires_past`).
19. `audience = 'units'` with no units refused (hint `no_units`); a unit from another association refused (`42501`).
20. Pinning: a fourth pinned announcement raises `check_violation`; archiving clears `pinned`; a draft cannot be pinned (check constraint).
21. A posted announcement cannot go back to draft; archive then restore keeps `published_at`; edits after posting stamp `edited_at`.
22. `delete_announcement_draft` deletes a draft and refuses a posted one.
23. Attachment: a `board_only` document is refused (hint `attachment_not_shared`); an `all_owners` document is accepted for audience all; a document pinned to unit 2 is accepted only for audience units [unit 2]; a document from another association is refused; a deleted document is refused.
24. `mark_announcement_read` records once (second call no-op); an owner cannot mark an announcement they cannot see; a read row is visible only to its person (Ada sees her rows, not Bo's); the board cannot select reads directly.
25. `announcements_unread` counts unread visible posts and drops to zero after reading; counts only the last 90 days; zero for a person with no person row.
26. `announcement_reader_stats`: board gets `readers_total`, `readers_read`, `no_login` (add a login-less owner to unit 2); an owner gets zero rows; the counts exclude persons whose ownership ended.
27. `document_links` accepts a link to an `announcements` row (target check widened), still rejects an unknown table, and still accepts every earlier target table.
28. Same-association triggers: direct superuser insert of an `announcement_units` row pointing at another association's unit raises `42501`; same for reads and for `attachment_document_id`.
29. Audit: posting writes `audit_log` rows for `announcements`; reads write none.

Invites and profile
30. `invites_person_guard`: a `person_id` from another association is refused; a non-owner role with `person_id` is refused.
31. `redeem_invite` with `person_id`: the person's `auth_user_id` is set, the name stays, an `owner` grant exists, the invite is marked redeemed, no second person row was created.
32. `redeem_invite` for a person who already has a login raises `23505`; for a stale token still raises `no_data_found`; the old no-`person_id` path still creates a person (regression of 0027).
33. `redeem_invite` with `person_id` revives a revoked owner grant.
34. `persons_self_edit_guard`: Ada cannot change `full_name`, `email` or `auth_user_id` (raises `42501`) but can change `phone` and `mailing_address` directly; Cy (board) can change any of them; a SECURITY DEFINER function that updates `persons` (call `redact_person` on a former owner) still works.
35. `update_my_profile` changes the caller's own phone and address; refuses over-long input (`22023`); with no person row raises `42501`.
36. `board_roster` returns names and roles of live grants only (expired and revoked excluded) to members; zero rows for another association's member.
37. `viewer_context`: Ada has roles `{owner}`, `owned_unit_ids = [unit1]`, `is_board = false`; Cy has `{board_admin, owner}` and `is_board = true`; an aal1 session gets no row.
38. `withdraw_payment_report`: the reporter can withdraw a pending report (becomes dismissed with the note); a different owner cannot; a matched report cannot be withdrawn.
39. `tg_dues_report_pending_cap`: the eleventh pending report for a unit is refused with hint `report_cap`; after one is withdrawn, a new one is accepted.

Lint-style
40. `migrations.test.ts` and `rls.test.ts` pass unchanged (they are the check for "no new anon-callable definer", search paths pinned, RLS on every table, association_id on every table, no cascades from associations).
41. Every function 0054 creates is not executable by `anon`; `unit_position_core` and `unit_statement_core` are not executable by `authenticated`.
42. Migration-path: apply 0054 on top of seeded data (with an existing invite row and existing reports); all rows survive and `invites.person_id` is null.

### 10.2 Unit tests (`tests/unit/`)

- `owner-standing.test.ts`: every row of the copy table in 4.2 (money formatting, singular/plural, missing dates), including `not_charged`, `ahead` with owed zero, `behind` with credit.
- `owner-statement.test.ts`: `parsePeriodParams` (bad dates, swapped dates, 10-year clamp, presets), `lineAmount` signs, `balanceWords`.
- `owner-announcements.test.ts`: the zod schema (every message), `announcementPreview` (word cut, three dots, newline collapse, no HTML passthrough), `sortAnnouncements`, `readSummary` (singular/plural, `no_login`), `audienceLabel`, `mapSaveError`.
- `owner-nav.test.ts`: `navFor("owner")` contains no Bank Feed, Taxes, HOA Dues, Building Info; contains Home, Statement, How to pay, Announcements, Repairs, Budget, Building insurance, Your building, Documents, My profile; `navFor("staff", { ownsUnit: false })` has no "My unit"; `{ ownsUnit: true }` has it; every `href` is an existing route (read from a static list in the test, kept in step with `src/app`); every `tourId` is unique within a role's nav.
- `tour-steps.test.ts` (update): owner steps as 7.4; every `target` exists in the nav of that role; no em dashes.
- `sidebar-collapse.test.ts` (update): `pageTitleFor` for the new prefixes and the `role` argument.
- `board-only.test.tsx` (render to string): the exact heading and sentence, with and without `alternative`, with and without a board contact email; no em dashes.
- `owner-copy.test.ts`: reads the page and component source files of this spec and asserts no em dash (U+2014) and no "vendor" in user-facing strings.
- `owner-statement-flag.test.ts`: `StatementDownload` renders nothing while the flag is false.

### 10.3 Manual checks before "General Kenobi" (dev project `xhrivmdkrcfkhjyhkhye`)

1. Sign in as an owner-only dev account: `/` lands on `/owner`; every sidebar item opens a page with content or an honest message; `/bank-feed`, `/delinquency`, `/ledger`, `/tax`, `/building`, `/financial-statements` each show "This part is for the board".
2. As board admin: invite an existing owner with "Invite to sign in", redeem the link in a private window, confirm the new login sees the unit's balance and not a second person.
3. Post an announcement to one unit; confirm the other owner never sees it, the unread dot clears after opening, and the board sees the count.
4. Attach a PDF: try a `board_only` file (refused with the share prompt), share it, post, open it as the owner (storage download works).
5. A phone (375 px): statement cards, Copy buttons, composer.

---

## 11. Build order

1. **Migration 0054** and `tests/db/owner-portal.test.ts` (10.1) green; update `tests/db/migrations.test.ts` comments only if lint messages change (no exception list changes for this migration).
2. `src/lib/owner/*` pure code and unit tests: `standing.ts`, `statement.ts`, `announcements.ts`, `flags.ts`.
3. `getViewer`, `BoardOnly`, `ContactLine`, `CopyField`, `MoneyAnswerCard`.
4. Pages: `/owner/statement/*`, `/owner/pay`, `/owner/profile`, `/owner/building`, then `/owner` (needs the repairs summary and documents list).
5. Announcements: actions, list, detail, composer.
6. Integration (section 12): nav, layout, tour, `/` redirect, board-only guards, Building Info edits, setup guide, Terms and Privacy, DECISIONS #38.
7. Full run: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, then the manual checks.

Steps 1 to 5 can be done by the Portal workstream; step 6 is the Integration workstream's, per the ownership table in the master brief. Dependencies on the other specs: the PDF button (money spec) is behind `STATEMENT_PDF_ENABLED`; the email preferences card (money spec) replaces `email-preferences-slot.tsx`; announcement email (money spec) adds one button to posted rows.

---

## 12. Integration tasks

Exact files for the Integration workstream (nothing here is done by the Portal workstream except the files it owns in section 2.1).

| File | Change |
|---|---|
| `src/app/page.tsx` | After `getUser()`: `const viewer = await getViewer(); if (viewer && !viewer.isStaff) redirect("/owner");` (import `redirect`, `getViewer`). No other change to the Dashboard. |
| `src/components/sidebar/config.tsx`, `sidebar.tsx`, `src/app/layout.tsx` | Section 7.1 to 7.3 verbatim. |
| `src/lib/tour/steps.ts` | Section 7.4. (`AppTour` already skips steps whose target element is absent.) |
| `src/lib/home/setup-guide.ts` | Building section: add step `{ key: "board_contact", name: "Say who owners should write to", detail: contact set ? "Owners see {name} on their home page." : "A name and an email, so owners know who to ask.", href: "/building#contact", done: Boolean(a.board_contact_email), doneOn: null, instructions: ["On Building Info, open the association profile and fill in Who owners write to.", "Owners see it on their home page and your reminder emails reply to it."] }`. Add `board_contact_email` to `SetupInputs.association` and to the `associations` select in `src/app/page.tsx`. Rework the step `invites` (`Invite them to sign in`) to done when at least one invite carries a `person_id` or any invite exists; update `tests/unit/setup-guide.test.ts`. Add `announcements` count to `SetupInputs` (`announcementCount: number`) and a step in section `building`: `{ key: "first_announcement", name: "Post a welcome note", ..., href: "/announcements/new", done: announcementCount > 0, informational: true }` (informational: never blocks "complete"). |
| `src/app/building/page.tsx`, `association-profile-form.tsx`, `actions.ts`, `person-row.tsx`, `generate-invite-form.tsx` | Section 6.9 and 5.3: three contact fields (also add `board_contact_*` to the `updateAssociationProfile` update, validate email with the same pattern as the DB), `createOwnerInvite`, `Invite to sign in`, and the invite draft email. The generic invite form keeps its role select; add a person select shown only for `owner` ("Link to someone already in your list, or leave blank to create a new person"). |
| `src/app/dues/page.tsx` | Owner-only users: `redirect("/owner/pay")`; delete the inline owner branch (lines from `if (!canReadFinancials)` to its closing return) and the `howToPay` card's owner-only copy; the card stays for the board. Export the `howToPay` markup as `src/components/dues/how-to-pay-card.tsx` only if the board page still needs it (it does: board admins edit it there). |
| `src/app/units/[unitId]/page.tsx` | Owners (not `can_read_financials`): `redirect("/owner/statement/" + unitId)` after the ownership check. |
| `src/app/bank-feed/page.tsx`, `delinquency/page.tsx`, `ledger/page.tsx`, `tax/page.tsx`, `building/page.tsx`, `financial-statements/page.tsx`, `contractors/[vendorId]/page.tsx` | The `BoardOnly` guards in 2.4. |
| `src/app/dues/actions.ts` `reportOutsidePayment` | The two edits in 5.1. |
| `src/lib/supabase/proxy.ts` | No change (`/owner` and `/announcements` are signed-in pages; the default rule applies). |
| `src/app/terms/page.tsx` | Section 3 bullet 2 is the money spec's change. For the portal: in "1. Who can use Walkup" add `Owners can sign in to see their own balance, statements and the notices the board posts. The board decides who is an owner of which unit.` |
| `src/app/privacy/page.tsx` | In "What we collect" add: `Announcements your board posts, and a record of which owners opened them. The board sees how many owners opened a post, not who.` and `A phone number and mailing address you add to your own profile.` Update `tests/unit/privacy-page.test.ts` if it pins the list. |
| `docs/DECISIONS.md` | Append #38 (1.4). |
| `tests/db/migrations.test.ts` | No change for 0054. (0055 changes the anon-exception list, see the money spec.) |
| `tests/unit/tour-steps.test.ts`, `sidebar-collapse.test.ts`, `setup-guide.test.ts` | Updates named in 7.4 and above. |
| `tests/e2e/app.spec.ts` | Add owner-account smoke: `/` -> `/owner`, each nav link returns 200 and a heading, `/bank-feed` shows "This part is for the board". |

---

## 13. Deliberately left out (and why)

- **Online payment, autopay or card entry.** DECISIONS #22/#24; `DUES_PAYMENTS_ENABLED` stays false. The portal explains how to pay at the bank.
- **Comments, replies or reactions on announcements.** Doug's ask was comment-less; a thread in a four-unit building becomes an argument with a paper trail.
- **Push notifications and SMS.** Email is the money spec's; the sidebar badge and the unread dot are the only in-app alerts.
- **A directory of neighbours.** Owners still cannot read other owners' contact details (0002). The board roster shows names only.
- **Rich text, images in announcements, scheduled posting.** Plain text and one attachment keep it safe and reviewable. Scheduling can follow once the email sender exists.
- **Editing name or email from the profile.** They are the board's record. A change-of-email flow with re-verification is a separate piece of work (Supabase Auth email change plus a persons update).
- **Co-owner management by owners.** Adding a spouse or a co-owner is a board action on Building Info.
- **Notifying board admins when payment instructions change.** Worth doing (a compromised admin changing the Zelle handle is the classic fraud); it belongs with the money spec's notification work. Recorded here so it is not forgotten.
- **Per-owner "view as" for the board.** The board's preview of a unit's statement (6.2) covers the need without impersonation.
- **Multiple associations per login.** DECISIONS #11 (single-association UI) holds.
- **Statement PDF and emailed statements.** `money-and-reminders-spec.md`.
