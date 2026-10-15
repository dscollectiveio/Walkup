/**
 * The five kinds of import and the fields each one reads (import-spec 5.1).
 * Pure. The keys here are the keys of import_rows.mapped, which 0056 reads.
 */

export type ImportKind = "units_owners" | "transactions" | "opening_accounts" | "opening_units" | "contractors";

export const IMPORT_KINDS: readonly ImportKind[] = [
  "units_owners", "transactions", "opening_accounts", "opening_units", "contractors",
];

export type FieldType = "text" | "email" | "phone" | "date" | "money" | "percent" | "unit" | "category" | "fund";

export type Required = boolean | "oneOf:amount|money_in+money_out" | "oneOf:debit|credit";

export interface FieldDef {
  key: string;
  label: string;
  required: Required;
  kind: FieldType;
  help: string;
  /** Normalised header phrases (lowercase, punctuation to spaces), in priority order. */
  synonyms: string[];
}

export const KIND_LABEL: Record<ImportKind, string> = {
  units_owners: "Units and owners",
  transactions: "Past transactions",
  opening_accounts: "Opening balances: accounts",
  opening_units: "Opening balances: what each unit owed",
  contractors: "Contractors",
};

/** The word for what a kind creates, for "Imported 12 units". */
export const KIND_THINGS: Record<ImportKind, string> = {
  units_owners: "units",
  transactions: "rows",
  opening_accounts: "rows",
  opening_units: "charges",
  contractors: "contractors",
};

/** The path segment used by the template route. */
export const KIND_SLUG: Record<ImportKind, string> = {
  units_owners: "units-owners",
  transactions: "transactions",
  opening_accounts: "opening-accounts",
  opening_units: "opening-units",
  contractors: "contractors",
};

export function templateUrl(kind: ImportKind, format: "csv" | "xlsx"): string {
  return `/building/import/template/${KIND_SLUG[kind]}?format=${format}`;
}

export function kindFromSlug(slug: string): ImportKind | null {
  return IMPORT_KINDS.find((k) => KIND_SLUG[k] === slug) ?? null;
}

export function isImportKind(value: unknown): value is ImportKind {
  return typeof value === "string" && (IMPORT_KINDS as readonly string[]).includes(value);
}

