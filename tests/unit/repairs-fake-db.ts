/**
 * A small in-memory stand-in for the Supabase client, for the Repairs server
 * action tests. It keeps rows per table, applies the filters the actions use,
 * records every write and RPC, and lets a test make the next write to a table
 * fail with a Postgres error code. It is not RLS: tests that need "the
 * database refused" set an error.
 */

type Row = Record<string, unknown>;
type PgError = { code?: string; message?: string; hint?: string };
type Op = "select" | "insert" | "update" | "delete" | "upsert";

export class FakeDb {
  tables: Record<string, Row[]> = {};
  writes: { table: string; op: Op; payload: unknown }[] = [];
  rpcs: { name: string; args: Record<string, unknown> }[] = [];
  rpcHandlers: Record<string, (args: Record<string, unknown>) => { data: unknown; error: PgError | null }> = {};
  failures: Record<string, PgError[]> = {};
  user: { id: string; email?: string } | null = { id: "user-1", email: "board@example.com" };
  storage: Record<string, Blob> = {};
  private n = 0;

  id(): string {
    this.n += 1;
    return `00000000-0000-4000-8000-${String(this.n).padStart(12, "0")}`;
  }

  /** The next `op` on `table` returns this error instead of running. */
  fail(table: string, op: Op, error: PgError) {
    (this.failures[`${table}:${op}`] ??= []).push(error);
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  get client() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const db = this;
    return {
      auth: { getUser: async () => ({ data: { user: db.user }, error: null }) },
      rpc: async (name: string, args: Record<string, unknown> = {}) => {
        db.rpcs.push({ name, args });
        const h = db.rpcHandlers[name];
        return h ? h(args) : { data: null, error: null };
      },
      from: (table: string) => db.query(table),
      storage: {
        from: () => ({
          download: async (path: string) =>
            db.storage[path] ? { data: db.storage[path], error: null } : { data: null, error: { message: "not found" } },
        }),
      },
    };
  }

  query(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let op: Op = "select";
    let payload: Row | Row[] | null = null;
    let head = false;
    let limit: number | null = null;
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    const field = (r: Row, c: string) => r[c.split("::")[0]];

    const run = (): { data: unknown; error: PgError | null; count?: number } => {
      const queued = this.failures[`${table}:${op}`];
      if (queued?.length) return { data: null, error: queued.shift()! };
      const all = this.rows(table);
      const matching = () => all.filter((r) => filters.every((f) => f(r)));
      if (op === "insert" || op === "upsert") {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        this.writes.push({ table, op, payload });
        const out: Row[] = [];
        for (const p of list) {
          if (op === "upsert" && upsertOpts.onConflict) {
            const keys = upsertOpts.onConflict.split(",");
            const existing = all.find((r) => keys.every((k) => r[k] === p[k]));
            if (existing) {
              if (!upsertOpts.ignoreDuplicates) Object.assign(existing, p);
              out.push(existing);
              continue;
            }
          }
          const row = { id: this.id(), ...p };
          all.push(row);
          out.push(row);
        }
        return { data: out, error: null };
      }
      if (op === "update") {
        this.writes.push({ table, op, payload });
        const hit = matching();
        for (const r of hit) Object.assign(r, payload);
        return { data: hit, error: null };
      }
      if (op === "delete") {
        const hit = matching();
        this.writes.push({ table, op, payload: hit.map((r) => r.id) });
        this.tables[table] = all.filter((r) => !hit.includes(r));
        return { data: hit, error: null };
      }
      const hit = matching();
      if (head) return { data: null, error: null, count: hit.length };
      return { data: limit === null ? hit : hit.slice(0, limit), error: null };
    };

    const b = {
      select: (_cols?: string, o?: { count?: string; head?: boolean }) => {
        head = Boolean(o?.head);
        return b;
      },
      insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), b),
      upsert: (p: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) => (
        (op = "upsert"), (payload = p), (upsertOpts = o ?? {}), b
      ),
      update: (p: Row) => ((op = "update"), (payload = p), b),
      delete: () => ((op = "delete"), b),
      eq: (c: string, v: unknown) => (filters.push((r) => field(r, c) === v), b),
      neq: (c: string, v: unknown) => (filters.push((r) => field(r, c) !== v), b),
      is: (c: string, v: unknown) => (filters.push((r) => (field(r, c) ?? null) === v), b),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(field(r, c))), b),
      gte: (c: string, v: string) => (filters.push((r) => String(field(r, c) ?? "") >= v), b),
      lte: (c: string, v: string) => (filters.push((r) => String(field(r, c) ?? "") <= v), b),
      lt: (c: string, v: string) => (filters.push((r) => String(field(r, c) ?? "") < v), b),
      ilike: (c: string, v: string) => (
        filters.push((r) => String(field(r, c) ?? "").toLowerCase() === v.replace(/\\(.)/g, "$1").toLowerCase()), b
      ),
      not: () => b,
      or: () => b,
      overlaps: () => b,
      order: () => b,
      limit: (n: number) => ((limit = n), b),
      maybeSingle: async () => {
        const r = run();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      single: async () => {
        const r = run();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return b;
  }
}
