/** Where a unit lives in the app: its row in Units and people on Building & Owners, opened. */
export function unitHref(unitId: string): string {
  return `/building?unit=${unitId}#units-and-people`;
}
