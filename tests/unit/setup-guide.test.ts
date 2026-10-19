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
    taxFormsStarted: 0,
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
      board_contact_name: "Dana Lee",
      board_contact_email: "board@example.com",
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
    taxFormsStarted: 0,
    policies: [{ effective_from: "2026-01-01", status: "active" }],
    ownerSummaryPublishedAt: "2026-02-01T12:00:00Z",
    vendors: [{ w9_on_file: true, w9_received_on: "2026-05-01", is_1099_exempt: false, archived_at: null, inUse: true }],
    upkeepTasks: [{ id: "t1" }],
    emergencyInfo: { filled: 3 },
    documents: [
      { category_slug: "governing", uploaded_at: "2026-09-05T00:00:00Z" },
      { category_slug: "insurance", uploaded_at: "2026-09-06T00:00:00Z" },
    ],
  };
}

describe("setup guide", () => {
  it("puts Building & Owners first with nothing done on a fresh signup", () => {
    const sections = buildSetupGuide(freshSignup());
    expect(sections[0].key).toBe("building");
    expect(sections[0].steps.every((s) => !s.done)).toBe(true);
    expect(sections[0].steps.filter((s) => !s.informational)).toHaveLength(6);
    expect(sections[0].steps.map((s) => s.key)).toEqual([
      "profile",
      "board_contact",
      "import_units",
      "units",
      "owners",
      "people",
      "invites",
      "first_announcement",
    ]);
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

  it("ticks the Taxes step once a form is started, even before the year's figures are saved", () => {
    const input = freshSignup();
    expect(buildSetupGuide(input)[2].steps.find((s) => s.key === "tax")!.done).toBe(false);

    input.taxFormsStarted = 1;
    const tax = buildSetupGuide(input)[2].steps.find((s) => s.key === "tax")!;
    expect(tax.done).toBe(true);
    // A started form has no "computed on" date to show.
    expect(tax.doneOn).toBeNull();

    input.taxFormsStarted = 0;
    input.taxFilingComputedAt = "2026-02-01T00:00:00Z";
    expect(buildSetupGuide(input)[2].steps.find((s) => s.key === "tax")!).toMatchObject({ done: true, doneOn: "2026-02-01" });
  });

  it("counts only an active policy as recorded, by status rather than dates", () => {
    const input = freshSignup();
    input.policies = [{ effective_from: "2024-01-01", status: "expired" }];
    expect(buildSetupGuide(input)[2].steps.find((s) => s.key === "insurance")!.done).toBe(false);
    // A renewal saved early is "upcoming"; the old policy stays active until it starts.
    input.policies = [
      { effective_from: "2026-01-01", status: "active" },
      { effective_from: "2027-01-01", status: "upcoming" },
    ];
    expect(buildSetupGuide(input)[2].steps.find((s) => s.key === "insurance")!).toMatchObject({ done: true, doneOn: "2026-01-01" });
  });

  it("words the insurance step for whether Walkup can read the declarations", () => {
    const input = freshSignup();
    const step = () => buildSetupGuide(input)[2].steps.find((s) => s.key === "insurance")!;
    input.aiConfigured = true;
    expect(step().instructions[0]).toMatch(/Walkup reads each policy/);
    input.aiConfigured = false;
    expect(step().instructions[0]).toMatch(/enter the key figures/);
    expect(step().instructions.join(" ")).not.toMatch(/reads/);
  });

  it("ticks the owner summary step once a summary is published", () => {
    const input = freshSignup();
    const step = () => buildSetupGuide(input)[2].steps.find((s) => s.key === "insurance_owner_summary")!;
    expect(step()).toMatchObject({ done: false, href: "/insurance/owner-summary" });
    input.ownerSummaryPublishedAt = "2026-09-20T15:00:00Z";
    expect(step()).toMatchObject({ done: true, doneOn: "2026-09-20" });
  });

  it("starts Building upkeep with the upkeep schedule and the emergency info", () => {
    const input = freshSignup();
    const steps = () => buildSetupGuide(input)[3].steps;
    expect(steps().map((s) => s.key)).toEqual(["upkeep_schedule", "emergency_info", "vendors", "w9", "documents"]);
    expect(steps()[0]).toMatchObject({ done: false, href: "/repairs?view=upkeep" });
    expect(steps()[1]).toMatchObject({ done: false, href: "/repairs/emergency-info" });

    input.upkeepTasks = [{ id: "a" }, { id: "b" }];
    input.emergencyInfo = { filled: 1 };
    expect(steps()[0]).toMatchObject({ done: true, detail: "2 jobs on the calendar." });
    // One fact isn't enough to be useful in an emergency.
    expect(steps()[1]).toMatchObject({ done: false, detail: "Owners see it when they report an emergency." });
    input.emergencyInfo = { filled: 2 };
    expect(steps()[1].done).toBe(true);
  });

  it("sends the contractor steps to Repairs & Upkeep, ignoring archived contractors and W-9s of contractors not in use", () => {
    const input = freshSignup();
    input.vendors = [
      { w9_on_file: false, w9_received_on: null, is_1099_exempt: false, archived_at: "2026-01-01T00:00:00Z", inUse: true },
    ];
    let steps = buildSetupGuide(input)[3].steps;
    expect(steps.find((s) => s.key === "vendors")).toMatchObject({ done: false, href: "/repairs?view=contractors" });
    expect(steps.find((s) => s.key === "w9")).toMatchObject({ done: false, href: "/repairs?view=contractors" });

    input.vendors.push({ w9_on_file: false, w9_received_on: null, is_1099_exempt: false, archived_at: null, inUse: false });
    steps = buildSetupGuide(input)[3].steps;
    expect(steps.find((s) => s.key === "vendors")!.done).toBe(true);
    expect(steps.find((s) => s.key === "w9")!.done).toBe(true);
  });

  it("asks for a board contact, and ticks it once an email is set", () => {
    const input = freshSignup();
    let step = buildSetupGuide(input)[0].steps.find((s) => s.key === "board_contact")!;
    expect(step).toMatchObject({
      name: "Say who owners should write to",
      detail: "A name and an email, so owners know who to ask.",
      href: "/building#contact",
      done: false,
    });
    expect(step.informational).toBeUndefined();
    input.association.board_contact_name = "Dana Lee";
    input.association.board_contact_email = "board@example.com";
    step = buildSetupGuide(input)[0].steps.find((s) => s.key === "board_contact")!;
    expect(step).toMatchObject({ done: true, detail: "Owners see Dana Lee on their home page." });
  });

  it("offers the optional import steps, which never block completion", () => {
    const input = fullyDone();
    const sections = buildSetupGuide(input);
    const building = sections[0].steps.map((s) => s.key);
    expect(building.indexOf("import_units")).toBeLessThan(building.indexOf("units"));
    const money = sections[1].steps.map((s) => s.key);
    expect(money.indexOf("import_opening")).toBeLessThan(money.indexOf("bank"));
    expect(money.indexOf("import_history")).toBe(money.indexOf("backlog") + 1);
    for (const key of ["import_units", "import_opening", "import_history"]) {
      const step = sections.flatMap((s) => s.steps).find((s) => s.key === key)!;
      expect(step.informational, key).toBe(true);
      expect(step.done, key).toBe(false);
      expect(step.href).toBe("/building/import");
    }
    expect(isSetupComplete(sections)).toBe(true);

    input.importBatches = [
      { kind: "units_owners", status: "committed" },
      { kind: "opening_accounts", status: "committed" },
      { kind: "transactions", status: "undone" },
    ];
    const after = buildSetupGuide(input).flatMap((s) => s.steps);
    expect(after.find((s) => s.key === "import_units")).toMatchObject({ done: true, detail: "Imported from a spreadsheet." });
    expect(after.find((s) => s.key === "import_opening")!.done).toBe(true);
    expect(after.find((s) => s.key === "import_history")!.done).toBe(false);
  });

  it("points an empty building at the import, and a contractor-less one too", () => {
    const sections = buildSetupGuide(freshSignup());
    expect(sections[0].steps.find((s) => s.key === "units")!.detail).toBe("Add your units, or import them from a spreadsheet.");
    expect(sections[3].steps.find((s) => s.key === "vendors")!.detail).toContain("Or import them from a spreadsheet.");
  });

  it("suggests a welcome note (informational) and ticks it once something is posted", () => {
    const input = fullyDone();
    let step = buildSetupGuide(input)[0].steps.find((s) => s.key === "first_announcement")!;
    expect(step).toMatchObject({ name: "Post a welcome note", href: "/announcements/new", done: false, informational: true });
    expect(isSetupComplete(buildSetupGuide(input))).toBe(true);
    input.announcementCount = 1;
    step = buildSetupGuide(input)[0].steps.find((s) => s.key === "first_announcement")!;
    expect(step.done).toBe(true);
  });

  it("offers turning on email from Walkup after the payment details, informational", () => {
    const input = fullyDone();
    const money = buildSetupGuide(input)[1].steps;
    const keys = money.map((s) => s.key);
    expect(keys.indexOf("email_sending")).toBe(keys.indexOf("dues_payment") + 1);
    let step = money.find((s) => s.key === "email_sending")!;
    expect(step).toMatchObject({ href: "/dues/email", done: false, informational: true, detail: "So reminders and statements can go out after you approve them." });
    input.emailSendingEnabled = true;
    step = buildSetupGuide(input)[1].steps.find((s) => s.key === "email_sending")!;
    expect(step).toMatchObject({ done: true, detail: "Sending is on." });
  });

  it("any invite counts for Invite them to sign in", () => {
    const input = freshSignup();
    expect(buildSetupGuide(input)[0].steps.find((s) => s.key === "invites")!.done).toBe(false);
    input.inviteCount = 1;
    expect(buildSetupGuide(input)[0].steps.find((s) => s.key === "invites")!.done).toBe(true);
  });

  it("uses no em dashes in the steps this build rewrote", () => {
    const input = freshSignup();
    const keys = [
      "insurance", "insurance_owner_summary", "upkeep_schedule", "emergency_info", "vendors",
      "board_contact", "import_units", "import_opening", "import_history", "first_announcement", "email_sending", "invites",
    ];
    for (const ai of [true, false]) {
      input.aiConfigured = ai;
      for (const st of buildSetupGuide(input).flatMap((s) => s.steps).filter((st) => keys.includes(st.key))) {
        expect(`${st.name} ${st.detail} ${st.instructions.join(" ")}`).not.toContain("—");
      }
    }
  });
});
