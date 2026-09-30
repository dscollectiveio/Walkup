// The setup walkthrough shown on Home to a board admin of a new building.
//
// Every step is derived from real rows — a step is "done" because the thing
// exists (a unit, a policy, a budget line), never because someone ticked a
// box. That means it can't drift from reality, and it re-ticks itself if the
// data is fixed later. Order matters: Building Info first, because units,
// people and the EIN feed everything after it.

export type SetupSectionKey = "building" | "money" | "taxes_insurance" | "upkeep";

export interface SetupStep {
  key: string;
  name: string;
  detail: string;
  href: string;
  done: boolean;
  doneOn: string | null; // ISO date when known
  /** Ticks on its own as a side effect of another step; never blocks "complete". */
  informational?: boolean;
  /** Shown when this is the step the admin should do next. */
  instructions: string[];
}

export interface SetupSection {
  key: SetupSectionKey;
  title: string;
  blurb: string;
  steps: SetupStep[];
}

export interface SetupInputs {
  today: Date;
  association: {
    ein: string | null;
    city: string | null;
    county: string | null;
    incorporated_on: string | null;
    dues_payee_name: string | null;
    dues_account_number: string | null;
    dues_zelle_handle: string | null;
  };
  units: { id: string }[];
  unitOwners: { unit_id: string; effective_from: string; effective_to: string | null }[];
  persons: { id: string }[];
  roleGrants: {
    person_id: string;
    granted_on: string;
    revoked_at: string | null;
    expires_on: string | null;
  }[];
  myPersonId: string | null;
  inviteCount: number;
  bankConnections: { status: string; created_at: string; last_synced_at: string | null }[];
  uncategorizedCount: number;
  postedEntryCount: number;
  budgetLineCount: number;
  assessmentScheduleCount: number;
  taxFilingComputedAt: string | null;
  policies: { effective_from: string; effective_to: string }[];
  vendors: { w9_on_file: boolean; w9_received_on: string | null; is_1099_exempt: boolean }[];
  /** Current, non-deleted documents with their category slug. */
  documents: { category_slug: string | null; uploaded_at: string }[];
}

const isoDay = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

function onOrBefore(dateIso: string, today: Date): boolean {
  return new Date(`${dateIso}T00:00:00`) <= today;
}

function onOrAfter(dateIso: string, today: Date): boolean {
  return new Date(`${dateIso}T00:00:00`) >= today;
}

