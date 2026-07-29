import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * Database access. Server-only — importing this from a client component is a
 * build error, which is the point.
 *
 * Every query runs as the `authenticated` role with request.jwt.claim.sub set,
 * so the RLS policies in 0002 apply exactly as they will in production. There
 * is no privileged path here: a page that forgets to scope its query still
 * cannot read another association, because the database will not let it.
 *
 * In development this points at the PGlite socket server (npm run dev:db). In
 * production it points at Supabase. The policies are identical; what differs
 * is where auth.uid() comes from — see docs/DECISIONS.md #15.
 */

declare global {
  // eslint-disable-next-line no-var
  var __walkupPool: Pool | undefined;
}

function pool(): Pool {
  if (!globalThis.__walkupPool) {
    globalThis.__walkupPool = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/postgres",
      // The local PGlite socket server serves ONE connection at a time — it is
      // a single-threaded WASM database, not a real server. A larger pool
      // resets the socket mid-query. Against Supabase this should rise.
      max: Number(process.env.DATABASE_POOL_MAX ?? 1),
    });
  }
  return globalThis.__walkupPool;
}

/**
 * Run queries as a given user, with RLS in force.
 *
 * set_config(..., true) makes the setting local to the transaction, so a
 * pooled connection cannot leak one user's identity into the next request's
 * queries. That is not a detail — without the `true`, an idle connection would
 * carry the previous caller's identity and RLS would authorize the wrong
 * person.
 */
export async function asUser<T>(
  userId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [
      userId ?? "",
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function queryAs<T extends QueryResultRow = QueryResultRow>(
  userId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return asUser(userId, async (client) => {
    const { rows } = await client.query<T>(sql, params);
    return rows;
  });
}
