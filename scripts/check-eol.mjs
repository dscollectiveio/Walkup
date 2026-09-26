// End-of-life check for the runtimes Walkup depends on. Run weekly by
// .github/workflows/security.yml; a failure means a runtime is past, or
// within WARN_DAYS of, its end of support and needs an upgrade planned —
// see docs/SECURITY_POLICY.md "Vulnerability and patch management".
import { readFileSync } from "node:fs";

const WARN_DAYS = 90;

// Supabase manages the Postgres version, so it can't be read from this repo.
// Update this when the project is upgraded (Supabase dashboard → Project
// Settings → Infrastructure). Production reported 17.6 on 2026-09-26.
const POSTGRES_MAJOR = "17";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const nextMajor = String(pkg.dependencies.next).replace(/^[^\d]*/, "").split(".")[0];
const nodeMajor = readFileSync(new URL("../.nvmrc", import.meta.url), "utf8")
  .trim()
  .replace(/^v/, "")
  .split(".")[0];

const checks = [
  { product: "nodejs", cycle: nodeMajor, label: "Node.js" },
  { product: "nextjs", cycle: nextMajor, label: "Next.js" },
  { product: "postgresql", cycle: POSTGRES_MAJOR, label: "PostgreSQL (Supabase)" },
];

const today = new Date();
let failed = false;

for (const c of checks) {
  let cycles;
  try {
    const res = await fetch(`https://endoflife.date/api/${c.product}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cycles = await res.json();
  } catch (err) {
    console.error(`✗ ${c.label} ${c.cycle}: couldn't reach endoflife.date (${err.message})`);
    failed = true;
    continue;
  }

  const entry = cycles.find((e) => String(e.cycle) === c.cycle);
  if (!entry) {
    console.error(`✗ ${c.label} ${c.cycle}: no such release line on endoflife.date`);
    failed = true;
    continue;
  }

  if (entry.eol === true) {
    console.error(`✗ ${c.label} ${c.cycle}: end of life`);
    failed = true;
  } else if (entry.eol === false) {
    console.log(`✓ ${c.label} ${c.cycle}: supported, no end-of-life date announced`);
  } else {
    const days = Math.floor((new Date(entry.eol).getTime() - today.getTime()) / 86400000);
    if (days < 0) {
      console.error(`✗ ${c.label} ${c.cycle}: reached end of life on ${entry.eol}`);
      failed = true;
    } else if (days < WARN_DAYS) {
      console.error(`✗ ${c.label} ${c.cycle}: end of life on ${entry.eol} (${days} days) — plan the upgrade`);
      failed = true;
    } else {
      console.log(`✓ ${c.label} ${c.cycle}: supported until ${entry.eol} (${days} days)`);
    }
  }
}

process.exit(failed ? 1 : 0);
