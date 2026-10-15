// Deterministic emergency rules for problem reports (repairs-spec §4.3).
// Client-safe and model-free: the safety banner must never depend on an API
// key, a quota or a model's mood. The guidance copy is fixed text, shown
// verbatim, never model-written.

export const EMERGENCY_KINDS = ["gas", "carbon_monoxide", "fire", "flooding", "electrical",
  "no_heat", "sewage", "elevator_entrapment"] as const;
export type EmergencyKind = (typeof EMERGENCY_KINDS)[number];

export interface EmergencyRule {
  kind: EmergencyKind;
  /** Any match fires, subject to the suppressions in detectEmergency. */
  patterns: RegExp[];
  /** Tested on the matched text plus the 20 characters after it. */
  exclude?: RegExp;
  /** 1-12; the rule fires only in season. */
  season?: (month: number) => boolean;
  /** Suggested trade slug. */
  trade: string;
}

/** The row from building_emergency_info(). */
export interface BuildingEmergencyInfo {
  water_shutoff_location: string | null;
  gas_utility_name: string | null;
  gas_emergency_phone: string | null;
  electric_panel_location: string | null;
  electric_utility_name: string | null;
  electric_emergency_phone: string | null;
  elevator_company_name: string | null;
  elevator_company_phone: string | null;
  other_notes: string | null;
}

export interface EmergencyGuidance {
  headline: string;
  steps: string[];
  callLabel: string | null;
  callHref: string | null;
  /** Which board-entered facts to show, in order (one key per line; see buildingFactLines). */
  buildingFacts: (keyof BuildingEmergencyInfo)[];
}

export const EMERGENCY_KIND_LABEL: Record<EmergencyKind, string> = {
  gas: "Gas smell",
  carbon_monoxide: "Carbon monoxide alarm",
  fire: "Fire or smoke",
  flooding: "Flooding",
  electrical: "Sparking or burning",
  no_heat: "No heat",
  sewage: "Sewage backup",
  elevator_entrapment: "Someone stuck in the elevator",
};

