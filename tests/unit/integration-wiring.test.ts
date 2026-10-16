import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateBoardContact } from "@/lib/owner/board-contact";

/**
 * The cross-workstream wiring done by the Integration step (X2): the
 * board-only guards, the cron and environment configuration, and the board
 * contact check. Source-level checks read the files the way privacy-page.test
 * does, with whitespace collapsed.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\s+/g, " ");

describe("board contact (Building Info, 'Who owners write to')", () => {
  const none = { name: null, email: null, phone: null };
  it("accepts nothing, or a sane name, email and phone", () => {
    expect(validateBoardContact(none)).toBeNull();
    expect(validateBoardContact({ name: "Dana Lee", email: "board@example.com", phone: "312-555-0100" })).toBeNull();
  });
  it("refuses a malformed email, with a sentence", () => {
    for (const email of ["board", "a@b", "a b@example.com", "a@example.com, b@example.com", "<a@example.com>", "a@@example.com"]) {
      expect(validateBoardContact({ ...none, email }), email).toMatch(/real email address/);
    }
  });
  it("holds the lengths the database holds (name 120, email 254, phone 40)", () => {
    expect(validateBoardContact({ ...none, name: "x".repeat(120) })).toBeNull();
    expect(validateBoardContact({ ...none, name: "x".repeat(121) })).toMatch(/120/);
    expect(validateBoardContact({ ...none, email: `${"x".repeat(250)}@example.com` })).toMatch(/real email address/);
    expect(validateBoardContact({ ...none, phone: "1".repeat(41) })).toMatch(/40/);
  });
});

describe("BoardOnly guards (owner-portal-spec 2.4)", () => {
  const cases: { file: string; what: string; why: string; label: string; href: string }[] = [
    {
      file: "src/app/bank-feed/page.tsx",
      what: "The bank feed",
      why: "It shows the association's bank transactions, which only the board and the accountant can see.",
      label: "See your statement",
      href: "/owner",
    },
    {
      file: "src/app/financial-statements/page.tsx",
      what: "Financial statements",
      why: "Profit and loss reports are shared with owners as documents when the board decides to.",
      label: "See documents shared with you",
      href: "/documents",
    },
    {
      file: "src/app/ledger/page.tsx",
      what: "The general ledger",
      why: "It holds every transaction, including other owners' payments.",
      label: "See your statement",
      href: "/owner",
    },
    {
      file: "src/app/tax/page.tsx",
      what: "Taxes",
      why: "The association's tax returns and 1099s are prepared by the board with the accountant.",
      label: "See documents shared with you",
      href: "/documents",
    },
    {
      file: "src/app/building/page.tsx",
      what: "Building Info",
      why: "It is where the board manages units, owners and who can sign in.",
      label: "See your building",
      href: "/owner/building",
    },
    {
      file: "src/app/delinquency/page.tsx",
      what: "Collections",
      why: "It lists every unit's balance, which is private to the board.",
      label: "See your own balance",
      href: "/owner",
    },
  ];
  for (const c of cases) {
    it(`${c.file} shows an owner the BoardOnly page`, () => {
      const src = read(c.file);
      expect(src).toContain("BoardOnly");
      expect(src).toContain(`what="${c.what}"`);
      expect(src).toContain(`why="${c.why}"`);
      expect(src).toContain(`label: "${c.label}", href: "${c.href}"`);
    });
  }

  it("the guard comes before the page's own Restricted or empty state", () => {
    for (const file of ["src/app/bank-feed/page.tsx", "src/app/financial-statements/page.tsx", "src/app/ledger/page.tsx", "src/app/tax/page.tsx"]) {
      const src = read(file);
      expect(src.indexOf("viewerIsOwnerOnly()"), file).toBeGreaterThan(-1);
      const firstBoardOnly = src.indexOf("<BoardOnly");
      const restricted = src.indexOf("<Restricted");
      expect(firstBoardOnly, file).toBeLessThan(restricted);
    }
  });

  it("Building Info shows an owner BoardOnly in place of its Restricted settings page", () => {
    const src = read("src/app/building/page.tsx");
    expect(src.indexOf("viewerIsOwnerOnly()")).toBeLessThan(src.indexOf('<Restricted what="building settings" />', src.indexOf("if (!isBoard)")));
  });

  it("the contractor page shows non-financial readers BoardOnly, not a bare Restricted", () => {
    const src = read("src/app/contractors/[vendorId]/page.tsx");
    expect(src).toContain('what="Contractor details"');
    expect(src.indexOf("viewerIsOwnerOnly()")).toBeLessThan(src.indexOf('<Restricted what="this contractor" />;', src.indexOf("canReadFinancials")));
  });

  it("owners are sent to their own pages from /dues and from a unit's ledger", () => {
    expect(read("src/app/dues/page.tsx")).toContain('if (!canReadFinancials) redirect("/owner/pay");');
    expect(read("src/app/units/[unitId]/page.tsx")).toContain("redirect(`/owner/statement/${unitId}`)");
  });

  it("Home sends owner-only people to /owner and leaves everyone else on the Dashboard", () => {
    const src = read("src/app/page.tsx");
    expect(src).toContain('if (viewer && !viewer.isStaff) redirect("/owner");');
    expect(src.indexOf("getViewer()")).toBeLessThan(src.indexOf("await Promise.all(["));
  });
});

describe("reportOutsidePayment", () => {
  const src = read("src/app/dues/actions.ts");
  it("maps the ten-report cap and refuses a future date", () => {
    expect(src).toContain('error.code === "53400"');
    expect(src).toContain("There are already ten reports waiting for this unit. The board will answer them first.");
    expect(src).toContain("Enter the date you paid, not a future date.");
  });
  it("refreshes the owner pages", () => {
    expect(src).toContain('revalidatePath("/owner/pay")');
    expect(src).toContain('revalidatePath("/owner")');
  });
});

describe("entry points on Building Info and Announcements", () => {
  it("offers the import to board admins, with its sentence", () => {
    const src = read("src/app/building/page.tsx");
    expect(src).toContain('href="/building/import"');
    expect(src).toContain("Bring in units, owners, transactions and opening balances.");
    expect(src).toContain("No units yet. Add them one at a time, or");
  });
  it("mounts Invite to sign in on a person with no login who owns something", () => {
    expect(read("src/app/building/person-row.tsx")).toContain("<InviteToSignIn");
    const page = read("src/app/building/page.tsx");
    expect(page).toContain("!p.auth_user_id");
    expect(page).toContain('.includes("owner") || currentOwnerIds.has(p.id)');
  });
  it("offers Email this to owners on posted announcements only", () => {
    expect(read("src/app/announcements/board-row.tsx")).toContain('status === "published" ? <EmailAnnouncementButton announcementId={id} />');
  });
  it("links the import from the empty contractors list and the empty dues table", () => {
    expect(read("src/app/repairs/contractors-view.tsx")).toContain("/building/import/new?kind=contractors");
    expect(read("src/app/dues/page.tsx")).toContain("import them with your units");
  });
});

describe("cron and environment configuration", () => {
  const vercel = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };
  it("runs the bank sync and the email reminders daily, each at a route that exists", () => {
    const paths = vercel.crons.map((c) => c.path).sort();
    expect(paths).toEqual(["/api/cron/email-reminders", "/api/cron/sync-bank-feeds"]);
    for (const c of vercel.crons) {
      expect(c.schedule, c.path).toMatch(/^\d+ \d+ \* \* \*$/);
      expect(existsSync(path.join(ROOT, "src/app", c.path, "route.ts")), c.path).toBe(true);
    }
    expect(new Set(vercel.crons.map((c) => c.schedule)).size).toBe(2);
  });
  it("documents every secret the new features read in .env.local.example, with no value", () => {
    const env = readFileSync(path.join(ROOT, ".env.local.example"), "utf8");
    for (const name of ["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "EMAIL_FROM_ADDRESS", "EMAIL_SENDING_DISABLED", "PLAID_WEBHOOK_URL", "CRON_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "BANK_TOKEN_KEY", "BILLING_ENABLED", "BILLING_ENFORCE", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) {
      expect(env, name).toMatch(new RegExp(`^${name}=$`, "m"));
    }
  });
  it("makes the public routes the providers call reachable signed out", () => {
    const proxy = read("src/lib/supabase/proxy.ts");
    for (const p of ["/api/cron", "/api/email/webhook", "/api/plaid/webhook", "/api/stripe/webhook", "/unsubscribe"]) expect(proxy, p).toContain(`"${p}"`);
  });
});