export function buildSetupGuide(input: SetupInputs): SetupSection[] {
  const { today, association: a } = input;

  // ---- Building Info -------------------------------------------------------
  const profileDone = Boolean(a.ein && a.city && a.county && a.incorporated_on);

  const unitsDone = input.units.length > 0;

  const currentOwnerUnitIds = new Set(
    input.unitOwners
      .filter((o) => onOrBefore(o.effective_from, today) && (!o.effective_to || onOrAfter(o.effective_to, today)))
      .map((o) => o.unit_id),
  );
  const ownersDone = unitsDone && input.units.every((u) => currentOwnerUnitIds.has(u.id));
  const latestOwnerFrom = input.unitOwners.map((o) => o.effective_from).sort().at(-1) ?? null;

  const activeOtherGrants = input.roleGrants.filter(
    (g) =>
      g.person_id !== input.myPersonId &&
      g.revoked_at === null &&
      (g.expires_on === null || onOrAfter(g.expires_on, today)),
  );
  const peopleDone = input.persons.length > 1 && activeOtherGrants.length > 0;
  const latestGrant = activeOtherGrants.map((g) => g.granted_on).sort().at(-1) ?? null;

  const invitesDone = input.inviteCount > 0;

  // ---- Money In & Money Out ------------------------------------------------
  const activeConnection = input.bankConnections.find((c) => c.status === "active");
  const bankDone = Boolean(activeConnection);
  const syncedConnection = input.bankConnections.find((c) => c.status === "active" && c.last_synced_at);
  const syncDone = Boolean(syncedConnection);
  const backlogDone = syncDone && input.uncategorizedCount === 0;
  const statementsDone = input.postedEntryCount > 0;
  const budgetDone = input.budgetLineCount > 0;
  const paymentInfoDone = Boolean(a.dues_payee_name || a.dues_account_number || a.dues_zelle_handle);
  const scheduleDone = input.assessmentScheduleCount > 0;

  // ---- Taxes & Insurance ---------------------------------------------------
  const einDone = Boolean(a.ein);
  const taxDone = input.taxFilingComputedAt !== null;
  const activePolicy = input.policies
    .filter((p) => onOrAfter(p.effective_to, today))
    .sort((x, y) => x.effective_from.localeCompare(y.effective_from))[0];
  const insuranceDone = Boolean(activePolicy);

  // ---- Building upkeep -----------------------------------------------------
  const vendorsDone = input.vendors.length > 0;
  const missingW9 = input.vendors.filter((v) => !v.w9_on_file && !v.is_1099_exempt).length;
  // Zero contractors is not "every contractor has a W-9" — it's nothing to check yet.
  const w9Done = vendorsDone && missingW9 === 0;
  const lastW9 = input.vendors
    .map((v) => v.w9_received_on)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);
  const governingDoc = input.documents.filter((d) => d.category_slug === "governing").sort((x, y) => x.uploaded_at.localeCompare(y.uploaded_at))[0];
  const insuranceDoc = input.documents.filter((d) => d.category_slug === "insurance").sort((x, y) => x.uploaded_at.localeCompare(y.uploaded_at))[0];
  const docsDone = Boolean(governingDoc && insuranceDoc);

  return [
    {
      key: "building",
      title: "Building Info",
      blurb: "Start here. Units, owners and the association's details feed every other section.",
      steps: [
        {
          key: "profile",
          name: "Fill in the association's details",
          detail: "EIN, city, county and the date it was incorporated.",
          href: "/building",
          done: profileDone,
          doneOn: null,
          instructions: [
            "Open Building Info and click “Edit details” on the Association profile card.",
            "The EIN is on the IRS letter (CP 575) or last year's 1120-H. The tax center needs it.",
            "Incorporation date and county are on the Illinois Secretary of State record.",
          ],
        },
        {
          key: "units",
          name: "Add every unit",
          detail: unitsDone
            ? `${input.units.length} unit${input.units.length === 1 ? "" : "s"} on file.`
            : "Dues, balances and tickets are all tracked per unit.",
          href: "/building",
          done: unitsDone,
          doneOn: null,
          instructions: [
            "On Building Info, use “Add a unit” once per unit — label them the way owners say them (“Unit 2”, “Garden”).",
            "Get the count right now; adding one later is easy, but every dues charge is per unit.",
          ],
        },
        {
          key: "owners",
          name: "Assign an owner to each unit",
          detail: "So dues payments can be matched to the right person.",
          href: "/building",
          done: ownersDone,
          doneOn: ownersDone ? latestOwnerFrom : null,
          instructions: [
            "Add each owner under People first, then assign them to their unit under Ownership.",
            "Owners don't need a login — a name and email is enough to keep the records straight.",
          ],
        },
        {
          key: "people",
          name: "Add the rest of the board",
          detail: "Give at least one other person access so you're not the only key.",
          href: "/building",
          done: peopleDone,
          doneOn: peopleDone ? latestGrant : null,
          instructions: [
            "Add board members under People and tick their role — Board member sees everything, Board admin can also edit.",
            "An accountant's access expires on its own after 90 days.",
          ],
        },
        {
          key: "invites",
          name: "Invite them to sign in",
          detail: "An invite link they redeem with their own email and authenticator.",
          href: "/building",
          done: invitesDone,
          doneOn: null,
          instructions: [
            "Under Invites, generate a link for the role you want and send it yourself — Walkup never emails on your behalf.",
            "Everyone who signs in must set up two-factor authentication on first login.",
          ],
        },
      ],
    },
    {
      key: "money",
      title: "Money In & Money Out",
      blurb: "The bank feed is the source of truth. Connect it, post what it reports, and the statements, budget and dues follow.",
      steps: [
        {
          key: "bank",
          name: "Connect the bank account",
          detail: "Read-only. Walkup can see transactions and can never move money.",
          href: "/bank-feed",
          done: bankDone,
          doneOn: isoDay(activeConnection?.created_at),
          instructions: [
            "On Bank Sync & Transactions, click “Connect a bank account” and sign in through Plaid.",
            "Your bank password is never seen or stored by Walkup — only a read-only token.",
          ],
        },
        {
          key: "sync",
          name: "Sync transactions",
          detail: "Pulls up to two years of history the first time.",
          href: "/bank-feed",
          done: syncDone,
          doneOn: isoDay(syncedConnection?.last_synced_at),
          instructions: [
            "Click “Sync now” on the connected account. After that, it syncs itself every day.",
          ],
        },
        {
          key: "backlog",
          name: "Categorize and post the backlog",
          detail:
            input.uncategorizedCount > 0
              ? `${input.uncategorizedCount} transaction${input.uncategorizedCount === 1 ? "" : "s"} still need${input.uncategorizedCount === 1 ? "s" : ""} a category.`
              : "Every synced transaction is in the books.",
          href: "/bank-feed?status=needs",
          done: backlogDone,
          doneOn: null,
          instructions: [
            "Use the “N suggested as …” buttons above the table to select whole groups at once, then “Save & post all”.",
            "Deposits from owners are Dues — pick the unit. Transfers between your own accounts are Transfers.",
            "Anything you save “for later” shows under Ready to post; “Post all ready” finishes it.",
          ],
        },
        {
          key: "statements",
          name: "Financial statements",
          detail: "Built automatically from what you post — nothing to set up.",
          href: "/financial-statements",
          done: statementsDone,
          doneOn: null,
          informational: true,
          instructions: [],
        },
        {
          key: "budget",
          name: "Set this year's budget",
          detail: "A number per expense category, so the budget page can show where you stand.",
          href: "/budget",
          done: budgetDone,
          doneOn: null,
          instructions: [
            "On Budget, enter an annual amount for each category. Last year's actuals are a fine starting point.",
            "Add a category if one is missing — it becomes an account you can post to.",
          ],
        },
        {
          key: "dues_payment",
          name: "Tell owners how to pay dues",
          detail: "Payee name, account and routing number, or a Zelle handle.",
          href: "/dues",
          done: paymentInfoDone,
          doneOn: null,
          instructions: [
            "On HOA Dues, fill in “How to pay”. Owners set up bill pay once and it runs on its own.",
          ],
        },
        {
          key: "dues_schedule",
          name: "Set the dues schedule",
          detail: "How much each unit owes and how often.",
          href: "/dues",
          done: scheduleDone,
          doneOn: null,
          instructions: [
            "On HOA Dues, add a schedule: the amount per unit and whether it's monthly, quarterly or annual.",
            "Then “Charge this period” records what each unit owes, so “What's owed” is real.",
          ],
        },
      ],
    },
    {
      key: "taxes_insurance",
      title: "Taxes & Insurance",
      blurb: "The 1120-H is computed from the books. Insurance is the renewal you don't want to miss.",
      steps: [
        {
          key: "ein",
          name: "EIN on file",
          detail: "Required on the 1120-H. Set on Building Info.",
          href: "/building",
          done: einDone,
          doneOn: null,
          instructions: ["Edit the Association profile on Building Info and enter the EIN."],
        },
        {
          key: "tax",
          name: "Review the Tax Center at year end",
          detail: "Nothing to enter now — the figures come from posted activity.",
          href: "/tax",
          done: taxDone,
          doneOn: isoDay(input.taxFilingComputedAt),
          instructions: [
            "After the fiscal year closes, open Tax Center and compute the 1120-H figures. Your accountant files from there.",
          ],
        },
        {
          key: "insurance",
          name: "Record the insurance policy",
          detail: "Carrier, premium and dates — so the renewal shows up here before the invoice does.",
          href: "/insurance",
          done: insuranceDone,
          doneOn: activePolicy?.effective_from ?? null,
          instructions: [
            "On Insurance, upload the declarations page (usually the first 1–3 pages of the policy). Walkup reads the limits, deductibles and dates, and you check each one before saving.",
            "No PDF handy? Enter the details by hand instead. One entry per policy — the master policy, liability and D&O are often separate.",
          ],
        },
      ],
    },
    {
      key: "upkeep",
      title: "Building upkeep",
      blurb: "Who you call, and the paperwork the next board will ask for.",
      steps: [
        {
          key: "vendors",
          name: "Add your contractors",
          detail: "Plumber, electrician, snow, cleaning — whoever you already pay.",
          href: "/contractors",
          done: vendorsDone,
          doneOn: null,
          instructions: [
            "On Contractors, “Add a contractor” with their trade and contact details.",
            "Note when their insurance certificate expires — you'll be warned before it lapses.",
          ],
        },
        {
          key: "w9",
          name: "Collect contractor W-9s",
          detail:
            missingW9 > 0
              ? `${missingW9} contractor${missingW9 === 1 ? "" : "s"} still need${missingW9 === 1 ? "s" : ""} one before January's 1099s.`
              : vendorsDone
                ? "Everyone who needs one has one on file."
                : "Needed before a 1099 can be issued in January.",
          href: "/contractors",
          done: w9Done,
          doneOn: w9Done ? (lastW9 ?? null) : null,
          instructions: [
            "Ask each contractor for a signed W-9 and tick “W-9 on file” on their row. Corporations can be marked 1099-exempt.",
            "Only the last four digits of their tax ID are stored — file the form itself in the Document Hub.",
          ],
        },
        {
          key: "documents",
          name: "Upload the declaration and insurance certificate",
          detail: "The two documents every board gets asked for first.",
          href: "/documents",
          done: docsDone,
          doneOn: docsDone ? isoDay([governingDoc!.uploaded_at, insuranceDoc!.uploaded_at].sort().at(-1)) : null,
          instructions: [
            "In Document Hub, upload the declaration and file it under Governing document; upload the insurance certificate under Insurance.",
            "Governing documents are visible to every owner; insurance stays board-only.",
          ],
        },
      ],
    },
  ];
}

export function isSetupComplete(sections: SetupSection[]): boolean {
  return sections.every((s) => s.steps.every((st) => st.informational || st.done));
}

export function countSteps(sections: SetupSection[]): { done: number; total: number } {
  const steps = sections.flatMap((s) => s.steps).filter((st) => !st.informational);
  return { done: steps.filter((st) => st.done).length, total: steps.length };
}

/** The step the admin should do next: first not-done, non-informational, in order. */
export function nextStep(sections: SetupSection[]): SetupStep | null {
  for (const s of sections) {
    for (const st of s.steps) {
      if (!st.informational && !st.done) return st;
    }
  }
  return null;
}

/** Still-open steps, flattened, for the small "Your list" card once the guide is hidden. */
export function openSteps(sections: SetupSection[]): SetupStep[] {
  return sections.flatMap((s) => s.steps).filter((st) => !st.informational && !st.done);
}