// List order is severity order: the first rule that fires wins.
export const EMERGENCY_RULES: EmergencyRule[] = [
  {
    kind: "gas",
    patterns: [
      /\bsmell(s|ing|ed)? (of |like )?gas\b/i,
      /\bgas (smell|leak|odou?r)\b/i,
      /\b(smell|smells|smelled|smelling)\b.{0,25}\b(natural gas|propane|gas)\b/i,
      /\b(natural gas|propane)\b.{0,15}\b(smell|odou?r|leak|leaking)\b/i,
      // Rotten eggs near a water or kitchen appliance is usually not gas; erring safe elsewhere.
      /(?<!\b(dishwasher|hot water|tap water|shower|drain|sink|garbage|fridge)\b.{0,30})\brotten eggs?\b/i,
      /\bhiss(es|ing)? (from|near|at) (the )?(gas|stove|meter)\b/i,
    ],
    trade: "plumbing",
  },
  {
    kind: "carbon_monoxide",
    patterns: [
      /\bcarbon monoxide\b/i,
      /\bco (alarm|detector)s? (is |are )?(going off|sounding|alarming)\b/i,
      /\b(co|carbon monoxide) (alarm|detector)s? (is |are |has |have )?(went off|gone off|going off|sounding|alarming|beeping)\b/i,
    ],
    exclude: /batt|chirp|replace|expired|install/i,
    trade: "hvac",
  },
  {
    kind: "fire",
    patterns: [
      /\bfire\b(?! ?(extinguisher|alarm|escape|place|pit|door|drill|inspection|code|safety|department))/i,
      /(?<!pilot )\bflames?\b/i,
      /\bsmoke (is )?(coming|pouring|filling)\b/i,
      /\bon fire\b/i,
      /\bfire alarms? (is |are )?(going off|sounding)\b/i,
      /\b(i )?(see|saw|smell|smelled|smelling|there'?s|there is) (a lot of |some )?(smoke|something burning)\b/i,
      /\bsmoke (in|from|under|near|filling)\b/i,
    ],
    exclude: /last (week|month|year)|years? ago|previous/i,
    trade: "electrical",
  },
  {
    kind: "elevator_entrapment",
    patterns: [
      /\b(stuck|trapped) in (the )?elevator\b/i,
      /\belevator\b.{0,20}\b(stuck|trapped)\b/i,
    ],
    exclude: /stuck (on|at) (a |the )?floor|door stuck open/i,
    trade: "elevator",
  },
  {
    kind: "electrical",
    patterns: [
      /\bspark(s|ing|ed)?\b(?! ?plugs?)/i,
      /\b(outlet|switch|panel|breaker|wire|wiring)s? .{0,20}(smok|burn|melt|hot to the touch)/i,
      /\bburning smell\b/i,
      /\bexposed (live )?wires?\b/i,
      /\bwires? (is |are )?(hanging|dangling|loose|bare|sparking)\b/i,
    ],
    trade: "electrical",
  },
  {
    kind: "flooding",
    patterns: [
      /\bflood(ing|ed|s)?\b(?! ?lights?)/i,
      /\bburst (pipe|line)\b/i,
      /\bwater (is )?(pouring|gushing|rushing|coming through|coming in|dripping through)\b/i,
      /\bpipe (has )?burst\b/i,
      /\bwater\b.{0,30}\b(ceiling|light fixture)\b/i,
      /\b(pipe|line|water heater|supply line|hose)\b.{0,20}\b(broke|snapped|split|failed|burst)\b/i,
      /\bwater\b.{0,25}\b(all over|everywhere|running down)\b/i,
      /\bwater heater\b.{0,20}\b(leaking|leaks)\b/i,
    ],
    exclude: /\bstain(s|ed)?\b|\bmark(s)?\b|\bold\b|\bdried\b|\blast (week|month|year)\b/i,
    trade: "plumbing",
  },
  {
    kind: "sewage",
    patterns: [
      /\bsewage\b/i,
      /\bfloor drains?\b.{0,20}\bback(ing|ed)? ?up\b/i,
      /\bsewer (is )?back(ing|ed)? ?up\b/i,
      /\btoilet\b.{0,20}\boverflow/i,
      /\bback(ing|ed)? ?up\b.{0,20}\b(basement|floor drain)\b/i,
    ],
    trade: "sewer",
  },
  {
    kind: "no_heat",
    patterns: [
      /\bno heat\b/i,
      /\b(heat|heating|boiler|furnace) (is )?(not working|out|off|broken|down)\b/i,
      /\b(heat|heating|boiler|furnace)( system)? (has been |is |was )?(stopped working|died|quit|failed|is out|has been out|has failed)\b/i,
      /\bradiators?\b.{0,15}\bcold\b/i,
      /\bfreezing (inside|in (the|my) (unit|apartment|condo))\b/i,
    ],
    season: (m) => m >= 10 || m <= 4,
    trade: "hvac",
  },
];

export const EMERGENCY_GUIDANCE: Record<EmergencyKind, EmergencyGuidance> = {
  gas: {
    headline: "If you smell gas, leave first.",
    steps: [
      "Get everyone out of the building now.",
      "From outside, call 911 or the gas company's emergency number.",
      "Don't go back in until you are told it is safe.",
      "Then tell the board here.",
    ],
    callLabel: "Call 911 from outside",
    callHref: "tel:911",
    buildingFacts: ["gas_emergency_phone"],
  },
  carbon_monoxide: {
    headline: "Get to fresh air now.",
    steps: [
      "Get everyone outside, including pets.",
      "Call 911 from outside.",
      "Don't go back in until responders say it's safe.",
    ],
    callLabel: "Call 911 from outside",
    callHref: "tel:911",
    buildingFacts: ["gas_emergency_phone"],
  },
  fire: {
    headline: "If there's fire or smoke, get out and call 911.",
    steps: [
      "Leave the building and close doors behind you.",
      "Call 911 from outside.",
      "Don't use the elevator.",
    ],
    callLabel: "Call 911 from outside",
    callHref: "tel:911",
    buildingFacts: [],
  },
  elevator_entrapment: {
    headline: "If someone is stuck in the elevator, call 911.",
    steps: [
      "Call 911 and tell them someone is trapped.",
      "Stay in contact with the person if you can do it safely.",
      "Then call the elevator company and tell the board.",
    ],
    callLabel: "Call 911",
    callHref: "tel:911",
    buildingFacts: ["elevator_company_phone"],
  },
  electrical: {
    headline: "Stay away from sparking or burning equipment.",
    steps: [
      "Keep everyone away from it. Don't touch it.",
      "If there is smoke, flames or a burning smell, leave the building and call 911 from outside.",
      "Otherwise call an electrician now and tell the board.",
    ],
    callLabel: null,
    callHref: null,
    buildingFacts: ["electric_panel_location", "electric_emergency_phone"],
  },
  flooding: {
    headline: "Water coming in is urgent.",
    steps: [
      "Keep away from water near outlets, cords or the electrical panel.",
      "If anyone is in danger, call 911.",
      "Call a plumber now and tell the board. Take photos for the insurance claim.",
    ],
    callLabel: null,
    callHref: null,
    buildingFacts: ["water_shutoff_location"],
  },
  sewage: {
    headline: "Keep away from the backed-up water.",
    steps: [
      "Keep people and pets away from the backed-up water.",
      "Call a sewer or drain service now and tell the board. Take photos for the insurance claim.",
    ],
    callLabel: null,
    callHref: null,
    buildingFacts: [],
  },
  no_heat: {
    headline: "No heat in cold weather is urgent.",
    steps: [
      "Call the heating contractor today.",
      "If anyone is at risk from the cold, call 911.",
    ],
    callLabel: null,
    callHref: null,
    buildingFacts: [],
  },
};

const NEGATIONS = ["no ", "not ", "never ", "don't ", "doesn't ", "isn't ", "wasn't ", "no longer "];
const RESOLVED = /\b(gone|stopped|fixed|resolved|repaired|under control|went away)\b/;

/** Lowercase, straighten quotes, collapse whitespace. */
function normalise(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** A negation word starting within the 12 characters before `index`, as a whole word ("casino " is not "no "). */
function negatedBefore(t: string, index: number): boolean {
  const start = Math.max(0, index - 12);
  const window = t.slice(start, index);
  return NEGATIONS.some((n) => {
    for (let at = window.indexOf(n); at !== -1; at = window.indexOf(n, at + 1)) {
      const prev = t[start + at - 1];
      if (prev === undefined || !/[a-z']/.test(prev)) return true;
    }
    return false;
  });
}

function suppressed(t: string, index: number, matched: string, rule: EmergencyRule): boolean {
  if (negatedBefore(t, index)) return true;
  const after = t.slice(index + matched.length, index + matched.length + 20);
  if (RESOLVED.test(after)) return true;
  if (rule.exclude && rule.exclude.test(matched + after)) return true;
  return false;
}

/** The first matching rule in list order (which is severity order), or null. */
export function detectEmergency(text: string, today: Date): { kind: EmergencyKind; trade: string; matched: string } | null {
  const t = normalise(text);
  if (!t) return null;
  const month = today.getMonth() + 1;
  for (const rule of EMERGENCY_RULES) {
    if (rule.season && !rule.season(month)) continue;
    for (const pattern of rule.patterns) {
      const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
      for (const m of t.matchAll(global)) {
        if (m[0] && !suppressed(t, m.index ?? 0, m[0], rule)) {
          return { kind: rule.kind, trade: rule.trade, matched: m[0] };
        }
      }
    }
  }
  return null;
}

const filled = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);
const telHref = (phone: string): string | null => {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 3 ? `tel:${digits}` : null;
};

/**
 * "In your building:" lines for a kind, only for facts the board entered.
 * Never fills a gap: a phone line without a number is left out.
 */
export function buildingFactLines(kind: EmergencyKind, info: BuildingEmergencyInfo | null): { label: string; text: string; tel: string | null }[] {
  if (!info) return [];
  const out: { label: string; text: string; tel: string | null }[] = [];
  const phoneLine = (label: string, name: string | null, phone: string | null) => {
    const number = filled(phone);
    if (!number) return;
    const who = filled(name);
    out.push({ label, text: who ? `${who} ${number}` : number, tel: telHref(number) });
  };
  for (const key of EMERGENCY_GUIDANCE[kind].buildingFacts) {
    switch (key) {
      case "water_shutoff_location": {
        const v = filled(info.water_shutoff_location);
        if (v) out.push({ label: "Main water shut-off", text: v, tel: null });
        break;
      }
      case "electric_panel_location": {
        const v = filled(info.electric_panel_location);
        if (v) out.push({ label: "Electric panel", text: v, tel: null });
        break;
      }
      case "gas_emergency_phone":
      case "gas_utility_name":
        phoneLine("Gas company emergency line", info.gas_utility_name, info.gas_emergency_phone);
        break;
      case "electric_emergency_phone":
      case "electric_utility_name":
        phoneLine("Power company emergency line", info.electric_utility_name, info.electric_emergency_phone);
        break;
      case "elevator_company_phone":
      case "elevator_company_name":
        phoneLine("Elevator company", info.elevator_company_name, info.elevator_company_phone);
        break;
      default:
        break;
    }
  }
  return out;
}
