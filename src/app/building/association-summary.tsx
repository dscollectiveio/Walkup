"use client";

import { CARD_HEADER, SECTION_HEADER } from "./section-header";
import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { HEADER_BUTTON } from "@/components/ui";
import { ImportUploader } from "@/app/insurance/components/insurance-uploader";
import { saveAssociationSummary } from "./actions";
import type { AssociationProfile } from "./association-profile-form";
import { btnPrimary } from "@/components/repairs/styles";
import {
  CONSTRUCTION_TYPES,
  FLOOD_ZONES,
  REPLACEMENT_COST_SOURCES,
} from "@/lib/insurance/facts";

/** The insurance_building_facts the card shows and edits. Money as text. */
export interface SummaryFacts {
  replacement_cost_estimate: string | null;
  replacement_cost_as_of: string | null;
  replacement_cost_source: string | null;
  flood_zone: string | null;
  has_boiler: boolean | null;
  has_elevator: boolean | null;
  has_sprinklers: boolean | null;
  manager_handles_funds: boolean | null;
  management_company: string | null;
}

export interface AccountOwner {
  name: string;
  title: string;
}

/** What the Taxes tab holds, shown read only. */
export interface TaxSummary {
  accountantName: string | null;
  accountantFirm: string | null;
  accountantEmail: string | null;
  filingMethod: "paper" | "electronic" | null;
  sosFileNumber: string | null;
}

export interface MasterPolicy {
  id: string;
  carrier: string;
  policyNumber: string | null;
  starts: string;
  renews: string;
  buildingLimit: string | null;
  valuation: string | null;
  annualPremium: string | null;
}

const FACT_FIELDS = [
  "replacement_cost_estimate",
  "replacement_cost_as_of",
  "replacement_cost_source",
  "flood_zone",
  "has_boiler",
  "has_elevator",
  "has_sprinklers",
  "manager_handles_funds",
  "management_company",
] as const;

const VALUATION_WORDS: Record<string, string> = {
  replacement_cost: "replacement cost",
  extended_replacement_cost: "extended replacement cost",
  functional_replacement_cost: "functional replacement cost",
  actual_cash_value: "actual cash value",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const INPUT =
  "w-full rounded-md border border-line-strong bg-paper px-2.5 py-1.5 text-[13px] text-ink";

function money(text: string | null): string | null {
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n)
    ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    : text;
}

function day(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : iso;
}

function yesNo(v: boolean | null): string | null {
  return v === true ? "Yes" : v === false ? "No" : null;
}

function yesNoValue(v: boolean | null): string {
  return v === true ? "yes" : v === false ? "no" : "";
}

/**
 * Association profile as a condensed, Salesforce-style record: every value
 * reads as text, and Edit (or a field's pencil) turns the card into inputs
 * with one Save / Cancel bar. Board admins edit everything; other board
 * members edit the insurance details only.
 */
