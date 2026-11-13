// Common U.S. banks for the bank-name autofill. A colored monogram stands in for a logo:
// no image is fetched from anyone, so opening the form tells no outside service anything.

export interface BankChoice {
  name: string;
  /** Two letters shown in the badge. */
  mark: string;
  /** Badge background. Dark enough for white text. */
  color: string;
}

export const BANKS: BankChoice[] = [
  { name: "Chase", mark: "Ch", color: "#117aca" },
  { name: "Bank of America", mark: "BA", color: "#c8102e" },
  { name: "Wells Fargo", mark: "WF", color: "#b31b1b" },
  { name: "Citibank", mark: "Ci", color: "#1f4e9c" },
  { name: "U.S. Bank", mark: "US", color: "#0c2074" },
  { name: "PNC Bank", mark: "PN", color: "#c95a00" },
  { name: "Truist", mark: "Tr", color: "#5b2a86" },
  { name: "Capital One", mark: "CO", color: "#0b3b60" },
  { name: "TD Bank", mark: "TD", color: "#2a7f2a" },
  { name: "BMO", mark: "BM", color: "#0075be" },
  { name: "Fifth Third Bank", mark: "5/3", color: "#00644b" },
  { name: "Huntington", mark: "Hu", color: "#2d6e3e" },
  { name: "Regions Bank", mark: "Re", color: "#4a7a1a" },
  { name: "KeyBank", mark: "Ke", color: "#a3262a" },
  { name: "Citizens", mark: "Cz", color: "#0a7d6d" },
  { name: "M&T Bank", mark: "MT", color: "#00669d" },
  { name: "Associated Bank", mark: "As", color: "#00629b" },
  { name: "Old National Bank", mark: "ON", color: "#0f5a45" },
  { name: "First Midwest Bank", mark: "FM", color: "#8a2432" },
  { name: "Wintrust", mark: "Wi", color: "#003b71" },
  { name: "Northern Trust", mark: "NT", color: "#00548e" },
  { name: "Navy Federal Credit Union", mark: "NF", color: "#0b2a5b" },
  { name: "Ally Bank", mark: "Al", color: "#6b2d8b" },
  { name: "Charles Schwab Bank", mark: "Sc", color: "#00689d" },
];

/** What to suggest for the text typed so far. Empty text suggests the first six, the biggest. */
export function bankSuggestions(typed: string, limit = 6): BankChoice[] {
  const q = typed.trim().toLowerCase();
  if (!q) return BANKS.slice(0, limit);
  const starts = BANKS.filter((b) => b.name.toLowerCase().startsWith(q));
  const contains = BANKS.filter((b) => !starts.includes(b) && b.name.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, limit);
}

export function bankMark(name: string): BankChoice | null {
  const q = name.trim().toLowerCase();
  return BANKS.find((b) => b.name.toLowerCase() === q) ?? null;
}
