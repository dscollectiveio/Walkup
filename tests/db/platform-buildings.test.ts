import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/**
 * Migration 0086: the owner's view of every building, and the note when a new one signs up. Only a platform admin
 * sees the view; only the service role claims alerts; each building is announced once.
 */

const DOUG = "dddd0000-0000-0000-0000-0000000000ff";

describe("platform buildings view and signup alerts (0086)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    await db.query(`insert into auth.users (id, email) values ($1, 'doug@example.test')`, [DOUG]);
    await db.query(`insert into public.platform_admins (user_id, note) values ($1, 'Doug')`, [DOUG]);
  });
  afterEach(async () => {
    await db.close();
  });

  it("shows every building and the people with a role in it to a platform admin only", async () => {
    const rows = await asUser(db, DOUG, async () => (await db.query<{ display_name: string; unit_count: number; people: { name: string; roles: string[] }[] }>(`select display_name, unit_count, people from public.platform_buildings_overview()`)).rows);
    expect(rows).toHaveLength(2);
    const damen = rows.find((r) => r.unit_count === 3);
    expect(damen).toBeTruthy();
    const names = (damen?.people ?? []).map((p) => p.name);
    expect(names).toContain("Cy Ferreira");
    const cy = damen?.people.find((p) => p.name === "Cy Ferreira");
    expect(cy?.roles).toContain("board_admin");
    // Owners are counted, not listed.
    expect((damen?.people ?? []).every((p) => !p.roles.includes("owner"))).toBe(true);

    for (const user of [f.cyUser, f.adaUser, f.niaUser]) {
      await expect(asUser(db, user, () => db.query(`select * from public.platform_buildings_overview()`)), user).rejects.toThrow(/platform admin/);
    }
  });

  it("keeps the alert functions away from signed-in users", async () => {
    for (const call of [`select * from public.platform_signup_alerts_claim()`, `select public.platform_signup_alert_mark('${f.damen}')`, `select public.platform_building_people('${f.damen}')`]) {
      await expect(asUser(db, DOUG, () => db.query(call)), call).rejects.toThrow(/permission denied/);
    }
    await expect(asUser(db, DOUG, () => db.query(`select * from public.platform_signup_alerts`))).rejects.toThrow(/permission denied/);
  });

  it("announces a new building once, to the platform admins, and not an old one", async () => {
    await db.query(`update public.associations set created_at = now() - interval '30 days' where id = $1`, [f.hoyne]);
    const claim = () => asService(db, async () => (await db.query<{ association_id: string; recipients: string[]; people: unknown[] }>(`select * from public.platform_signup_alerts_claim()`)).rows);
    const first = await claim();
    expect(first.map((r) => r.association_id)).toEqual([f.damen]);
    expect(first[0].recipients).toEqual(["doug@example.test"]);
    expect(first[0].people.length).toBeGreaterThan(0);

    await asService(db, () => db.query(`select public.platform_signup_alert_mark($1)`, [f.damen]));
    expect(await claim()).toHaveLength(0);
    await asService(db, () => db.query(`select public.platform_signup_alert_mark($1)`, [f.damen]));
  });
});