export function AssociationSummary({
  profile,
  facts,
  master,
  aiOn,
  unitCount,
  owner,
  tax,
  canEditProfile,
  canEditFacts,
}: {
  profile: AssociationProfile;
  facts: SummaryFacts;
  master: MasterPolicy | null;
  /** Whether Walkup can read uploaded policies (an AI key is set). */
  aiOn: boolean;
  unitCount: number;
  owner: AccountOwner | null;
  tax: TaxSummary;
  canEditProfile: boolean;
  canEditFacts: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(saveAssociationSummary, null);

  // Close only on a *new* successful submission (see add-unit-form.tsx).
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state && "ok" in state) setEditing(false);
  }

  const canEdit = canEditProfile || canEditFacts;
  // The policy's building limit, offered as the cost to rebuild until the board
  // enters its own estimate. Never saved on its own: "Use it" fills the inputs.
  const suggestion =
    canEditFacts &&
    !!master?.buildingLimit &&
    Number(master.buildingLimit) > 0 &&
    Number(facts.replacement_cost_estimate ?? 0) !== Number(master.buildingLimit);
  const useSuggestion = () => {
    if (!master) return;
    setExpanded(true);
    setEditing(true);
    const fill = () => {
      const set = (id: string, v: string) => {
        const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
        if (el) el.value = v;
      };
      set("replacement_cost_estimate", master.buildingLimit ?? "");
      set("replacement_cost_as_of", master.starts);
      set("replacement_cost_source", "insurer_valuation");
      document.getElementById("replacement_cost_estimate")?.focus();
    };
    requestAnimationFrame(() => requestAnimationFrame(fill));
  };
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photo, setPhoto] = useState<"loading" | "ok" | "none">("loading");
  /** "More info": opens the full details and brings the Building section into view. */
  const showMoreInfo = () => {
    setExpanded(true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.getElementById("building-details")?.scrollIntoView({ behavior: "smooth", block: "start" })),
    );
  };
  const startEdit = (focusId?: string) => {
    setExpanded(true);
    setEditing(true);
    if (focusId)
      requestAnimationFrame(() => document.getElementById(focusId)?.focus());
  };

  /** One label/value cell; `input` replaces the value while editing when the viewer may change it. */
  const field = (
    id: string,
    label: string,
    value: ReactNode,
    input: ReactNode,
    editable: boolean,
    wide = false,
  ) => (
    <div
      key={id}
      className={`group min-w-0 border-b border-line py-2 ${wide ? "sm:col-span-2" : ""}`}
    >
      <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">
        {editing && editable ? <label htmlFor={id}>{label}</label> : label}
      </dt>
      {editing && editable ? (
        <dd className="mt-1">{input}</dd>
      ) : (
        <dd className="flex min-h-[28px] items-center justify-between gap-2">
          <span
            className={`min-w-0 break-words text-[13px] ${value ? "text-ink" : "text-mute-soft"}`}
          >
            {value || "Not set"}
          </span>
          {editable && !editing ? (
            <button
              type="button"
              onClick={() => startEdit(id)}
              aria-label={`Edit ${label}`}
              className="shrink-0 rounded p-1 text-mute opacity-60 hover:bg-fill hover:text-ink group-hover:opacity-100 focus:opacity-100"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M11 2.5l2.5 2.5L5 13.5H2.5V11L11 2.5z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
        </dd>
      )}
    </div>
  );

  const P = canEditProfile;
  const F = canEditFacts;
  const text = (
    name: keyof AssociationProfile,
    extra: Record<string, unknown> = {},
  ) => (
    <input
      id={name}
      name={name}
      defaultValue={(profile[name] as string | number | null) ?? ""}
      className={INPUT}
      {...extra}
    />
  );
  const yn = (name: keyof SummaryFacts) => (
    <select
      id={name}
      name={name}
      defaultValue={yesNoValue(facts[name] as boolean | null)}
      className={INPUT}
    >
      <option value="">Not sure</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>
  );

  const section = (
    title: string,
    children: ReactNode,
    opts: { action?: ReactNode; note?: ReactNode; id?: string } = {},
  ) => (
    <div id={opts.id} className="scroll-mt-24 overflow-hidden rounded-lg border border-line bg-fill/40">
      <div className={`${SECTION_HEADER} flex flex-wrap items-center justify-between gap-2`}>
        <h3>{title}</h3>
        {opts.action}
      </div>
      <div className="p-4">
        {opts.note}
        <dl className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3 [&>div]:border-line">
          {children}
        </dl>
      </div>
    </div>
  );

  const address = [
    profile.street_address,
    profile.city,
    [profile.state_code, profile.postal_code].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  const headerButton =
    HEADER_BUTTON;
  return (
    <section className="rounded-xl border border-line bg-paper">
      <header className="rounded-t-[7px] band bg-ink px-5 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="eyebrow text-paper">Association profile</h2>
            <p className="mt-1.5 text-[13px] text-ondark-mute">
              Everything about the association and the building in one place,
              including what the insurance check uses.
            </p>
          </div>
          {!editing ? (
            <div className="flex shrink-0 items-center gap-2">
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => startEdit()}
                  className={headerButton}
                >
                  Edit
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className={headerButton}
              >
                {expanded ? "Collapse" : "Expand"}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                  className={`transition-transform ${expanded ? "rotate-90" : ""}`}
                >
                  <path
                    d="M4 2l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <div className="px-5 py-4">
        <form action={action} className="space-y-5">
          {editing && P ? (
            <input type="hidden" name="_profile" value="1" />
          ) : null}
          {editing && F ? (
            <input type="hidden" name="_keys" value={FACT_FIELDS.join(",")} />
          ) : null}

          <div
            id="contact"
            className="flex scroll-mt-20 flex-col gap-4 sm:flex-row"
          >
            {photo !== "none" && profile.street_address ? (
              <div className="relative aspect-[2/1] w-full shrink-0 overflow-hidden rounded-lg bg-fill sm:order-last sm:w-[280px]">
                {/* eslint-disable-next-line @next/next/no-img-element -- same-origin proxy, not a static asset */}
                <img
                  src={`/api/building/map?a=${encodeURIComponent(address)}`}
                  alt={`Map of ${profile.street_address}`}
                  onLoad={() => setPhoto("ok")}
                  onError={() => setPhoto("none")}
                  className={`h-full w-full object-cover transition-opacity ${photo === "ok" ? "opacity-100" : "opacity-0"}`}
                />
                {photo === "ok" ? (
                  <span className="absolute bottom-1 right-1.5 rounded bg-black/50 px-1 text-[10px] text-white">
                    Google
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-semibold text-ink">
                {profile.display_name}
              </p>
              <p className="text-[13px] text-mute">
                {address || "No address yet"}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px] lg:grid-cols-4">
                <div className="col-span-2 min-w-0 overflow-hidden rounded-lg border border-line bg-paper">
                  <div className={`${CARD_HEADER} flex items-center justify-between gap-2`}>
                    <dt>Building details</dt>
                    <button
                      type="button"
                      onClick={showMoreInfo}
                      aria-expanded={expanded}
                      className="shrink-0 text-[11px] font-medium normal-case tracking-normal text-ink underline underline-offset-2 hover:text-ink-mid"
                    >
                      More info <span aria-hidden="true">&rarr;</span>
                    </button>
                  </div>
                  <dd className="grid grid-cols-3 gap-2 px-3 py-2.5">
                    {[
                      ["Year built", profile.year_built ? String(profile.year_built) : null],
                      ["Units", String(unitCount)],
                      ["Roof replaced", profile.roof_replaced_year ? String(profile.roof_replaced_year) : null],
                    ].map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <div className="text-[11px] text-mute">{label}</div>
                        <div className={`text-[14px] font-semibold ${value ? "text-ink" : "font-normal text-mute-soft"}`}>{value || "Not set"}</div>
                      </div>
                    ))}
                  </dd>
                </div>
                {[
                  [
                    "Insurance policy",
                    master ? master.carrier : null,
                    master ? `Renews ${day(master.renews)}` : null,
                    "/insurance",
                  ],
                  ["Owner", owner?.name ?? null, owner?.title ?? null, null],
                ].map(([label, value, sub, href]) => (
                  <div
                    key={label}
                    className={`relative min-w-0 overflow-hidden rounded-lg border border-line bg-paper ${
                      href ? "transition-colors hover:border-line-strong hover:bg-fill focus-within:outline focus-within:outline-2 focus-within:outline-brass" : ""
                    }`}
                  >
                    <dt className={CARD_HEADER}>
                      {href ? (
                        <Link href={href} className="after:absolute after:inset-0 after:content-[''] focus:outline-none">
                          {label}
                          <span aria-hidden="true" className="ml-1">&rarr;</span>
                        </Link>
                      ) : (
                        label
                      )}
                    </dt>
                    <dd className="px-3 py-2.5">
                      <div className={`break-words text-[14px] font-semibold ${value ? "text-ink" : "font-normal text-mute-soft"}`}>
                        {value || "Not set"}
                      </div>
                      {value && sub ? <p className="text-[12px] text-mute">{sub}</p> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {expanded ? (
            <div className="space-y-5">
              {section(
                "Association",
                <>
                  {field(
                    "display_name",
                    "Display name",
                    profile.display_name,
                    text("display_name", { required: true }),
                    P,
                  )}
                  {field(
                    "legal_name",
                    "Legal name",
                    profile.legal_name,
                    text("legal_name", { required: true }),
                    P,
                  )}
                  {field(
                    "ein",
                    "EIN",
                    profile.ein,
                    text("ein", { placeholder: "00-0000000" }),
                    P,
                  )}
                  {field(
                    "incorporated_on",
                    "Incorporated on",
                    day(profile.incorporated_on),
                    text("incorporated_on", { type: "date" }),
                    P,
                  )}
                  {field(
                    "fiscal_year_end_month",
                    "Fiscal year ends",
                    MONTHS[profile.fiscal_year_end_month - 1],
                    <select
                      id="fiscal_year_end_month"
                      name="fiscal_year_end_month"
                      defaultValue={String(profile.fiscal_year_end_month)}
                      className={INPUT}
                    >
                      {MONTHS.map((m, i) => (
                        <option key={m} value={i + 1}>
                          {m}
                        </option>
                      ))}
                    </select>,
                    P,
                  )}
                  {field(
                    "capitalization_threshold",
                    "Capitalization threshold",
                    [
                      money(String(profile.capitalization_threshold)),
                      profile.capitalization_threshold_source,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                    <div className="space-y-1.5">
                      {text("capitalization_threshold", {
                        type: "number",
                        min: 0,
                        step: "0.01",
                      })}
                      <input
                        name="capitalization_threshold_source"
                        aria-label="Threshold source"
                        placeholder="Source (optional)"
                        defaultValue={
                          profile.capitalization_threshold_source ?? ""
                        }
                        className={INPUT}
                      />
                    </div>,
                    P,
                  )}
                </>,
              )}

              {section(
                "Address",
                editing && P ? (
                  <>
                    {field(
                      "street_address",
                      "Street address",
                      null,
                      text("street_address", {
                        placeholder: "2158 N. Damen Ave",
                      }),
                      P,
                      true,
                    )}
                    {field("city", "City", null, text("city"), P)}
                    {field("county", "County", null, text("county"), P)}
                    {field(
                      "state_code",
                      "State",
                      null,
                      text("state_code", {
                        required: true,
                        maxLength: 2,
                        placeholder: "IL",
                      }),
                      P,
                    )}
                    {field(
                      "postal_code",
                      "ZIP code",
                      null,
                      text("postal_code", { inputMode: "numeric" }),
                      P,
                    )}
                  </>
                ) : (
                  <>
                    {field("street_address", "Address", address, null, P, true)}
                    {field("county", "County", profile.county, null, P)}
                  </>
                ),
              )}

              {section(
                "Building",
                <>
                  {field(
                    "year_built",
                    "Year built",
                    profile.year_built,
                    text("year_built", {
                      type: "number",
                      min: 1700,
                      max: 2100,
                    }),
                    P,
                  )}
                  {field(
                    "stories",
                    "Stories",
                    profile.stories,
                    text("stories", { type: "number", min: 1, max: 200 }),
                    P,
                  )}
                  {field(
                    "roof_replaced_year",
                    "Roof last replaced",
                    profile.roof_replaced_year,
                    text("roof_replaced_year", {
                      type: "number",
                      min: 1700,
                      max: 2100,
                    }),
                    P,
                  )}
                  {field(
                    "construction_type",
                    "Construction",
                    CONSTRUCTION_TYPES.find(
                      (c) => c.value === profile.construction_type,
                    )?.label ?? null,
                    <select
                      id="construction_type"
                      name="construction_type"
                      defaultValue={profile.construction_type ?? ""}
                      className={INPUT}
                    >
                      <option value="">Not sure</option>
                      {CONSTRUCTION_TYPES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>,
                    P,
                  )}
                </>,
                { id: "building-details" },
              )}

              {section(
                "Insurance",
                <>
                  {field(
                    "master_policy",
                    "Master policy",
                    master ? (
                      <Link
                        href="/insurance"
                        className="underline underline-offset-2"
                      >
                        {[master.carrier, master.policyNumber && `#${master.policyNumber}`]
                          .filter(Boolean)
                          .join(" ")}
                        , renews {day(master.renews)}
                      </Link>
                    ) : (
                      <Link
                        href="/insurance"
                        className="underline underline-offset-2"
                      >
                        None recorded yet
                      </Link>
                    ),
                    null,
                    false,
                  )}
                  {field(
                    "replacement_cost_estimate",
                    "Cost to rebuild",
                    [
                      money(facts.replacement_cost_estimate),
                      facts.replacement_cost_as_of
                        ? `as of ${day(facts.replacement_cost_as_of)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" ") || null,
                    <div className="space-y-1.5">
                      <input
                        id="replacement_cost_estimate"
                        name="replacement_cost_estimate"
                        inputMode="decimal"
                        placeholder="$2,400,000"
                        defaultValue={facts.replacement_cost_estimate ?? ""}
                        className={INPUT}
                      />
                      <input
                        id="replacement_cost_as_of"
                        name="replacement_cost_as_of"
                        type="date"
                        aria-label="Estimate as of"
                        defaultValue={facts.replacement_cost_as_of ?? ""}
                        className={INPUT}
                      />
                    </div>,
                    F,
                  )}
                  {field(
                    "replacement_cost_source",
                    "Estimate came from",
                    facts.replacement_cost_source &&
                      facts.replacement_cost_source !== "unknown"
                      ? REPLACEMENT_COST_SOURCES.find(
                          (s) => s.value === facts.replacement_cost_source,
                        )?.label
                      : null,
                    <select
                      id="replacement_cost_source"
                      name="replacement_cost_source"
                      defaultValue={facts.replacement_cost_source ?? "unknown"}
                      className={INPUT}
                    >
                      {REPLACEMENT_COST_SOURCES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>,
                    F,
                  )}
                  {field(
                    "flood_zone",
                    "Flood zone",
                    !facts.flood_zone
                      ? null
                      : facts.flood_zone === "unknown"
                        ? "Not sure"
                        : `Zone ${facts.flood_zone}`,
                    <select
                      id="flood_zone"
                      name="flood_zone"
                      defaultValue={facts.flood_zone ?? ""}
                      className={INPUT}
                    >
                      <option value="">Not answered</option>
                      {FLOOD_ZONES.map((z) => (
                        <option key={z} value={z}>
                          {z === "unknown" ? "Not sure" : `Zone ${z}`}
                        </option>
                      ))}
                    </select>,
                    F,
                  )}
                  {field(
                    "has_boiler",
                    "Boiler or central heat",
                    yesNo(facts.has_boiler),
                    yn("has_boiler"),
                    F,
                  )}
                  {field(
                    "has_elevator",
                    "Elevator",
                    yesNo(facts.has_elevator),
                    yn("has_elevator"),
                    F,
                  )}
                  {field(
                    "has_sprinklers",
                    "Sprinklers",
                    yesNo(facts.has_sprinklers),
                    yn("has_sprinklers"),
                    F,
                  )}
                  {field(
                    "manager_handles_funds",
                    "Who handles the money",
                    facts.manager_handles_funds === true
                      ? facts.management_company || "A management company"
                      : facts.manager_handles_funds === false
                        ? "The board"
                        : null,
                    <div className="space-y-1.5">
                      <select
                        id="manager_handles_funds"
                        name="manager_handles_funds"
                        defaultValue={yesNoValue(facts.manager_handles_funds)}
                        className={INPUT}
                      >
                        <option value="">Not sure</option>
                        <option value="no">The board</option>
                        <option value="yes">A management company</option>
                      </select>
                      <input
                        name="management_company"
                        aria-label="Management company name"
                        placeholder="Company name (optional)"
                        defaultValue={facts.management_company ?? ""}
                        className={INPUT}
                      />
                    </div>,
                    F,
                  )}
                </>,
                {
                  action: canEditFacts ? (
                    <button
                      type="button"
                      onClick={() => setUploading((v) => !v)}
                      aria-expanded={uploading}
                      className="rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-paper hover:bg-ink-mid"
                    >
                      {uploading ? "Close" : "Upload policy"}
                    </button>
                  ) : null,
                  note: (
                    <div className="mt-1 space-y-3">
                      <p className="text-[12px] text-mute">
                        Upload your master policy and Walkup reads it, whether it is a PDF, a Word document or photos of
                        the pages. You review every value before anything is saved, and it lands on the{" "}
                        <Link href="/insurance" className="underline underline-offset-2">
                          Insurance tab
                        </Link>
                        . You can change any field here afterwards.
                      </p>
                      {uploading ? (
                        <div className="rounded-md border border-line bg-paper p-3">
                          <ImportUploader
                            aiOn={aiOn}
                            mode="policy"
                            label="Choose the policy"
                          />
                        </div>
                      ) : null}
                      {suggestion ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper px-3 py-2 text-[13px] text-ink">
                          <span>
                            Your policy insures the building for{" "}
                            <strong>{money(master?.buildingLimit ?? null)}</strong>
                            {master?.valuation && master.valuation !== "unknown"
                              ? ` (${VALUATION_WORDS[master.valuation] ?? master.valuation})`
                              : ""}
                            . Use it as the cost to rebuild?
                          </span>
                          <button
                            type="button"
                            onClick={useSuggestion}
                            className="rounded-md border border-line-strong px-3 py-1 text-[12px] font-medium text-ink hover:bg-fill"
                          >
                            Use it
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ),
                },
              )}

              <div>
                {section(
                  "Who owners write to",
                  <>
                    {field(
                      "board_contact_name",
                      "Board contact",
                      profile.board_contact_name,
                      text("board_contact_name", { maxLength: 120 }),
                      P,
                    )}
                    {field(
                      "board_contact_email",
                      "Email",
                      profile.board_contact_email,
                      text("board_contact_email", {
                        type: "email",
                        maxLength: 254,
                      }),
                      P,
                    )}
                    {field(
                      "board_contact_phone",
                      "Phone",
                      profile.board_contact_phone,
                      text("board_contact_phone", {
                        type: "tel",
                        maxLength: 40,
                      }),
                      P,
                    )}
                  </>,
                )}
              </div>

              <div className="rounded-lg border border-line bg-fill/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink">
                      Tax information
                    </h3>
                    <p className="mt-0.5 text-[12px] text-mute">
                      Read only. Edit these on the Taxes tab.
                    </p>
                  </div>
                  <Link
                    href="/tax"
                    className="text-[13px] font-medium text-ink underline underline-offset-2"
                  >
                    Edit in Taxes
                  </Link>
                </div>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    [
                      "Accountant",
                      tax.accountantName
                        ? [tax.accountantName, tax.accountantFirm].filter(Boolean).join(", ")
                        : null,
                      "/tax#accountant",
                    ],
                    ["Accountant email", tax.accountantEmail, "/tax#accountant"],
                    [
                      "How 1099s are filed",
                      tax.filingMethod === "paper"
                        ? "On paper"
                        : tax.filingMethod === "electronic"
                          ? "Electronically (IRIS)"
                          : null,
                      "/tax",
                    ],
                    ["Illinois SOS file number", tax.sosFileNumber, "/tax#sos-file-number"],
                  ].map(([label, value, href]) => (
                    <div key={label} className="min-w-0 rounded-md border border-line bg-paper px-3 py-2">
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">
                        {label}
                      </dt>
                      <dd className={`break-words text-[13px] ${value ? "text-ink" : "text-mute-soft"}`}>
                        {value || (
                          <Link href={href as string} className="underline underline-offset-2">
                            Not set. Add in Taxes
                          </Link>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              {!editing ? (
                <p className="text-[12px] text-mute">
                  More building facts for the coverage check are on{" "}
                  <Link
                    href="/insurance/facts"
                    className="underline underline-offset-2"
                  >
                    Insurance
                  </Link>
                  .{" "}
                  <Link
                    href="/repairs/emergency-info"
                    className="underline underline-offset-2"
                  >
                    Emergency information
                  </Link>
                </p>
              ) : null}
            </div>
          ) : null}

          {state && "error" in state ? (
            <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
              {state.error}
            </p>
          ) : null}

          {editing ? (
            <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-line bg-paper px-5 py-3">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className={btnPrimary}
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