export const FIELDS: Record<ImportKind, FieldDef[]> = {
  units_owners: [
    { key: "unit_label", label: "Unit", required: true, kind: "unit", help: "The label owners use, like Unit 1.",
      synonyms: ["unit", "unit number", "unit no", "unit label", "unit #", "apt", "apartment", "suite", "condo", "property", "home"] },
    { key: "owner_name", label: "Owner name", required: false, kind: "text", help: "Full name. Repeat the unit on a second row for a co-owner.",
      synonyms: ["owner", "owner name", "owners", "name", "full name", "resident", "homeowner", "member", "owner 1"] },
    { key: "email", label: "Email", required: false, kind: "email", help: "Used to match a person who is already on file.",
      synonyms: ["email", "e mail", "email address", "owner email", "contact email"] },
    { key: "phone", label: "Phone", required: false, kind: "phone", help: "",
      synonyms: ["phone", "phone number", "telephone", "tel", "mobile", "cell", "contact phone"] },
    { key: "mailing_address", label: "Mailing address", required: false, kind: "text", help: "Only if different from the unit.",
      synonyms: ["mailing address", "address", "mail address", "owner address", "billing address"] },
    { key: "ownership_percent", label: "Ownership %", required: false, kind: "percent", help: "Share of the common elements. For every unit, or for none.",
      synonyms: ["ownership", "ownership %", "% ownership", "percent", "percentage", "share", "interest", "common interest", "undivided interest"] },
    { key: "dues_amount", label: "Dues amount", required: false, kind: "money", help: "What the unit pays each time. Nothing is charged by importing it.",
      synonyms: ["dues", "dues amount", "assessment", "monthly dues", "monthly assessment", "regular assessment", "hoa fee", "fee"] },
  ],
  transactions: [
    { key: "date", label: "Date", required: true, kind: "date", help: "When the money moved.",
      synonyms: ["date", "transaction date", "trans date", "posted", "posted date", "post date", "paid on", "check date"] },
    { key: "description", label: "Description", required: true, kind: "text", help: "What it was.",
      synonyms: ["description", "memo", "details", "narrative", "transaction", "note"] },
    { key: "amount", label: "Amount", required: "oneOf:amount|money_in+money_out", kind: "money", help: "Money in is positive, money out is negative.",
      synonyms: ["amount", "total", "value", "net"] },
    { key: "money_in", label: "Deposits", required: "oneOf:amount|money_in+money_out", kind: "money", help: "Use instead of Amount when the file has separate columns.",
      synonyms: ["deposit", "deposits", "credit", "credits", "money in", "received", "in"] },
    { key: "money_out", label: "Withdrawals", required: "oneOf:amount|money_in+money_out", kind: "money", help: "Use instead of Amount when the file has separate columns.",
      synonyms: ["withdrawal", "withdrawals", "debit", "debits", "money out", "paid", "out"] },
    { key: "payee", label: "Payee", required: false, kind: "text", help: "Who was paid or who paid.",
      synonyms: ["payee", "vendor", "paid to", "merchant", "supplier", "contractor"] },
    { key: "category_key", label: "Category", required: true, kind: "category", help: "The category or account from your old books. You match each one to your accounts next.",
      synonyms: ["category", "account", "account name", "class", "gl account", "gl code", "code"] },
    { key: "fund_key", label: "Fund", required: false, kind: "fund", help: "Operating or Reserve. Leave out to use one fund for the whole file.",
      synonyms: ["fund", "fund name"] },
    { key: "unit_label", label: "Unit", required: false, kind: "unit", help: "For dues received from a unit.",
      synonyms: ["unit", "unit number", "unit no", "unit label", "unit #", "apt", "apartment", "suite"] },
  ],
  opening_accounts: [
    { key: "account_key", label: "Account", required: true, kind: "category", help: "An account name or code from Walkup's chart of accounts.",
      synonyms: ["account", "account name", "gl account", "account code", "code"] },
    { key: "fund_key", label: "Fund", required: true, kind: "fund", help: "Operating or Reserve, as named in Walkup.",
      synonyms: ["fund", "fund name"] },
    { key: "debit", label: "Debit", required: "oneOf:debit|credit", kind: "money", help: "What you had, and what is owed to you other than dues.",
      synonyms: ["debit", "debits", "dr"] },
    { key: "credit", label: "Credit", required: "oneOf:debit|credit", kind: "money", help: "What you owed, and your fund balance.",
      synonyms: ["credit", "credits", "cr"] },
  ],
  opening_units: [
    { key: "unit_label", label: "Unit", required: true, kind: "unit", help: "",
      synonyms: ["unit", "unit number", "unit no", "unit label", "unit #", "apt", "apartment", "suite"] },
    { key: "amount", label: "Amount owed", required: true, kind: "money", help: "What the unit owed on the opening date. Leave out units that owed nothing.",
      synonyms: ["amount owed", "amount", "owed", "balance", "balance owed", "amount due", "due", "total"] },
  ],
  contractors: [
    { key: "name", label: "Name", required: true, kind: "text", help: "Business or person.",
      synonyms: ["name", "company", "business", "vendor", "contractor"] },
    { key: "trade", label: "Trade", required: false, kind: "text", help: "Plumbing, Electrical, Roofing and so on.",
      synonyms: ["trade", "service", "services", "type", "specialty"] },
    { key: "contact_name", label: "Contact name", required: false, kind: "text", help: "",
      synonyms: ["contact", "contact name", "person"] },
    { key: "email", label: "Email", required: false, kind: "email", help: "",
      synonyms: ["email", "e mail", "email address", "contact email"] },
    { key: "phone", label: "Phone", required: false, kind: "phone", help: "",
      synonyms: ["phone", "phone number", "telephone", "tel", "mobile", "cell", "contact phone"] },
    { key: "website", label: "Website", required: false, kind: "text", help: "",
      synonyms: ["website", "web", "url", "site"] },
    { key: "notes", label: "Notes", required: false, kind: "text", help: "",
      synonyms: ["notes", "comments", "comment", "remarks"] },
  ],
};

export function fieldsOf(kind: ImportKind): FieldDef[] {
  return FIELDS[kind];
}

export function fieldKeys(kind: ImportKind): string[] {
  return FIELDS[kind].map((f) => f.key);
}

/** Labels of the required things still not matched, for "Match Date, Description and Amount to continue." */
export function missingRequired(kind: ImportKind, mapping: Record<string, number | null | undefined>): string[] {
  const has = (key: string) => mapping[key] !== null && mapping[key] !== undefined;
  const missing: string[] = [];
  let oneOfDone = false;
  for (const f of FIELDS[kind]) {
    if (f.required === true) {
      if (!has(f.key)) missing.push(f.label);
    } else if (f.required === "oneOf:amount|money_in+money_out") {
      if (oneOfDone) continue;
      oneOfDone = true;
      if (!(has("amount") || has("money_in") || has("money_out"))) missing.push("Amount");
    } else if (f.required === "oneOf:debit|credit") {
      if (oneOfDone) continue;
      oneOfDone = true;
      if (!(has("debit") || has("credit"))) missing.push("Debit or Credit");
    }
  }
  return missing;
}

/** "Match Date, Description and Amount to continue." */
export function missingRequiredSentence(missing: string[]): string {
  if (missing.length === 0) return "";
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `Match ${list} to continue.`;
}
