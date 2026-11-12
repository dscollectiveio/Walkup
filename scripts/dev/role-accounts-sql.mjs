#!/usr/bin/env node
// Prints the SQL that creates the six development role accounts (everyone but the board admin, who is the
// original dev account). DEVELOPMENT DATABASE ONLY (project xhrivmdkrcfkhjyhkhye): never run this against
// production. It is idempotent: running it again changes nothing that exists.
//
//   node scripts/dev/role-accounts-sql.mjs > /tmp/role-accounts.sql     then apply it to the dev project
//   node scripts/dev/role-accounts-sql.mjs --remove                     prints the SQL that deletes them again
//
// Only bcrypt hashes go into the SQL. Each password is derived from DEV_AUTH_PASSWORD in .env.local (the same
// derivation as src/lib/dev/roles.ts), so nothing new is stored or printed. Needs `htpasswd` (ships with macOS).

import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const ASSOCIATION = "11111111-1111-1111-1111-111111111111"; // the dev building, "2158 N Damen HOA"
const OWNER_UNIT_LABEL = "Unit 4";
const ACCOUNTS = [
  { role: "board_member", name: "Dev Board Member" },
  { role: "accountant", name: "Dev Accountant" },
  { role: "property_manager", name: "Dev Property Manager" },
  { role: "attorney", name: "Dev Attorney" },
  { role: "observer", name: "Dev Observer" },
  { role: "owner", name: "Dev Owner" },
];
const TIMED = new Set(["accountant", "property_manager", "attorney", "observer"]);
const email = (role) => `walkup-dev+${role.replace("_", "-")}@dscollective.io`;

function envValue(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(".env.local")) return null;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === name) return m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return null;
}

const emails = ACCOUNTS.map((a) => `'${email(a.role)}'`).join(", ");

if (process.argv.includes("--remove")) {
  console.log(`-- Removes the development role accounts and the people and grants made for them.
delete from public.unit_owners where person_id in (select id from public.persons where email in (${emails}));
delete from public.role_grants where person_id in (select id from public.persons where email in (${emails}));
delete from public.persons where email in (${emails});
delete from auth.mfa_factors where user_id in (select id from auth.users where email in (${emails}));
delete from auth.identities where user_id in (select id from auth.users where email in (${emails}));
delete from auth.users where email in (${emails});`);
  process.exit(0);
}

const base = envValue("DEV_AUTH_PASSWORD");
if (!base) {
  console.error("DEV_AUTH_PASSWORD is not set in .env.local.");
  process.exit(1);
}
const bcrypt = (pw) =>
  execFileSync("htpasswd", ["-nbBC", "10", "x", pw]).toString().trim().split(":").slice(1).join(":").replace(/^\$2y\$/, "$2b$");

const out = ["-- Development role accounts. Dev database only. Idempotent.", "begin;"];
for (const a of ACCOUNTS) {
  const pw = createHmac("sha256", base).update(`walkup-dev-role:${a.role}`).digest("hex").slice(0, 32);
  const hash = bcrypt(pw);
  const e = email(a.role);
  out.push(`
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '${e}', '${hash}', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', ''
where not exists (select 1 from auth.users where email = '${e}');

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
from auth.users u where u.email = '${e}'
  and not exists (select 1 from auth.identities i where i.user_id = u.id);

insert into public.persons (association_id, full_name, email, auth_user_id)
select '${ASSOCIATION}', '${a.name}', '${e}', u.id from auth.users u where u.email = '${e}'
  and not exists (select 1 from public.persons p where p.association_id = '${ASSOCIATION}' and p.auth_user_id = u.id);

insert into public.role_grants (association_id, person_id, role, granted_on, expires_on)
select '${ASSOCIATION}', p.id, '${a.role}', current_date, ${TIMED.has(a.role) ? "current_date + 365" : "null"}
from public.persons p where p.email = '${e}' and p.association_id = '${ASSOCIATION}'
  and not exists (select 1 from public.role_grants g where g.person_id = p.id and g.association_id = p.association_id and g.role = '${a.role}');`);
  if (a.role === "owner") {
    out.push(`
insert into public.unit_owners (association_id, unit_id, person_id, effective_from)
select '${ASSOCIATION}', un.id, p.id, current_date - 30
from public.persons p join public.units un on un.association_id = p.association_id and un.label = '${OWNER_UNIT_LABEL}'
where p.email = '${e}' and p.association_id = '${ASSOCIATION}'
  and not exists (select 1 from public.unit_owners o where o.person_id = p.id and o.unit_id = un.id);`);
  }
}
out.push("\ncommit;");
console.log(out.join("\n"));
