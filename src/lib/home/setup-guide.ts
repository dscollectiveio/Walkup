// The setup walkthrough shown on Home to a board admin of a new building.
//
// Every step is derived from real rows — a step is "done" because the thing
// exists (a unit, a policy, a budget line), never because someone ticked a
// box. That means it can't drift from reality, and it re-ticks itself if the
// data is fixed later. Order matters: Building & Owners first, because units,
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
    /** Who owners write to (owner-portal 0054); the email is what "done" means. */
    board_contact_name?: string | null;
    board_contact_email?: string | null;
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
  /** Announcements the board has posted (owner portal). */
  announcementCount?: number;
  /** Board only: imports by kind and status (import_batches), for the optional import steps. */
  importBatches?: { kind: string; status: string }[];
  /** Board only: email_settings.sending_enabled. */
  emailSendingEnabled?: boolean;
  bankConnections: { status: string; created_at: string; last_synced_at: string | null }[];
  uncategorizedCount: number;
  postedEntryCount: number;
  budgetLineCount: number;
  assessmentScheduleCount: number;
  taxFilingComputedAt: string | null;
  /** tax_forms rows started for the year the Taxes tab is working on — the return by its fiscal year, 1099s by their payment year. */
  taxFormsStarted: number;
  /** Every policy with its computed status (lib/insurance/status withStatus); "done" means one is active. */
  policies: { effective_from: string; status: string }[];
  /** Board only: when the owner summary was last published (insurance_owner_summaries.published_at). */
  ownerSummaryPublishedAt?: string | null;
  /** aiConfigured(): the insurance step's wording says whether Walkup reads the declarations. */
  aiConfigured?: boolean;
  /** Saved contractors. Archived ones don't count; the W-9 step counts only contractors in use. */
  vendors: {
    w9_on_file: boolean;
    w9_received_on: string | null;
    is_1099_exempt: boolean;
    archived_at?: string | null;
    inUse?: boolean;
  }[];
  /** Active upkeep tasks (repairs-spec §18.5). */
  upkeepTasks?: { id: string }[];
  /** Facts plus contacts filled in on building_emergency_info(). */
  emergencyInfo?: { filled: number };
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

  // ---- Building & Owners -------------------------------------------------------
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

  // Any invite counts, whether it points at a person already in the list or not.
  const invitesDone = input.inviteCount > 0;
  const contactDone = Boolean(a.board_contact_email);
  const contactName = a.board_contact_name?.trim() || null;
  const announcementCount = input.announcementCount ?? 0;
  const committed = (kind: string) => (input.importBatches ?? []).some((b) => b.kind === kind && b.status === "committed");
  const importedUnits = committed("units_owners");
  const importedOpening = committed("opening_accounts");
  const importedHistory = committed("transactions");
  const emailSendingOn = input.emailSendingEnabled === true;

  // ---- Finances & Dues ------------------------------------------------
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
  // Either way the board has been through Taxes: saved the year's figures, or
  // started a form under "Your forms".
  const taxDone = input.taxFilingComputedAt !== null || input.taxFormsStarted > 0;
  // Status, not dates: a renewal recorded early keeps the old policy active
  // until the new one starts (lib/insurance/status).
  const activePolicy = input.policies
    .filter((p) => p.status === "active")
    .sort((x, y) => x.effective_from.localeCompare(y.effective_from))[0];
  const insuranceDone = Boolean(activePolicy);
  const ai = input.aiConfigured === true;
  const ownerSummaryOn = input.ownerSummaryPublishedAt ?? null;

  // ---- Building upkeep -----------------------------------------------------
  const upkeepTasks = input.upkeepTasks ?? [];
  const upkeepDone = upkeepTasks.length > 0;
  const emergencyFilled = input.emergencyInfo?.filled ?? 0;
  const emergencyDone = emergencyFilled >= 2;
  const savedVendors = input.vendors.filter((v) => !v.archived_at);
  const vendorsDone = savedVendors.length > 0;
  // Only contractors the board actually uses owe a W-9 (lib/contractors/compliance).
  const usedVendors = savedVendors.filter((v) => v.inUse !== false);
  const missingW9 = usedVendors.filter((v) => !v.w9_on_file && !v.is_1099_exempt).length;
  // Zero contractors is not "every contractor has a W-9": it's nothing to check yet.
  const w9Done = vendorsDone && missingW9 === 0;
  const lastW9 = savedVendors
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
      title: "Building & Owners",
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
            "Open Building & Owners and click “Edit details” on the Association profile card.",
            "The EIN is on the IRS letter (CP 575) or last year's 1120-H. The tax center needs it.",
            "Incorporation date and county are on the Illinois Secretary of State record.",
          ],
        },
        {
          key: "board_contact",
          name: "Say who owners should write to",
          detail: contactDone
            ? `Owners see ${contactName ?? "your board contact"} on their home page.`
            : "A name and an email, so owners know who to ask.",
          href: "/building#contact",
          done: contactDone,
          doneOn: null,
          instructions: [
            "On Building & Owners, open the association profile and fill in Who owners write to.",
            "Owners see it on their home page and your reminder emails reply to it.",
          ],
        },
        {
          key: "import_units",
          name: "Import your units and owners (optional)",
          detail: importedUnits ? "Imported from a spreadsheet." : "Faster than typing them one at a time.",
          href: "/building/import",
          done: importedUnits,
          doneOn: null,
          informational: true,
          instructions: [
            "On Building & Owners, open Import from a spreadsheet and download the template.",
            "Fill it in, upload it, check the preview, and import.",
          ],
        },
        {
          key: "units",
          name: "Add every unit",
          detail: unitsDone
            ? `${input.units.length} unit${input.units.length === 1 ? "" : "s"} on file.`
            : "Add your units, or import them from a spreadsheet.",
          href: "/building",
          done: unitsDone,
          doneOn: null,
          instructions: [
            "On Building & Owners, use “Add a unit” once per unit, and add the owner in the same step. Label units the way owners say them (“Unit 2”, “Garden”).",
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
            "When you add a unit, choose “Someone new” and tick “They own this unit”. For a unit already added, use its Edit button to add the owner.",
            "Owners don't need a login. A name and email is enough to keep the records straight.",
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
            "Add board members under “Others on file” in Units and people, and tick their role. Board member sees everything, Board admin can also edit.",
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
            "On Building & Owners, press “Invite to sign in” next to a person, or generate a link under Sign-in invites in Units and people. Send it yourself: Walkup does not email invites.",
            "Everyone who signs in must set up two-factor authentication on first login.",
          ],
        },
        {
          key: "first_announcement",
          name: "Post a welcome note",
          detail: announcementCount > 0 ? "Owners can read what you posted." : "Owners see announcements on their home page.",
          href: "/announcements/new",
          done: announcementCount > 0,
          doneOn: null,
          informational: true,
          instructions: ["Open Announcements, write a short welcome, and post it to everyone."],
        },
      ],
    },
    {
      key: "money",
      title: "Finances & Dues",
      blurb: "The bank feed is the source of truth. Connect it, post what it reports, and the statements, budget and dues follow.",
      steps: [
        {
          key: "import_opening",
          name: "Enter your opening balances (optional)",
          detail: importedOpening ? "Imported from a spreadsheet." : "Start from where the books stood, in one file.",
          href: "/building/import",
          done: importedOpening,
          doneOn: null,
          informational: true,
          instructions: [
            "On Building & Owners, open Import from a spreadsheet and choose opening balances.",
            "Check the preview. Nothing is posted until you press Import.",
          ],
        },
        {
          key: "bank",
          name: "Connect the bank account",
          detail: "Read-only. Walkup can see transactions and can never move money.",
          href: "/bank-feed",
          done: bankDone,
          doneOn: isoDay(activeConnection?.created_at),
          instructions: [
            "On Bank Feed & Transactions, click “Connect a bank account” and sign in through Plaid.",
            "Your bank password is never seen or stored by Walkup, only a read-only token.",
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
            "Click a recommended category to post that row; “Post all N recommended” does every one your own history backs.",
            "Deposits from owners are Dues. Pick the unit. Transfers between your own accounts are Transfers.",
            "Anything you save “for later” shows under Ready to post; “Post N saved” finishes it.",
          ],
        },
        {
          key: "import_history",
          name: "Import last year's transactions (optional)",
          detail: importedHistory ? "Imported from a spreadsheet." : "Bring in earlier spending from a bank or accounting export.",
          href: "/building/import",
          done: importedHistory,
          doneOn: null,
          informational: true,
          instructions: [
            "On Building & Owners, open Import from a spreadsheet and choose transactions.",
            "Match each category to an account, check the preview, then import. You can undo an import afterwards.",
          ],
        },
        {
          key: "statements",
          name: "Financial statements",
          detail: "Built automatically from what you post. Nothing to set up.",
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
            "Add a category if one is missing. It becomes an account you can post to.",
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
          key: "email_sending",
          name: "Turn on email from Walkup (optional)",
          detail: emailSendingOn ? "Sending is on." : "So reminders and statements can go out after you approve them.",
          href: "/dues/email",
          done: emailSendingOn,
          doneOn: null,
          informational: true,
          instructions: [
            "Add the board contact email on Building & Owners first; replies go there.",
            "On Email & reminders, turn sending on. Nothing is sent until a board admin approves it.",
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
          detail: "Required on the 1120-H. Set on Building & Owners.",
          href: "/building",
          done: einDone,
          doneOn: null,
          instructions: ["Edit the Association profile on Building & Owners and enter the EIN."],
        },
        {
          key: "tax",
          name: "Review Taxes at year end",
          detail: "Nothing to enter now. The figures come from posted activity.",
          href: "/tax",
          done: taxDone,
          doneOn: isoDay(input.taxFilingComputedAt),
          instructions: [
            "Now: on Taxes, confirm how each kind of income is classified, once, and Walkup remembers.",
            "After the fiscal year closes, start each form under “Your forms,” confirm the figures, and export a packet to sign or to hand your CPA. Walkup never files anything itself.",
          ],
        },
        {
          key: "insurance",
          name: "Record the insurance policy",
          detail: "Carrier, premium and dates, so the renewal shows up here before the invoice does.",
          href: "/insurance",
          done: insuranceDone,
          doneOn: activePolicy?.effective_from ?? null,
          instructions: ai
            ? [
                "On Insurance, upload the declarations pages (or the whole renewal package). Walkup reads each policy and you check the figures before saving.",
                "No PDF handy? Photos of each page work, or ask your agent to send the declarations.",
              ]
            : [
                "On Insurance, upload your declarations pages to keep them on file, then enter the key figures. It takes about 5 minutes per policy.",
                "No PDF handy? Ask your agent to send the declarations.",
              ],
        },
        {
          key: "insurance_owner_summary",
          name: "Tell owners what the master policy covers",
          detail: "Publish a short summary of what the master policy covers and what it leaves to owners.",
          href: "/insurance/owner-summary",
          done: ownerSummaryOn !== null,
          doneOn: isoDay(ownerSummaryOn),
          instructions: [
            "On Insurance, open the owner summary. It starts from the master policy's figures; put it in your own words, then publish.",
            "Owners see it on their Insurance page, so they know what their own condo policy has to cover.",
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
          key: "upkeep_schedule",
          name: "Set up the upkeep schedule",
          detail: upkeepDone
            ? `${upkeepTasks.length} job${upkeepTasks.length === 1 ? "" : "s"} on the calendar.`
            : "Boiler service, gutters, the backflow test: the jobs every building has.",
          href: "/repairs?view=upkeep",
          done: upkeepDone,
          doneOn: null,
          instructions: [
            "On Repairs & Upkeep, open Upkeep and choose “Add from the usual checklist”.",
            "Untick anything your building doesn't have. Each job comes back on its own date.",
          ],
        },
        {
          key: "emergency_info",
          name: "Add your building's emergency info",
          detail:
            emergencyFilled > 0
              ? "Owners see it when they report an emergency."
              : "Where the water shut-off is, the gas company's emergency line, who to call on the board.",
          href: "/repairs/emergency-info",
          done: emergencyDone,
          doneOn: null,
          instructions: [
            "Open Repairs & Upkeep, then In an emergency.",
            "Add what you know. Owners see it in the safety steps when something goes wrong.",
          ],
        },
        {
          key: "vendors",
          name: "Add your contractors",
          detail: "Plumber, electrician, snow, cleaning: whoever you already pay. Or import them from a spreadsheet.",
          href: "/repairs?view=contractors",
          done: vendorsDone,
          doneOn: null,
          instructions: [
            "On Repairs & Upkeep, open Contractors and choose “Add a contractor” with their trade and contact details.",
            "Note when their insurance certificate expires. You'll be warned before it lapses.",
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
          href: "/repairs?view=contractors",
          done: w9Done,
          doneOn: w9Done ? (lastW9 ?? null) : null,
          instructions: [
            "Ask each contractor for a signed W-9 and tick “W-9 on file” on their row. Corporations can be marked 1099-exempt.",
            "Only the last four digits of their tax ID are stored. File the form itself in Documents.",
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
            "In Documents, upload the declaration and file it under Governing document; upload the insurance certificate under Insurance.",
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
