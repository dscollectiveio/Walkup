import { describe, expect, it } from "vitest";
import { detectEmergency, EMERGENCY_GUIDANCE, EMERGENCY_KINDS } from "@/lib/repairs/emergency";

// Phrase lists from docs/security/REVIEW-3-copy-and-product.md (finding 3).
const WINTER = new Date(2026, 0, 15, 12);

const SHOULD_FIRE: string[] = [
 "I smell gas in the hallway","There's a strong gas odor near the meter","smells like gas in my unit","Gas leak in basement","The hallway smells of gas","I can smell natural gas","gas smell by the water heater","Rotten egg smell in the laundry room","Smell of propane in garage","The whole building smells like natural gas",
 "CO detector is beeping nonstop and I feel dizzy","carbon monoxide alarm went off","CO alarm went off last night","carbon monoxide detector is sounding",
 "There is a fire in the garage","Smoke is coming from the basement","I see smoke in the stairwell","Building on fire","Smoke coming out of the outlet","Flames in the dumpster room","dryer fire","the kitchen caught fire","I see smoke","smoke detector going off and I smell smoke","Burning smell from the electrical room","Smell something burning in hall",
 "Someone is stuck in the elevator","The elevator is stuck between floors with a person inside","People trapped in elevator","Elevator stopped and I'm stuck inside",
 "Outlet is sparking","Sparks coming from the panel","Wire is hanging loose and exposed","outlet smoking","Breaker box is hot to the touch and buzzing","light switch is hot and smells burnt",
 "Pipe burst in unit 2","Water pouring from ceiling","A pipe broke and water is everywhere","Basement flooded","Water coming through the ceiling of unit 3","Water gushing from the water heater","Active leak flooding the hallway","Water heater leaking all over floor","Water running down the walls from upstairs",
 "Sewage in the basement","Sewer backing up into unit 1","Toilet overflowing","Raw sewage coming up the floor drain","Floor drain is backing up","Toilets are backed up and sewage smell","Sewer backup in garden unit",
 "No heat in the building","The boiler is not working","Furnace stopped working","There is no heat in my unit and it's 10 degrees","radiators are cold","Heat has been out since yesterday","Boiler died","heat is broken","no hot water and no heat","Heating system failed"
];

const SHOULD_NOT_FIRE: string[] = [
 "Fire extinguisher inspection due","Replace batteries in smoke detector","Smoke detector chirping","CO detector battery is chirping","Fire alarm test scheduled","Fire door doesn't close properly","No smell of gas, just checking pilot light","Gas leak was fixed last week","Water stain on ceiling from old leak","Ceiling has old water marks","Spark plug on mower","Paint the fire escape","Fireplace damper stuck","Annual boiler inspection","Elevator door stuck open on 2nd floor","Flood lights are out in the parking lot","Pilot flame keeps going out on stove","Heat is too hot in unit 3","Garbage chute smells","Dishwasher smells like rotten eggs"
];

describe("emergency rules: phrase coverage", () => {
  it("has the expected list sizes", () => {
    expect(SHOULD_FIRE).toHaveLength(62);
    expect(SHOULD_NOT_FIRE).toHaveLength(20);
  });
  it.each(SHOULD_FIRE)("fires: %s", (text) => {
    expect(detectEmergency(text, WINTER)).not.toBeNull();
  });
  it.each(SHOULD_NOT_FIRE)("does not fire: %s", (text) => {
    expect(detectEmergency(text, WINTER)).toBeNull();
  });
});

describe("emergency guidance: no steps beyond the safe set", () => {
  const ALL = EMERGENCY_KINDS.map((k) => EMERGENCY_GUIDANCE[k].steps.join(" ") + " " + EMERGENCY_GUIDANCE[k].headline).join(" ");
  it("gives no breaker, valve, shut-off or freezing instructions", () => {
    expect(ALL).not.toMatch(/breaker|valve|shut off|switch off|switch lights|cabinet|within hours|run water|flush/i);
  });
});
