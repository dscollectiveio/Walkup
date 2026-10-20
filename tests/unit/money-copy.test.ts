import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Plain words in what Walkup shows and sends (insurance-repairs-overhaul 4):
 * no em dash or en dash in the new money and email files. The text of the
 * Terms and Privacy pages is asserted below, once, in plain words.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const DIRS = [
  "src/lib/email-outbox",
  "src/lib/statements",
  "src/lib/collections",
  "src/app/unsubscribe",
  "src/app/dues/send",
  "src/app/dues/statements",
  "src/app/dues/email",
  "src/app/statements",
  "src/app/api/email",
  "src/app/api/cron/email-reminders",
];
const FILES = ["src/app/dues/email-actions.ts", "src/app/dues/collections-section.tsx", "src/app/delinquency/collections-table.tsx", "src/app/owner/profile/email-preferences-card.tsx", "src/app/owner/profile/email-preferences-slot.tsx", "src/app/owner/profile/email-preferences-actions.ts"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("copy", () => {
  it("has no em dash or en dash in any new money or email file", () => {
    const files = [...DIRS.flatMap((d) => walk(path.join(ROOT, d))), ...FILES.map((f) => path.join(ROOT, f))];
    expect(files.length).toBeGreaterThan(40);
    const offenders = files.filter((f) => /[–—]/.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("says the same thing about email in the Terms and the Privacy Policy", () => {
    const terms = readFileSync(path.join(ROOT, "src/app/terms/page.tsx"), "utf8").replace(/\s+/g, " ");
    const privacy = readFileSync(path.join(ROOT, "src/app/privacy/page.tsx"), "utf8").replace(/\s+/g, " ");
    expect(terms).not.toContain("never sends email on your behalf");
    expect(terms).not.toContain("never sends email on its own");
    expect(terms).toContain("Walkup sends email only after a board administrator has approved it");
    expect(terms).toContain("Resend delivers the emails a board administrator approves");
    expect(terms).toContain("Every email has an unsubscribe link at the bottom that works without signing in");
    expect(terms).not.toContain("one click");
    expect(privacy).not.toContain("never sends email for you");
    expect(privacy).toContain("unsubscribe");
    expect(privacy).toContain("24 months");
  });

  it("never puts payment details into an email: no template reads an account, routing number or handle", () => {
    const files = walk(path.join(ROOT, "src/lib/email-outbox/templates"));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/dues_account_number|dues_routing_number|dues_zelle_handle|dues_bank_name|dues_payee_name/);
    }
  });

  it("keeps the unsubscribe page free of scripts and third-party hosts", () => {
    const src = readFileSync(path.join(ROOT, "src/app/unsubscribe/[token]/page.tsx"), "utf8");
    expect(src).not.toMatch(/<script|https?:\/\/(?!www\.walkuphoa\.com)/);
  });
});
