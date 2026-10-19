/**
 * Adds a unit to an address line: "2158 N Damen Ave, Chicago, IL 60647" with
 * "3" becomes "2158 N Damen Ave Unit 3, Chicago, IL 60647". A unit that already
 * says what it is ("Apt 3", "#3", "Suite 200") is used as typed.
 */
export function withUnit(address: string, unit: string): string {
  const u = unit.trim();
  const a = address.trim();
  if (u === "" || a === "") return a;
  const label = /^(apt|apartment|unit|suite|ste|fl|floor|rm|room|bldg|building|#)/i.test(u) ? u : `Unit ${u}`;
  const comma = a.indexOf(",");
  return comma === -1 ? `${a} ${label}` : `${a.slice(0, comma).trimEnd()} ${label}${a.slice(comma)}`;
}
