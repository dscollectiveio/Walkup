import { describe, expect, it } from "vitest";
import {
  actorWord, EVENT_KINDS, eventSentence, isDone, PRIORITY_LABEL, PRIORITY_RANK, STATUS_LABEL,
  type Actor, type EventKind, type TicketEventRow,
} from "@/lib/repairs/labels";

const TODAY = "2026-10-14";
const ev = (kind: EventKind, over: Partial<TicketEventRow> = {}): TicketEventRow => ({
  id: "e1", kind, from_value: null, to_value: null, data: {}, created_at: "2026-10-14T12:00:00Z", actor_person_id: null, ...over,
});
const BOARD: Actor = { kind: "board" };
const CY: Actor = { kind: "name", name: "Cy Board" };

describe("labels", () => {
  it("names statuses and urgency", () => {
    expect(STATUS_LABEL.resolved).toBe("Fixed");
    expect(PRIORITY_LABEL.urgent).toBe("Urgent");
    expect(PRIORITY_RANK.urgent).toBeLessThan(PRIORITY_RANK.low);
    expect(isDone("resolved")).toBe(true);
    expect(isDone("closed")).toBe(true);
    expect(isDone("waiting_on_contractor")).toBe(false);
    expect(EVENT_KINDS).toHaveLength(23);
  });

  it("words each actor", () => {
    expect(actorWord({ kind: "name", name: "Ada" })).toBe("Ada");
    expect(actorWord({ kind: "you" })).toBe("You");
    expect(actorWord(BOARD)).toBe("The board");
    expect(actorWord({ kind: "accountant" })).toBe("The building's accountant");
    expect(actorWord({ kind: "owner" })).toBe("Another owner");
    expect(actorWord({ kind: "unknown" })).toBe("Someone");
  });
});

describe("eventSentence", () => {
  it.each<[EventKind, Partial<TicketEventRow>, Actor, string]>([
    ["created", {}, { kind: "you" }, "You reported this."],
    ["status_changed", { to_value: "in_progress" }, BOARD, "The board marked it being worked on."],
    ["status_changed", { to_value: "resolved" }, CY, "Cy Board marked it fixed."],
    ["reopened", {}, { kind: "owner" }, "Another owner reopened it."],
    ["priority_changed", { to_value: "low" }, BOARD, 'The board changed the urgency to "Low".'],
    ["contractor_assigned", { data: { contractor_name: "Acme Plumbing" } }, BOARD, "The board chose Acme Plumbing for this job."],
    ["contractor_assigned", {}, BOARD, "The board chose a contractor for this job."],
    ["contractor_removed", {}, BOARD, "The board took the contractor off this."],
    ["assignee_changed", {}, CY, "Cy Board changed who on the board is following this."],
    ["scheduled", { to_value: "2026-10-22", data: { window: "8 to 10am" } }, BOARD, "Visit planned for Thu, Oct 22, 8 to 10am."],
    ["scheduled", { to_value: "2026-10-15", data: { window: null } }, BOARD, "Visit planned for tomorrow."],
    ["schedule_cleared", {}, BOARD, "The planned visit was cancelled."],
    ["due_changed", { to_value: "2027-01-05" }, CY, "Cy Board set the target date to Jan 5, 2027."],
    ["due_changed", { to_value: null }, CY, "Cy Board removed the target date."],
    ["trade_changed", { to_value: "hvac" }, BOARD, "Kind of work set to Heating & cooling."],
    ["details_edited", { data: { fields: ["title", "location_detail", "access_notes"] } }, BOARD, "The board updated the title, location and access notes."],
    ["details_edited", { data: { fields: ["unit"] } }, BOARD, "The board updated the unit."],
    ["estimate_changed", { to_value: "1250.00" }, BOARD, "Estimate set to $1,250."],
    ["estimate_changed", { to_value: null }, BOARD, "Estimate removed."],
    ["final_cost_recorded", { to_value: "980.50" }, BOARD, "Final cost recorded: $980.50."],
    ["expense_linked", {}, BOARD, "Linked to a payment in the books."],
    ["resolution_noted", {}, { kind: "accountant" }, "The building's accountant wrote what was done."],
    ["marked_duplicate", { data: { duplicate_of_reference: 7 } }, BOARD, "Closed as a duplicate of #7."],
    ["note_added", {}, { kind: "unknown" }, "Someone added a note."],
    ["photo_added", {}, { kind: "owner" }, "Another owner added a photo."],
    ["quote_requested", { data: { contractor_name: "Acme", by_phone: false } }, BOARD, "Quote requested from Acme."],
    ["quote_requested", { data: { contractor_name: "Acme", by_phone: true } }, CY, "Cy Board called Acme for a quote."],
    ["quote_received", { data: { contractor_name: "Acme", amount: "4250.00" } }, BOARD, "Quote received from Acme: $4,250."],
    ["quote_accepted", { data: { contractor_name: "Acme" } }, BOARD, "Acme's quote was accepted."],
    ["quote_declined", { data: { contractor_name: "Acme" } }, BOARD, "Acme's quote was not chosen."],
  ])("%s", (kind, over, actor, expected) => {
    expect(eventSentence(ev(kind, over), actor, TODAY)).toBe(expected);
  });

  it("has a sentence for every kind and actor, with no em dash", () => {
    const actors: Actor[] = [CY, { kind: "you" }, BOARD, { kind: "accountant" }, { kind: "owner" }, { kind: "unknown" }];
    for (const kind of EVENT_KINDS) {
      for (const a of actors) {
        const s = eventSentence(ev(kind, { to_value: "2026-10-20" }), a, TODAY);
        expect(s.length).toBeGreaterThan(5);
        expect(s).not.toMatch(/—|undefined|null/);
        expect(s.endsWith(".")).toBe(true);
      }
    }
  });
});
