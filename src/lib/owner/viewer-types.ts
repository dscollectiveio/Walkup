/** Shapes shared by server and presentational code; no server-only imports. */
export interface BoardContact {
  name: string | null;
  email: string | null;
  phone: string | null;
}
