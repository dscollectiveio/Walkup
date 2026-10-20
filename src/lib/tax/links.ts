// Official links for each form, read from the tax_form_links registry (0048).
// Every row carries the date Walkup retrieved it and whether a person has
// since opened it and confirmed it's current; boards see that state in words
// next to every link, never a bare URL presented as authoritative. Pure.
//
// The registry is global and seeded unverified (the tax_parameters precedent
// in 0005). A platform admin's "I opened this and it's current" sets
// verified_at; the automatic "Check all links" records last_check_status,
// which ilsos.gov blocks for anything that isn't a browser — so "blocked" is
// a state here, not an error.

import { dateWords, LINKS_NOT_CHECKED } from "./copy";
import type { FormCode } from "./determine";

/** W-9 has links (ask a contractor for one) but is never a template. */
export type LinkFormCode = FormCode | "irs_w9";

export type LinkKind = "about" | "form" | "instructions" | "file_online" | "order_paper" | "guidance" | "law";

/** How each kind reads on a links line. */
export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  about: "About this form",
  form: "Official form",
  instructions: "Instructions",
  file_online: "File online",
  order_paper: "Order paper forms",
  guidance: "Guidance",
  law: "The law",
};

/** A tax_form_links row as selected. */
export interface LinkRow {
  id: string;
  form_code: string;
  kind: string;
  label: string;
  url: string;
  state_code: string | null;
  retrieved_on: string;
  verified_at: string | null;
  last_checked_at: string | null;
  /** '200' | 'blocked' | 'error: …' — from the admin's "Check all links". */
  last_check_status: string | null;
  active: boolean;
  sort_order: number;
}

export type LinkChecked = "verified" | "unverified" | "stale" | "blocked";

export interface LinkView {
  id: string;
  kind: string;
  label: string;
  url: string;
  /**
   * verified — a person opened it within the last 12 months;
   * stale — a person did, but more than 12 months ago;
   * blocked — the automatic check can't reach it (ilsos.gov), so the
   *           person's check is the only one there is or will be;
   * unverified — retrieved by Walkup, not yet opened by a person.
   */
  checked: LinkChecked;
  /** The day a person confirmed it, when one has. */
  checkedOn: string | null;
  retrievedOn: string;
}

/** The DB CHECK on tax_form_links.url and tax_form_templates.source_url, exactly: https, an official host, and a path. */
const OFFICIAL_URL = /^https:\/\/([a-z0-9-]+\.)*(irs\.gov|illinois\.gov|ilsos\.gov|ilga\.gov)\//;

/** Mirrors the DB regex, so the admin form can refuse a URL before the database does. Case-sensitive, like the CHECK. */
export function isOfficialLinkUrl(raw: string): boolean {
  return OFFICIAL_URL.test(raw);
}

/** The same calendar day a year earlier; Feb 29 becomes Feb 28. */
function yearBefore(todayIso: string): string {
  const y = Number(todayIso.slice(0, 4)) - 1;
  const monthDay = todayIso.slice(4, 10);
  return monthDay === "-02-29" ? `${y}-02-28` : `${y}${monthDay}`;
}

function view(row: LinkRow, todayIso: string): LinkView {
  const verifiedOn = row.verified_at ? row.verified_at.slice(0, 10) : null;
  const blocked = row.last_check_status === "blocked";
  const checked: LinkChecked =
    verifiedOn === null ? (blocked ? "blocked" : "unverified")
    : verifiedOn < yearBefore(todayIso) ? "stale"
    : blocked ? "blocked"
    : "verified";
  return { id: row.id, kind: row.kind, label: row.label, url: row.url, checked, checkedOn: verifiedOn, retrievedOn: row.retrieved_on };
}

/**
 * The active links for one form, scoped to the building's state: rows with
 * no state apply everywhere; a state's rows only there. A NH building sees
 * the federal links and nothing Illinois. Sorted the way the registry wants
 * them read (about, form, instructions, file online, …).
 */
export function linksFor(rows: LinkRow[], formCode: LinkFormCode, stateCode: string, todayIso: string): LinkView[] {
  return rows
    .filter((r) => r.active && r.form_code === formCode && (r.state_code === null || r.state_code === stateCode))
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
    .map((r) => view(r, todayIso));
}

/** The words after a link: who has checked it, and when. */
export function linkStatusWords(v: LinkView): string {
  switch (v.checked) {
    case "verified":
      return `checked ${dateWords(v.checkedOn ?? v.retrievedOn, "short")}`;
    case "stale":
      return "last checked over a year ago";
    case "blocked":
      return v.checkedOn
        ? `couldn't be checked automatically, opened by a person on ${dateWords(v.checkedOn, "short")}`
        : `couldn't be checked automatically, ${LINKS_NOT_CHECKED}`;
    default:
      return `retrieved ${dateWords(v.retrievedOn, "short")} · ${LINKS_NOT_CHECKED}`;
  }
}
