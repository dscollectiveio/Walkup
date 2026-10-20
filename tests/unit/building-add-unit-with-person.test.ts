import { buildingTodayIso } from "@/lib/dates";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/google/places", () => ({ geocode: vi.fn() }));
vi.mock("@/lib/security/fresh-signin", () => ({ freshSignInError: async () => null }));

type Call = { table: string; op: string; row?: Record<string, unknown> };
const calls: Call[] = [];
let failures: Record<string, { code?: string; message: string } | undefined> = {};
let ownerRow: { effective_from: string } | null = { effective_from: "2020-01-01" };
let affected = true;

// A tiny stand-in for supabase-js: records each write, answers inserts with an
// id, and fails the table named in `failures`.
function fakeClient() {
  const table = (name: string) => {
    let op = "select";
    let row: Record<string, unknown> | undefined;
    const chain: Record<string, unknown> = {
      insert: (r: Record<string, unknown>) => ((op = "insert"), (row = r), chain),
      upsert: (r: Record<string, unknown>) => ((op = "upsert"), (row = r), chain),
      update: (r: Record<string, unknown>) => ((op = "update"), (row = r), chain),
      delete: () => ((op = "delete"), chain),
      select: () => chain,
      order: () => chain,
      eq: () => chain,
      is: () => chain,
      limit: () => chain,
      single: async () => {
        if (op === "select" && name === "unit_owners") return { data: ownerRow, error: null };
        calls.push({ table: name, op, row });
        const f = failures[name];
        return f ? { data: null, error: f } : { data: { id: `${name}-1` }, error: null };
      },
      then: (resolve: (v: unknown) => void) => {
        if (op === "select") return resolve({ data: name === "associations" ? [{ id: "assoc-1" }] : [], error: null });
        calls.push({ table: name, op, row });
        const f = failures[name];
        return resolve({ data: f || !affected ? (f ? null : []) : [{ id: `${name}-1` }], error: f ?? null });
      },
    };
    return chain;
  };
  return { from: table };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeClient(),
  getUser: async () => ({ id: "user-1" }),
}));

import { addPerson, addUnitWithPerson, saveUnitAndPeople } from "@/app/building/actions";

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};
const ops = () => calls.map((c) => `${c.table}:${c.op}`);

beforeEach(() => {
  calls.length = 0;
  failures = {};
  ownerRow = { effective_from: "2020-01-01" };
  affected = true;
});

