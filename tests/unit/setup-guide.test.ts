import { describe, expect, it } from "vitest";
import {
  buildSetupGuide,
  countSteps,
  isSetupComplete,
  nextStep,
  openSteps,
  type SetupInputs,
} from "@/lib/home/setup-guide";

const TODAY = new Date("2026-09-30T00:00:00");

/** What create_association_and_owner leaves behind: one person, one admin grant, nothing else. */
function freshSignup(): SetupInputs {
  return {
    today: TODAY,
    association: {
      ein: null,
      city: null,
      county: null,
      incorporated_on: null,
      dues_payee_name: null,
      dues_account_number: null,
      dues_zelle_handle: null,
    },
    units: [],
    unitOwners: [],
    persons: [{ id: "me" }],
    roleGrants: [{ person_id: "me", granted_on: "2026-09-01", revoked_at: null, expires_on: null }],
    myPersonId: "me",
    inviteCount: 0,
    bankConnections: [],
    uncategorizedCount: 0,
    postedEntryCount: 0,
    budgetLineCount: 0,
    assessmentScheduleCount: 0,
    taxFilingComputedAt: null,
    policies: [],
    vendors: [],
    documents: [],
  };
}

function fullyDone(): SetupInputs {
  return {
    today: TODAY,
    association: {
      ein: "36-1234567",
      city: "Chicago",
      county: "Cook",
      incorporated_on: "2004-03-11",
      dues_payee_name: "2158 N Damen Condo Assoc",
      dues_account_number: null,
      dues_zelle_handle: null,
    },
    units: [{ id: "u1" }, { id: "u2" }],
    unitOwners: [
      { unit_id: "u1", effective_from: "2020-01-01", effective_to: null },
      { unit_id: "u2", effective_from: "2021-06-01", effective_to: null },
    ],
    persons: [{ id: "me" }, { id: "bo" }],
    roleGrants: [
      { person_id: "me", granted_on: "2026-09-01", revoked_at: null, expires_on: null },
      { person_id: "bo", granted_on: "2026-09-02", revoked_at: null, expires_on: null },
    ],
    myPersonId: "me",
    inviteCount: 1,
    bankConnections: [{ status: "active", created_at: "2026-09-03T10:00:00Z", last_synced_at: "2026-09-04T10:00:00Z" }],
    uncategorizedCount: 0,
    postedEntryCount: 12,
    budgetLineCount: 4,
    assessmentScheduleCount: 1,
    taxFilingComputedAt: "2026-02-01T00:00:00Z",
    policies: [{ effective_from: "2026-01-01", effective_to: "2027-01-01" }],
    vendors: [{ w9_on_file: true, w9_received_on: "2026-05-01", is_1099_exempt: false }],
    documents: [
      { category_slug: "governing", uploaded_at: "2026-09-05T00:00:00Z" },
      { category_slug: "insurance", uploaded_at: "2026-09-06T00:00:00Z" },
    ],
  };
}

