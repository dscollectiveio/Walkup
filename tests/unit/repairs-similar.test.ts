import { describe, expect, it } from "vitest";
import { jaccard, similarOpenTickets, titleTokens } from "@/lib/repairs/similar";

const UNIT1 = "11111111-1111-4111-8111-111111111111";
const UNIT2 = "22222222-2222-4222-8222-222222222222";

const OPEN = [
  { id: "a", reference: 1, title: "Leak in the back stairwell ceiling", unit_id: null },
  { id: "b", reference: 2, title: "Back stairwell light is out", unit_id: null },
  { id: "c", reference: 3, title: "Ceiling leak in the bathroom", unit_id: UNIT1 },
  { id: "d", reference: 4, title: "Front door buzzer broken", unit_id: null },
  { id: "e", reference: 5, title: "Stairwell ceiling leak again", unit_id: null },
  { id: "f", reference: 6, title: "Leak at stairwell ceiling", unit_id: null },
  { id: "g", reference: 7, title: "Stairwell ceiling leak, back", unit_id: null },
];

describe("titleTokens", () => {
  it("lowercases, keeps letters, drops stop words and short words", () => {
    expect([...titleTokens("The leak in MY ceiling, #2 at 3pm!")]).toEqual(["leak", "ceiling"]);
    expect(jaccard(titleTokens("leak ceiling"), titleTokens("ceiling leak"))).toBe(1);
    expect(jaccard(new Set(), titleTokens("leak"))).toBe(0);
  });
});

describe("similarOpenTickets", () => {
  it("matches the same problem in the same place, closest first, at most 3", () => {
    const hits = similarOpenTickets({ title: "Stairwell ceiling leak", where: "shared" }, OPEN);
    expect(hits).toHaveLength(3);
    expect(hits[0].id).toBe("f");
    expect(hits.map((h) => h.id)).not.toContain("c"); // a unit ticket
    expect(hits.map((h) => h.id)).not.toContain("d");
    expect(hits[0]).toEqual({ id: "f", reference: 6, title: "Leak at stairwell ceiling" });
  });

  it("keeps shared areas and units apart", () => {
    expect(similarOpenTickets({ title: "Bathroom ceiling leak", where: UNIT1 }, OPEN).map((h) => h.id)).toEqual(["c"]);
    expect(similarOpenTickets({ title: "Bathroom ceiling leak", where: UNIT2 }, OPEN)).toEqual([]);
  });

  it("finds nothing for an unrelated title or an empty one", () => {
    expect(similarOpenTickets({ title: "Snow on the sidewalk", where: "shared" }, OPEN)).toEqual([]);
    expect(similarOpenTickets({ title: "a an the", where: "shared" }, OPEN)).toEqual([]);
    // One shared word out of five is below 0.34.
    expect(similarOpenTickets({ title: "Front stairs railing loose", where: "shared" }, OPEN)).toEqual([]);
  });
});
