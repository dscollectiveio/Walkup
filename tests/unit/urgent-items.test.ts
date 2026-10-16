import { describe, expect, it } from "vitest";
import { urgentItems } from "@/lib/home/urgent-items";

const today = new Date("2026-10-10T12:00:00Z");
const quiet = {
  booksVisible: true,
  booksBalance: true,
  aging: [],
  vendorsMissingW9: 0,
  nec1099Due: new Date("2027-01-31T00:00:00Z"),
  insuranceRenewal: null,
  bankConnected: true,
  today,
};

const unit = (label: string, d30: number, d60 = 0, d60p = 0) => ({
  label,
  days_1_30: String(d30),
  days_31_60: String(d60),
  days_60_plus: String(d60p),
  total_owed: String(d30 + d60 + d60p),
});

describe("urgentItems — Worth a minute today", () => {
  it("gives one unit behind its own item", () => {
    const items = urgentItems({ ...quiet, aging: [unit("Unit 2", 0, 450)] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "delinquent", tone: "bad", title: "Unit 2 is over a month behind: $450" });
  });

  it("words lateness by its aging bucket, never rounding a few days up to a month", () => {
    expect(urgentItems({ ...quiet, aging: [unit("Unit 1", 200)] })[0].title).toBe("Unit 1 is past due: $200");
    expect(urgentItems({ ...quiet, aging: [unit("Unit 3", 0, 0, 900)] })[0].title).toBe("Unit 3 is 2+ months behind: $900");
  });

  it("groups several units behind into one item, biggest first", () => {
    const items = urgentItems({
      ...quiet,
      aging: [unit("Unit 1", 300), unit("Unit 4", 0, 0, 1200), unit("Unit 6", 150), unit("Unit 3", 0, 0, 0)],
    });
    expect(items.filter((i) => i.key === "delinquent")).toHaveLength(1);
    expect(items[0].title).toBe("3 units are behind on dues: $1,650");
    expect(items[0].why.startsWith("Unit 4, Unit 1 and Unit 6.")).toBe(true);
    expect(items[0].action.label).toBe("Open Collections");
  });

  it("sends one unit behind to Collections too", () => {
    const items = urgentItems({ ...quiet, aging: [unit("Unit 2", 0, 450)] });
    expect(items[0].action).toEqual({ label: "Open Collections", href: "/delinquency" });
  });

  it("raises nothing about email when it is healthy or not passed (owners and members never see it)", () => {
    expect(urgentItems({ ...quiet })).toHaveLength(0);
    expect(urgentItems({ ...quiet, email: { keyRejected: false, failed: 0, bounced: 0 } })).toHaveLength(0);
  });

  it("tells a board admin when the email service rejected Walkup's key, ahead of the other email items", () => {
    const items = urgentItems({ ...quiet, email: { keyRejected: true, failed: 2, bounced: 1 } });
    expect(items.map((i) => i.key)).toEqual(["email_key_rejected", "email_failed", "email_bounced"]);
    expect(items[0]).toMatchObject({
      severity: 1,
      tone: "bad",
      title: "Walkup couldn't send your last email",
      why: "Walkup's email service needs attention. Reminders are paused. Email support@walkuphoa.com.",
      action: { label: "Check", href: "/dues/email" },
    });
    expect(items[1]).toMatchObject({
      severity: 2,
      tone: "warning",
      title: "2 emails failed to send in the last 7 days",
      why: "Check the address or try again.",
      action: { label: "See the log", href: "/dues/email#log" },
    });
    expect(items[2]).toMatchObject({
      title: "1 owner didn't get an email (bounced)",
      why: "Their address may be wrong. Fix it so reminders reach them.",
      action: { label: "See who", href: "/dues/email" },
    });
  });

  it("names the first two and counts the rest when many units are behind", () => {
    const items = urgentItems({
      ...quiet,
      aging: [unit("A", 500), unit("B", 400), unit("C", 300), unit("D", 200)],
    });
    expect(items[0].why.startsWith("A, B and 2 more.")).toBe(true);
  });

  it("returns every item, most important first, instead of capping at three", () => {
    const items = urgentItems({
      ...quiet,
      booksBalance: false,
      aging: [unit("Unit 1", 300)],
      vendorsMissingW9: 2,
      nec1099Due: new Date("2027-01-31T00:00:00Z"),
      insuranceRenewal: { daysToEnd: 22, withinReminder: true, policy: { coverage: "property" } },
      bankConnected: false,
      budgetOver: [{ name: "Repairs", overCents: 120000 }],
    });
    expect(items.map((i) => i.key)).toEqual(["books", "delinquent", "w9", "insurance", "budget", "bank"]);
  });

  it("uses no em dashes in anything it shows", () => {
    const items = urgentItems({
      ...quiet,
      booksBalance: false,
      aging: [unit("Unit 1", 300), unit("Unit 2", 50)],
      vendorsMissingW9: 1,
      insuranceRenewal: { daysToEnd: 10, withinReminder: true, policy: { coverage: "directors_officers" } },
      insuranceBanners: [
        { key: "read:1", tone: "attention", text: "Walkup finished reading dec.pdf. Review and save 2 policies.", href: "/insurance/import/1", action: "Review" },
        { key: "read:2", tone: "bad", text: "Walkup couldn't read scan.pdf.", href: "/insurance/import/2", action: "See why" },
        { key: "owner_requests", tone: "attention", text: "2 owners ask for proof of the building's insurance.", href: "/insurance", action: "Prepare the certificate request" },
        { key: "owner_summary", tone: "attention", text: "The owner summary describes a policy you archived. Update it.", href: "/insurance/owner-summary", action: "Update the owner summary" },
      ],
      repairsEmergency: { count: 2, firstTitle: "Gas smell in the hall", firstId: "t1" },
      repairsPossibleEmergency: 1,
      repairsUrgent: 3,
      repairsOverdue: 1,
      upkeepOverdue: { count: 1, firstName: "Boiler service" },
      contractorPaperwork: { expired: 2, firstName: "Ace Plumbing" },
      finishedRuns: [
        { key: "market:agencies", title: "Agency search finished: 4 found", why: "It ran in the background after you left the page.", href: "/insurance?view=market", action: "See them", failed: false },
      ],
      bankConnected: false,
      budgetOver: [
        { name: "Repairs", overCents: 120000 },
        { name: "Utilities", overCents: 5000 },
      ],
    });
    for (const i of items) expect(`${i.title} ${i.why} ${i.action.label}`).not.toContain("—");
  });

  describe("insurance renewal (insurance-spec §12 I-2)", () => {
    it("follows the policy's own lead time, not a fixed 60 days", () => {
      expect(urgentItems({ ...quiet, insuranceRenewal: { daysToEnd: 45, withinReminder: false, policy: { coverage: "property" } } })).toEqual([]);
      const [item] = urgentItems({ ...quiet, insuranceRenewal: { daysToEnd: 90, withinReminder: true, policy: { coverage: "property" } } });
      expect(item).toMatchObject({
        key: "insurance",
        title: "Master policy renews in 90 days",
        action: { label: "Get quotes", href: "/insurance?view=quotes&new=1" },
      });
    });

    it("names the coverage by its short label", () => {
      const [item] = urgentItems({ ...quiet, insuranceRenewal: { daysToEnd: 1, withinReminder: true, policy: { coverage: "directors_officers" } } });
      expect(item.title).toBe("D&O renews in 1 day");
    });

    it("lists Insurance's own to-dos, a failed read as needing attention", () => {
      const items = urgentItems({
        ...quiet,
        insuranceBanners: [
          { key: "read:a", tone: "attention", text: "Walkup finished reading dec.pdf. Review and save 1 policy.", href: "/insurance/import/a", action: "Review" },
          { key: "read:b", tone: "bad", text: "Walkup couldn't read scan.pdf.", href: "/insurance/import/b", action: "See why" },
        ],
      });
      expect(items.map((i) => [i.key, i.tone, i.action.href])).toEqual([
        ["insurance_task", "bad", "/insurance/import/b"],
        ["insurance_task", "warning", "/insurance/import/a"],
      ]);
    });
  });

  describe("repairs and upkeep (repairs-spec §18.2)", () => {
    it("puts an emergency first and links straight to a single one", () => {
      const items = urgentItems({
        ...quiet,
        booksBalance: false,
        repairsEmergency: { count: 1, firstTitle: "Water pouring through the ceiling", firstId: "abc" },
      });
      expect(items[0]).toMatchObject({
        key: "repairs_emergency",
        tone: "bad",
        title: "1 emergency problem open",
        why: "Reported as an emergency: Water pouring through the ceiling. Check someone is on it.",
        action: { label: "Open it", href: "/maintenance/abc" },
      });
    });

    it("sends several emergencies to Today", () => {
      const [item] = urgentItems({ ...quiet, repairsEmergency: { count: 2, firstTitle: "Gas smell", firstId: "x" } });
      expect(item).toMatchObject({ title: "2 emergency problems open", action: { href: "/repairs?view=today" } });
    });

    it("words each repairs item from the spec", () => {
      const items = urgentItems({
        ...quiet,
        repairsPossibleEmergency: 2,
        repairsUrgent: 1,
        repairsOverdue: 3,
        upkeepOverdue: { count: 1, firstName: "Gutter cleaning" },
        contractorPaperwork: { expired: 1, firstName: "Ace Plumbing" },
      });
      const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
      expect(byKey.repairs_possible_emergency).toMatchObject({ title: "2 reports may be an emergency", tone: "warning", action: { href: "/repairs?view=today" } });
      expect(byKey.repairs_urgent).toMatchObject({ title: "1 urgent problem open", tone: "bad", action: { href: "/repairs?view=problems&priority=urgent" } });
      expect(byKey.repairs_overdue).toMatchObject({ title: "3 problems past their target date", action: { href: "/repairs?view=problems&sort=due" } });
      expect(byKey.upkeep_overdue).toMatchObject({ title: "Gutter cleaning is overdue", action: { label: "Open upkeep", href: "/repairs?view=upkeep&show=overdue" } });
      expect(byKey.contractor_paperwork).toMatchObject({
        title: "Ace Plumbing's insurance certificate has expired",
        action: { label: "Ask for certificates", href: "/repairs?view=contractors" },
      });
    });

    it("says license when the one expired paper is a license", () => {
      const [item] = urgentItems({ ...quiet, contractorPaperwork: { expired: 1, firstName: "Bright Electric", firstKind: "license" } });
      expect(item.title).toBe("Bright Electric's license has expired");
    });

    it("counts several overdue jobs and contractors instead of naming one", () => {
      const items = urgentItems({ ...quiet, upkeepOverdue: { count: 3, firstName: "Boiler" }, contractorPaperwork: { expired: 2, firstName: "Ace" } });
      expect(items.map((i) => i.title)).toEqual(["3 upkeep jobs are overdue", "2 contractors have expired paperwork"]);
    });

    it("sends the W-9 nudge to the contractor directory", () => {
      const [item] = urgentItems({ ...quiet, vendorsMissingW9: 1 });
      expect(item.action.href).toBe("/repairs?view=contractors");
    });
  });
});
