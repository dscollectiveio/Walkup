import { describe, expect, it } from "vitest";
import { parsePeople } from "@/lib/building/unit-people";

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};
const TODAY = "2026-10-15";

describe("parsePeople", () => {
  it("reads several people from one form, keeping each person's fields together", () => {
    const r = parsePeople(
      form([
        ["p.a.owner_row_id", "row-1"],
        ["p.a.person_id", "per-1"],
        ["p.a.full_name", "Ada Okonkwo"],
        ["p.a.email", "ada@example.test"],
        ["p.a.roles_submitted", "1"],
        ["p.a.roles", "owner"],
        ["p.b.mode", "new"],
        ["p.b.full_name", "Bo Lindqvist"],
        ["p.b.owns_unit", "on"],
        ["p.b.effective_from", "2026-09-01"],
        ["p.c.mode", "link"],
        ["p.c.existing_person_id", "per-9"],
      ]),
      TODAY,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.map((e) => e.kind)).toEqual(["resident", "new", "link"]);
    expect(r.entries[0]).toMatchObject({ personId: "per-1", ownerRowId: "row-1", remove: false, roles: ["owner"], rolesSubmitted: true });
    expect(r.entries[1]).toMatchObject({ fields: { full_name: "Bo Lindqvist", email: null }, owns: true, since: "2026-09-01" });
    expect(r.entries[2]).toMatchObject({ personId: "per-9", owns: false, since: TODAY });
  });

  it("trims names and turns blank contact fields into null", () => {
    const r = parsePeople(form([["p.x.mode", "new"], ["p.x.full_name", "  Cy  "], ["p.x.email", " "], ["p.x.phone", ""]]), TODAY);
    expect(r.ok && r.entries[0]).toMatchObject({ fields: { full_name: "Cy", email: null, phone: null, mailing_address: null } });
  });

  it("allows an existing resident to be removed without a name", () => {
    const r = parsePeople(form([["p.a.owner_row_id", "row-1"], ["p.a.person_id", "per-1"], ["p.a.remove", "1"], ["p.a.full_name", ""]]), TODAY);
    expect(r.ok && r.entries[0]).toMatchObject({ kind: "resident", remove: true });
  });

  it("defaults a removed resident's end date to today, and checks a given one", () => {
    const base: [string, string][] = [["p.a.owner_row_id", "r1"], ["p.a.person_id", "per-1"], ["p.a.remove", "1"]];
    expect(parsePeople(form(base), TODAY)).toMatchObject({ ok: true, entries: [{ endDate: TODAY }] });
    expect(parsePeople(form([...base, ["p.a.end_date", "2026-08-15"]]), TODAY)).toMatchObject({ ok: true, entries: [{ endDate: "2026-08-15" }] });
    expect(parsePeople(form([...base, ["p.a.end_date", "08/15/2026"]]), TODAY)).toMatchObject({ ok: false });
  });

  it("refuses the things that would save something wrong", () => {
    expect(parsePeople(form([["p.a.mode", "new"], ["p.a.full_name", " "]]), TODAY)).toMatchObject({ ok: false });
    expect(parsePeople(form([["p.a.mode", "link"]]), TODAY)).toMatchObject({ ok: false });
    expect(parsePeople(form([["p.a.mode", "teleport"]]), TODAY)).toMatchObject({ ok: false });
    expect(parsePeople(form([["p.a.mode", "new"], ["p.a.full_name", "A"], ["p.a.roles", "superuser"]]), TODAY)).toEqual({ ok: false, error: "Unrecognized role." });
    expect(parsePeople(form([["p.a.mode", "new"], ["p.a.full_name", "A"], ["p.a.owns_unit", "on"], ["p.a.effective_from", "10/01/2026"]]), TODAY)).toMatchObject({ ok: false });
    expect(parsePeople(form([["p.a.owner_row_id", "r"], ["p.a.full_name", "A"]]), TODAY)).toEqual({ ok: false, error: "Missing person." });
    expect(parsePeople(form([["p.a.owner_row_id", "r"], ["p.a.person_id", "x"], ["p.a.full_name", ""]]), TODAY)).toMatchObject({ ok: false });
  });

  it("refuses the same person twice, and returns no entries for an empty form", () => {
    const dup = parsePeople(form([["p.a.mode", "link"], ["p.a.existing_person_id", "p1"], ["p.b.mode", "link"], ["p.b.existing_person_id", "p1"]]), TODAY);
    expect(dup).toEqual({ ok: false, error: "The same person is listed twice." });
    expect(parsePeople(form([["label", "Unit 1"]]), TODAY)).toEqual({ ok: true, entries: [] });
  });
});
