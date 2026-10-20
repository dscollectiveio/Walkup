import { describe, expect, it } from "vitest";
import { describeAccessEvent, type AuditRow } from "@/lib/access/activity";

const names = {
  person: (id: string) => ({ p1: "Sue Lee", p2: "Bo Lindqvist" })[id] ?? "someone",
  actor: (id: string | null) => (id === "u1" ? "Cy Ferreira" : "Walkup"),
};
const row = (over: Partial<AuditRow>): AuditRow => ({
  id: 1,
  table_name: "role_grants",
  action: "insert",
  actor_user_id: "u1",
  before_data: null,
  after_data: null,
  occurred_at: "2026-10-20T12:00:00Z",
  ...over,
});

describe("access activity sentences", () => {
  it("describes a role given, ended and extended", () => {
    expect(describeAccessEvent(row({ after_data: { person_id: "p1", role: "accountant" } }), names)).toBe("Cy Ferreira gave Sue Lee the accountant role");
    expect(
      describeAccessEvent(row({ action: "update", actor_user_id: null, before_data: { person_id: "p1", role: "owner", revoked_at: null }, after_data: { person_id: "p1", role: "owner", revoked_at: "x" } }), names),
    ).toBe("Walkup ended Sue Lee's owner access");
    expect(
      describeAccessEvent(row({ action: "update", before_data: { person_id: "p1", role: "accountant", expires_on: "2026-11-01" }, after_data: { person_id: "p1", role: "accountant", expires_on: "2027-01-30" } }), names),
    ).toBe("Cy Ferreira set Sue Lee's accountant access to end on 2027-01-30");
  });

  it("describes invites and positions", () => {
    expect(describeAccessEvent(row({ table_name: "invites", after_data: { email: "sue@example.test", role: "accountant" } }), names)).toBe("Cy Ferreira created an accountant invite for sue@example.test");
    expect(describeAccessEvent(row({ table_name: "board_positions", after_data: { person_id: "p2", position: "treasurer" } }), names)).toBe("Cy Ferreira made Bo Lindqvist Treasurer");
    expect(
      describeAccessEvent(row({ table_name: "board_positions", action: "update", before_data: { person_id: "p2", position: "treasurer", ended_at: null }, after_data: { person_id: "p2", position: "treasurer", ended_at: "2026-10-20" } }), names),
    ).toBe("Bo Lindqvist stepped down as Treasurer");
  });

  it("skips changes that are not worth a line", () => {
    expect(describeAccessEvent(row({ action: "update", before_data: { person_id: "p1", role: "owner" }, after_data: { person_id: "p1", role: "owner" } }), names)).toBeNull();
    expect(describeAccessEvent(row({ table_name: "persons" }), names)).toBeNull();
  });
});
