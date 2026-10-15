// "Yes" guesses for the facts form from the board's own upkeep list
// (insurance-spec §6.10). A guess is never saved by itself: the form
// pre-selects "Yes" and says where it came from; saving the form confirms it.
// Pure.

import type { BuildingFacts } from "./facts";

export interface FactGuess {
  key: "has_boiler" | "has_elevator" | "has_sprinklers";
  value: true;
  /** The upkeep task's name. */
  from: string;
}

const RULES: { key: FactGuess["key"]; re: RegExp }[] = [
  { key: "has_boiler", re: /boiler|steam heat|central heat/i },
  { key: "has_elevator", re: /elevator|lift inspection/i },
  { key: "has_sprinklers", re: /sprinkler|fire suppression/i },
];

/**
 * Only "yes" guesses, only for facts that are still null, from the board's
 * own upkeep_tasks.name (active tasks). The first matching task names the
 * source.
 */
export function factGuesses(facts: BuildingFacts | null, upkeepTaskNames: string[]): FactGuess[] {
  const out: FactGuess[] = [];
  for (const { key, re } of RULES) {
    const current = facts ? facts[key] : null;
    if (current !== null && current !== undefined) continue;
    const from = upkeepTaskNames.find((n) => re.test(n));
    if (from) out.push({ key, value: true, from: from.trim() });
  }
  return out;
}

/** The line under a guessed question. */
export function guessNote(g: FactGuess): string {
  return `Walkup guessed this from your upkeep list ("${g.from}"). Confirm.`;
}
