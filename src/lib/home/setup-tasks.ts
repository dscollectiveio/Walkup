// The derived half of the home checklist. These tick themselves from actual
// state — a derived task cannot drift out of sync with reality — and each
// carries the real date the record acquired the thing, when one exists.

export interface DerivedTask {
  name: string;
  detail: string;
  href: string;
  done: boolean;
  doneOn: string | null; // ISO date, when known
}

interface SetupInputs {
  bankConnections: { status: string; created_at: string }[];
  policies: { effective_from: string; effective_to: string }[];
  vendors: { w9_on_file: boolean; w9_received_on: string | null; is_1099_exempt: boolean }[];
  declarationUploadedAt: string | null;
  today: Date;
}

export function derivedTasks(input: SetupInputs): DerivedTask[] {
  const activeConnection = input.bankConnections.find((c) => c.status === "active");

  const activePolicy = input.policies
    .filter((p) => new Date(`${p.effective_to}T00:00:00`) >= input.today)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];

  const missingW9 = input.vendors.filter((v) => !v.w9_on_file && !v.is_1099_exempt).length;
  const lastW9 = input.vendors
    .map((v) => v.w9_received_on)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);

  return [
    {
      name: "Connect the bank account",
      detail: "See transactions without typing them in by hand.",
      href: "/bank-feed",
      done: Boolean(activeConnection),
      doneOn: activeConnection?.created_at.slice(0, 10) ?? null,
    },
    {
      name: "Record your insurance",
      detail: "So renewals show up here before they arrive as invoices.",
      href: "/insurance",
      done: Boolean(activePolicy),
      doneOn: activePolicy?.effective_from ?? null,
    },
    {
      name: "Collect contractor W-9s",
      detail:
        missingW9 > 0
          ? `${missingW9} contractor${missingW9 === 1 ? "" : "s"} still need${missingW9 === 1 ? "s" : ""} one before January's 1099s.`
          : "Everyone who needs one has one on file.",
      href: "/contractors",
      done: missingW9 === 0,
      doneOn: missingW9 === 0 ? (lastW9 ?? null) : null,
    },
    {
      name: "Upload the declaration",
      detail: "The document the next board will ask for first.",
      href: "/documents",
      done: input.declarationUploadedAt !== null,
      doneOn: input.declarationUploadedAt?.slice(0, 10) ?? null,
    },
  ];
}