describe("setup guide", () => {
  it("puts Building Info first with nothing done on a fresh signup", () => {
    const sections = buildSetupGuide(freshSignup());
    expect(sections[0].key).toBe("building");
    expect(sections[0].steps.every((s) => !s.done)).toBe(true);
    expect(sections[0].steps).toHaveLength(5);
    expect(nextStep(sections)?.key).toBe("profile");
    expect(isSetupComplete(sections)).toBe(false);
  });

  it("is complete when every non-informational step is done", () => {
    const sections = buildSetupGuide(fullyDone());
    expect(isSetupComplete(sections)).toBe(true);
    expect(openSteps(sections)).toHaveLength(0);
    const { done, total } = countSteps(sections);
    expect(done).toBe(total);
  });

  it("does not count the informational Financial statements step against completion", () => {
    const input = fullyDone();
    input.postedEntryCount = 0;
    const sections = buildSetupGuide(input);
    const statements = sections[1].steps.find((s) => s.key === "statements")!;
    expect(statements.informational).toBe(true);
    expect(statements.done).toBe(false);
    expect(isSetupComplete(sections)).toBe(true);
  });

  it("does not mark W-9s done when there are no contractors yet", () => {
    const sections = buildSetupGuide(freshSignup());
    const w9 = sections[3].steps.find((s) => s.key === "w9")!;
    expect(w9.done).toBe(false);
  });

  it("marks W-9s done once every contractor has one or is exempt", () => {
    const input = freshSignup();
    input.vendors = [
      { w9_on_file: true, w9_received_on: "2026-03-01", is_1099_exempt: false },
      { w9_on_file: false, w9_received_on: null, is_1099_exempt: true },
    ];
    const w9 = buildSetupGuide(input)[3].steps.find((s) => s.key === "w9")!;
    expect(w9.done).toBe(true);
    expect(w9.doneOn).toBe("2026-03-01");
  });

  it("ticks the documents step from category slugs, not document_links.relation", () => {
    const input = freshSignup();
    input.documents = [{ category_slug: "governing", uploaded_at: "2026-09-05T00:00:00Z" }];
    let docs = buildSetupGuide(input)[3].steps.find((s) => s.key === "documents")!;
    expect(docs.done).toBe(false);

    input.documents.push({ category_slug: "insurance", uploaded_at: "2026-09-06T00:00:00Z" });
    docs = buildSetupGuide(input)[3].steps.find((s) => s.key === "documents")!;
    expect(docs.done).toBe(true);
    expect(docs.doneOn).toBe("2026-09-06");
  });

  it("requires every unit to have a current owner, ignoring ended ownerships", () => {
    const input = freshSignup();
    input.units = [{ id: "u1" }, { id: "u2" }];
    input.unitOwners = [
      { unit_id: "u1", effective_from: "2020-01-01", effective_to: null },
      { unit_id: "u2", effective_from: "2020-01-01", effective_to: "2025-01-01" },
    ];
    const owners = buildSetupGuide(input)[0].steps.find((s) => s.key === "owners")!;
    expect(owners.done).toBe(false);
  });

  it("ignores my own grant and revoked/expired grants when checking for other board access", () => {
    const input = freshSignup();
    input.persons = [{ id: "me" }, { id: "bo" }, { id: "vic" }];
    input.roleGrants = [
      { person_id: "me", granted_on: "2026-09-01", revoked_at: null, expires_on: null },
      { person_id: "bo", granted_on: "2026-09-02", revoked_at: "2026-09-10T00:00:00Z", expires_on: null },
      { person_id: "vic", granted_on: "2026-01-01", revoked_at: null, expires_on: "2026-04-01" },
    ];
    expect(buildSetupGuide(input)[0].steps.find((s) => s.key === "people")!.done).toBe(false);

    input.roleGrants.push({ person_id: "bo", granted_on: "2026-09-12", revoked_at: null, expires_on: null });
    expect(buildSetupGuide(input)[0].steps.find((s) => s.key === "people")!.done).toBe(true);
  });

  it("only counts the backlog as cleared once a sync has actually happened", () => {
    const input = freshSignup();
    input.bankConnections = [{ status: "active", created_at: "2026-09-03T10:00:00Z", last_synced_at: null }];
    input.uncategorizedCount = 0;
    const steps = buildSetupGuide(input)[1].steps;
    expect(steps.find((s) => s.key === "bank")!.done).toBe(true);
    expect(steps.find((s) => s.key === "sync")!.done).toBe(false);
    expect(steps.find((s) => s.key === "backlog")!.done).toBe(false);
  });

  it("does not count an expired insurance policy", () => {
    const input = freshSignup();
    input.policies = [{ effective_from: "2024-01-01", effective_to: "2025-01-01" }];
    expect(buildSetupGuide(input)[2].steps.find((s) => s.key === "insurance")!.done).toBe(false);
  });
});
