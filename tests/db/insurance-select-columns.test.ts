import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "./harness";

/**
 * Every PostgREST query the insurance code writes names real columns
 * (insurance-spec §13: the self-check). tsc can't see inside the select
 * strings, and a typo there only shows up as a runtime 400 on a page. This
 * reads `src/app/insurance/**` and `src/lib/insurance/**`, finds each
 * `.from("table")` chain, and checks the select list (including `::text`
 * casts, aliases and embedded resources), the filter and order columns, and
 * the keys of literal insert/update objects against the migrated schema.
 */

const ROOTS = ["src/app/insurance", "src/lib/insurance", "src/app/admin/partners"];

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Split on commas that aren't inside parentheses. */
function topLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

it("the parser sees a wrong column", () => {
  const problems: Problem[] = [];
  columns.set("t", new Set(["a", "b"]));
  checkSelect("a, b::text, x:a::text, c, e:t(a, z)", "t", "f", problems);
  columns.delete("t");
  expect(problems.map((p) => p.column)).toEqual(["c", "z"]);
});

interface Problem {
  file: string;
  table: string;
  column: string;
}

let db: PGlite;
const columns = new Map<string, Set<string>>();

beforeAll(async () => {
  db = await freshDb();
  const res = await db.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
  );
  for (const r of res.rows) {
    if (!columns.has(r.table_name)) columns.set(r.table_name, new Set());
    columns.get(r.table_name)!.add(r.column_name);
  }
});

afterAll(async () => {
  await db?.close();
});

function checkSelect(list: string, table: string, file: string, problems: Problem[]) {
  const cols = columns.get(table);
  if (!cols) return;
  for (const raw of topLevel(list)) {
    if (raw === "*" || raw.includes("${")) continue;
    let item = raw.replace(/^\.\.\./, "");
    const embed = item.match(/^(?:[a-z_][a-z0-9_]*:)?([a-z_][a-z0-9_]*)(?:![a-z0-9_]+)?(?:!inner)?\(([\s\S]*)\)$/i);
    if (embed) {
      const [, name, inner] = embed;
      if (columns.has(name)) checkSelect(inner, name, file, problems);
      else if (!cols.has(name)) problems.push({ file, table, column: `${name}(…)` });
      continue;
    }
    item = item.replace(/::[a-z]+$/i, "").replace(/^[a-z_][a-z0-9_]*:(?!:)/i, "").trim();
    const name = item.split("->")[0];
    if (!cols.has(name)) problems.push({ file, table, column: name });
  }
}

describe("insurance queries name real columns", () => {
  it("every rpc exists and takes the named arguments", async () => {
    const res = await db.query<{ proname: string; args: string[] | null }>(
      `select p.proname, p.proargnames as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`,
    );
    const fns = new Map<string, Set<string>[]>();
    for (const r of res.rows) {
      if (!fns.has(r.proname)) fns.set(r.proname, []);
      fns.get(r.proname)!.push(new Set(r.args ?? []));
    }
    const problems: string[] = [];
    let calls = 0;
    for (const root of ROOTS) {
      for (const file of await sourceFiles(path.resolve(root))) {
        const text = await readFile(file, "utf8");
        for (const m of text.matchAll(/\.rpc\(\s*"([a-z_]+)"(?:\s*,\s*\{([^{}]*)\})?/g)) {
          calls++;
          const overloads = fns.get(m[1]);
          if (!overloads) {
            problems.push(`${m[1]} (missing)`);
            continue;
          }
          const keys = [...(m[2] ?? "").matchAll(/(?:^|[,\n])\s*([a-z_][a-z0-9_]*)\s*(?::|,|$)/g)].map((k) => k[1]);
          if (!overloads.some((args) => keys.every((k) => args.has(k)))) problems.push(`${m[1]}(${keys.join(", ")})`);
        }
      }
    }
    expect(calls).toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });

  it("every select, filter, order and literal write key exists", async () => {
    const problems: Problem[] = [];
    let chains = 0;
    let selects = 0;
    for (const root of ROOTS) {
      for (const file of await sourceFiles(path.resolve(root))) {
        const text = await readFile(file, "utf8");
        const rel = path.relative(process.cwd(), file);
        const fromRe = /\.from\("([a-z_]+)"\)/g;
        let m: RegExpExecArray | null;
        while ((m = fromRe.exec(text))) {
          const table = m[1];
          const cols = columns.get(table);
          if (!cols) {
            problems.push({ file: rel, table, column: "(table or view missing)" });
            continue;
          }
          chains++;
          // The chain runs until the statement ends or the next query starts.
          const rest = text.slice(m.index + m[0].length);
          const stop = rest.search(/;\s*\n|\.from\("|\n\s*\]\);|\n\s*\),\n/);
          const chain = stop === -1 ? rest : rest.slice(0, stop);

          const sel = chain.match(/^\s*(?:\.[a-z]+\([^)]*\)\s*)*?\.select\(\s*(["`])([\s\S]*?)\1/i)
            ?? chain.match(/\.select\(\s*(["`])([\s\S]*?)\1/);
          if (sel) {
            selects++;
            checkSelect(sel[2], table, rel, problems);
          }

          for (const f of chain.matchAll(/\.(eq|neq|is|in|gt|gte|lt|lte|like|ilike|not|order|contains|overlaps)\(\s*"([a-z_][a-z0-9_]*)"/g)) {
            if (!cols.has(f[2])) problems.push({ file: rel, table, column: `${f[1]}:${f[2]}` });
          }
          for (const w of chain.matchAll(/\.(update|insert|upsert)\(\s*\{([^{}]*)\}/g)) {
            for (const k of w[2].matchAll(/(?:^|[,{\n])\s*([a-z_][a-z0-9_]*)\s*:/g)) {
              if (!cols.has(k[1])) problems.push({ file: rel, table, column: `${w[1]}:${k[1]}` });
            }
          }
        }
      }
    }
    expect(chains).toBeGreaterThan(50);
    expect(selects).toBeGreaterThan(80);
    expect(problems).toEqual([]);
  });
});