describe("addUnitWithPerson (any number of people)", () => {
  it("adds a unit, a new person, their role and the ownership, in that order", async () => {
    const result = await addUnitWithPerson(
      null,
      form([
        ["label", "Unit 4"],
        ["p.a.mode", "new"],
        ["p.a.full_name", "Ada Okonkwo"],
        ["p.a.email", "ada@example.test"],
        ["p.a.roles_submitted", "1"],
        ["p.a.roles", "owner"],
        ["p.a.owns_unit", "on"],
        ["p.a.effective_from", "2026-10-01"],
      ]),
    );
    expect(result).toEqual({ ok: true });
    expect(ops()).toEqual(["units:insert", "persons:insert", "role_grants:upsert", "unit_owners:insert"]);
    expect(calls[3].row).toMatchObject({ unit_id: "units-1", person_id: "persons-1", effective_from: "2026-10-01" });
  });

  it("adds several people to one unit, each with their own ownership", async () => {
    const result = await addUnitWithPerson(
      null,
      form([
        ["label", "Unit 2"],
        ["p.a.mode", "new"],
        ["p.a.full_name", "Ada"],
        ["p.a.owns_unit", "on"],
        ["p.b.mode", "new"],
        ["p.b.full_name", "Bo"],
        ["p.b.owns_unit", "on"],
        ["p.c.mode", "link"],
        ["p.c.existing_person_id", "p-9"],
        ["p.c.owns_unit", "on"],
      ]),
    );
    expect(result).toEqual({ ok: true });
    expect(ops()).toEqual(["units:insert", "persons:insert", "unit_owners:insert", "persons:insert", "unit_owners:insert", "unit_owners:insert"]);
    expect(calls[5].row).toMatchObject({ person_id: "p-9" });
  });

  it("with no one in it, saves just the unit", async () => {
    expect(await addUnitWithPerson(null, form([["label", "Garden"]]))).toEqual({ ok: true });
    expect(ops()).toEqual(["units:insert"]);
  });

  it("does not record ownership when 'They own this unit' is off", async () => {
    await addUnitWithPerson(null, form([["label", "Unit 6"], ["p.a.mode", "new"], ["p.a.full_name", "Bo Lindqvist"]]));
    expect(ops()).toEqual(["units:insert", "persons:insert"]);
  });

  it("checks what it can before writing anything", async () => {
    expect(await addUnitWithPerson(null, form([["label", ""]]))).toMatchObject({ error: expect.stringContaining("label") });
    expect(await addUnitWithPerson(null, form([["label", "U"], ["p.a.mode", "new"], ["p.a.full_name", " "]]))).toMatchObject({ error: expect.stringContaining("name") });
    expect(await addUnitWithPerson(null, form([["label", "U"], ["p.a.mode", "link"]]))).toMatchObject({ error: expect.stringContaining("Choose") });
    expect(await addUnitWithPerson(null, form([["label", "U"], ["p.a.mode", "new"], ["p.a.full_name", "A"], ["p.a.roles", "superuser"]]))).toMatchObject({ error: "Unrecognized role." });
    expect(calls).toEqual([]);
  });

  it("says a duplicate unit label already exists and stops", async () => {
    failures.units = { code: "23505", message: "dup" };
    const result = await addUnitWithPerson(null, form([["label", "Unit 1"], ["p.a.mode", "new"], ["p.a.full_name", "A"]]));
    expect(result).toEqual({ error: "A unit named “Unit 1” already exists." });
    expect(ops()).toEqual(["units:insert"]);
  });

  it("when a person fails after the unit was saved, says exactly that and stops", async () => {
    failures.persons = { code: "23505", message: "dup" };
    const result = await addUnitWithPerson(null, form([["label", "Unit 8"], ["p.a.mode", "new"], ["p.a.full_name", "A"], ["p.a.owns_unit", "on"]]));
    expect(result).toMatchObject({ error: expect.stringMatching(/^Unit 8 was added, but A couldn't be saved: someone with that email is already on file/) });
    expect(ops()).toEqual(["units:insert", "persons:insert"]);
  });
});

describe("saveUnitAndPeople (the single Edit)", () => {
  const base: [string, string][] = [["unit_id", "u-1"], ["label", "Unit 1"]];

  it("saves the unit, then updates each resident, then adds the new person", async () => {
    const result = await saveUnitAndPeople(
      null,
      form([
        ...base,
        ["p.r0.owner_row_id", "row-1"],
        ["p.r0.person_id", "per-1"],
        ["p.r0.full_name", "Ada Okonkwo"],
        ["p.r0.phone", "(312) 555-0100"],
        ["p.r0.roles_submitted", "1"],
        ["p.r0.roles", "owner"],
        ["p.n0.mode", "new"],
        ["p.n0.full_name", "Bo Lindqvist"],
        ["p.n0.owns_unit", "on"],
      ]),
    );
    expect(result).toEqual({ ok: true });
    expect(ops()).toEqual(["units:update", "persons:update", "role_grants:upsert", "persons:insert", "unit_owners:insert"]);
    expect(calls[1].row).toMatchObject({ full_name: "Ada Okonkwo", phone: "(312) 555-0100" });
  });

  it("takes someone off the unit by ending their ownership, and leaves the person on file", async () => {
    const result = await saveUnitAndPeople(null, form([...base, ["p.r0.owner_row_id", "row-1"], ["p.r0.person_id", "per-1"], ["p.r0.remove", "1"]]));
    expect(result).toEqual({ ok: true });
    expect(ops()).toEqual(["units:update", "unit_owners:update"]);
    expect(calls[1].row).toHaveProperty("effective_to");
  });

  it("ends the ownership on the date given, so a sale last month is recorded as last month", async () => {
    ownerRow = { effective_from: "2020-01-01" };
    await saveUnitAndPeople(null, form([...base, ["p.r0.owner_row_id", "row-1"], ["p.r0.person_id", "per-1"], ["p.r0.remove", "1"], ["p.r0.end_date", "2026-09-01"]]));
    expect(calls[1].row).toEqual({ effective_to: "2026-09-01" });
  });

  it("ends the ownership yesterday when someone is taken off today, so they leave the unit today", async () => {
    ownerRow = { effective_from: "2020-01-01" };
    // No end date typed: the form defaults to today. Ending it today would keep them in the unit until midnight.
    await saveUnitAndPeople(null, form([...base, ["p.r0.owner_row_id", "row-1"], ["p.r0.person_id", "per-1"], ["p.r0.remove", "1"]]));
    const yesterday = new Date(`${buildingTodayIso()}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    expect(calls[1].row).toEqual({ effective_to: yesterday.toISOString().slice(0, 10) });
  });

  it("keeps a future end date as typed, since they are still there until then", async () => {
    ownerRow = { effective_from: "2020-01-01" };
    await saveUnitAndPeople(null, form([...base, ["p.r0.owner_row_id", "row-1"], ["p.r0.person_id", "per-1"], ["p.r0.remove", "1"], ["p.r0.end_date", "2999-01-01"]]));
    expect(calls[1].row).toEqual({ effective_to: "2999-01-01" });
  });

  it("deletes the record instead when the ownership starts today or later", async () => {
    ownerRow = { effective_from: "9999-01-01" };
    await saveUnitAndPeople(null, form([...base, ["p.r0.owner_row_id", "row-1"], ["p.r0.person_id", "per-1"], ["p.r0.remove", "1"]]));
    expect(ops()).toEqual(["units:update", "unit_owners:delete"]);
  });

  it("saves the unit first and says what did not save when a person fails", async () => {
    failures.persons = { message: "nope" };
    const result = await saveUnitAndPeople(
      null,
      form([...base, ["p.r0.owner_row_id", "row-1"], ["p.r0.person_id", "per-1"], ["p.r0.full_name", "Ada"], ["p.n0.mode", "new"], ["p.n0.full_name", "Bo"]]),
    );
    expect(result).toMatchObject({ error: expect.stringMatching(/^The unit's details were saved, but Ada couldn't be saved: nope/) });
    expect(ops()).toEqual(["units:update", "persons:update"]);
  });

  it("refuses when the viewer can't edit the unit, before touching anyone", async () => {
    affected = false;
    const result = await saveUnitAndPeople(null, form([...base, ["p.r0.owner_row_id", "row-1"], ["p.r0.person_id", "per-1"], ["p.r0.full_name", "Ada"]]));
    expect(result).toEqual({ error: "Only the board can edit units." });
    expect(ops()).toEqual(["units:update"]);
  });

  it("checks the form before writing anything", async () => {
    expect(await saveUnitAndPeople(null, form([["label", "Unit 1"]]))).toEqual({ error: "Missing unit." });
    expect(await saveUnitAndPeople(null, form([["unit_id", "u-1"], ["label", " "]]))).toMatchObject({ error: expect.stringContaining("label") });
    expect(await saveUnitAndPeople(null, form([...base, ["p.r0.owner_row_id", "r"], ["p.r0.person_id", "p"], ["p.r0.full_name", ""]]))).toMatchObject({ error: expect.stringContaining("name") });
    expect(calls).toEqual([]);
  });
});

describe("addPerson (Add a person)", () => {
  it("adds the person, their role, and puts them in a unit when one is chosen", async () => {
    const result = await addPerson(
      null,
      form([
        ["full_name", "Cy Accountant"],
        ["roles_submitted", "1"],
        ["roles", "accountant"],
        ["unit_id", "u-3"],
        ["effective_from", "2026-10-01"],
      ]),
    );
    expect(result).toEqual({ ok: true });
    expect(ops()).toEqual(["persons:insert", "role_grants:upsert", "unit_owners:insert"]);
    expect(calls[2].row).toMatchObject({ unit_id: "u-3", person_id: "persons-1", effective_from: "2026-10-01" });
  });

  it("with no role and no unit, just adds the person", async () => {
    expect(await addPerson(null, form([["full_name", "Dee"]]))).toEqual({ ok: true });
    expect(ops()).toEqual(["persons:insert"]);
  });

  it("checks the name, the role and the date before writing, and explains a duplicate email", async () => {
    expect(await addPerson(null, form([["full_name", " "]]))).toMatchObject({ error: expect.stringContaining("name") });
    expect(await addPerson(null, form([["full_name", "A"], ["roles", "root"]]))).toEqual({ error: "Unrecognized role." });
    expect(await addPerson(null, form([["full_name", "A"], ["unit_id", "u-1"], ["effective_from", "yesterday"]]))).toMatchObject({ error: expect.stringContaining("date") });
    expect(calls).toEqual([]);
    failures.persons = { code: "23505", message: "dup" };
    expect(await addPerson(null, form([["full_name", "A"]]))).toEqual({ error: "Someone with that email is already on file." });
  });

  it("says the person was saved when putting them in the unit fails", async () => {
    failures.unit_owners = { message: "boom" };
    const result = await addPerson(null, form([["full_name", "Eve"], ["unit_id", "u-1"]]));
    expect(result).toMatchObject({ error: expect.stringMatching(/^Eve was added, but they couldn't be put in the unit: boom/) });
  });
});
