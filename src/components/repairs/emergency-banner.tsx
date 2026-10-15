import {
  buildingFactLines,
  EMERGENCY_GUIDANCE,
  type BuildingEmergencyInfo,
  type EmergencyKind,
} from "@/lib/repairs/emergency";

/**
 * The safety steps for an emergency (repairs-spec §7.4). Static copy from
 * EMERGENCY_GUIDANCE, never model-written; the only building-specific lines
 * are facts the board entered. Client-safe (no hooks): the report form
 * renders it inside its polite live region (`live`), the ticket page as a
 * labelled region.
 */

export interface EmergencyContact {
  name: string;
  label: string | null;
  phone: string;
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function smsHref(phone: string): string {
  return `sms:${phone.replace(/[^\d+]/g, "")}`;
}

export interface EmergencyContractor {
  name: string;
  phone: string;
  trades: string[];
  preferred: boolean;
}

/** The banner's "Your board says they take emergency calls": at most three for the rule's trade, preferred first. */
export function contractorsForTrade(list: EmergencyContractor[], trade: string): { name: string; phone: string }[] {
  return list
    .filter((c) => c.trades.includes(trade))
    .sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map(({ name, phone }) => ({ name, phone }));
}

export function EmergencyBanner(props: {
  kind: EmergencyKind;
  building: BuildingEmergencyInfo | null;
  /** Owners: shown under the steps. */
  contacts?: EmergencyContact[];
  /** Board viewers only: saved contractors with emergency_service whose trades include the rule's trade (at most 3). */
  boardContractors?: { name: string; phone: string }[];
  /** Report form: rendered inside the polite live region, so no region role of its own. */
  live?: boolean;
  /** Extra controls under the steps (the report form's "Is this happening right now?", the board's "Not an emergency"). */
  children?: React.ReactNode;
}) {
  const g = EMERGENCY_GUIDANCE[props.kind];
  const facts = buildingFactLines(props.kind, props.building);
  const contacts = props.contacts ?? [];
  const contractors = (props.boardContractors ?? []).slice(0, 3);

  return (
    <div
      {...(props.live ? {} : { role: "region", "aria-label": "Safety steps" })}
      className="border-l-[3px] border-bad bg-bad-tint px-4 py-3 text-bad-text"
    >
      <p className="text-[15px] font-bold">{g.headline}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed">
        {g.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>

      {facts.length > 0 ? (
        <div className="mt-3 text-[13px]">
          <p className="font-medium">In your building:</p>
          <ul className="mt-1 space-y-0.5">
            {facts.map((f) => (
              <li key={f.label}>
                {f.label}:{" "}
                {f.tel ? (
                  <a href={f.tel} className="font-medium underline underline-offset-2">
                    {f.text}
                  </a>
                ) : (
                  f.text
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {g.callHref && g.callLabel ? (
        <a
          href={g.callHref}
          className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-bad px-4 text-[14px] font-medium text-paper sm:w-auto"
        >
          {g.callLabel}
        </a>
      ) : null}

      {contacts.length > 0 ? (
        <div className="mt-3 text-[13px]">
          <p className="font-medium">Board contacts:</p>
          <ul className="mt-1 space-y-0.5">
            {contacts.map((c) => (
              <li key={`${c.name}-${c.phone}`}>
                {c.name}
                {c.label ? ` (${c.label})` : ""}:{" "}
                <a href={telHref(c.phone)} className="font-medium underline underline-offset-2">
                  {c.phone}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {contractors.length > 0 ? (
        <div className="mt-3 text-[13px]">
          <p className="font-medium">Your board says they take emergency calls</p>
          <ul className="mt-1 space-y-1">
            {contractors.map((c) => (
              <li key={`${c.name}-${c.phone}`}>
                <a href={telHref(c.phone)} className="font-medium underline underline-offset-2">
                  Call {c.name} {c.phone}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {props.children ? <div className="mt-3">{props.children}</div> : null}

      <p className="mt-3 text-[12px]">General safety steps, the same for every building.</p>
    </div>
  );
}
