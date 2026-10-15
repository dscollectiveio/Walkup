"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addMeToo, createTicket } from "@/app/maintenance/actions";
import {
  contractorsForTrade,
  EmergencyBanner,
  type EmergencyContact,
  type EmergencyContractor,
} from "@/components/repairs/emergency-banner";
import { StickyActions } from "@/components/repairs/sheet";
import {
  btnPrimary,
  btnSecondary,
  choiceRow,
  errorClass,
  hintClass,
  inputClass,
  labelClass,
  textareaClass,
} from "@/components/repairs/styles";
import { TicketPhotoPicker, type HeldPhoto } from "@/components/repairs/ticket-photo-picker";
import { detectEmergency, type BuildingEmergencyInfo, type EmergencyKind } from "@/lib/repairs/emergency";
import { PRIORITY_LABEL, type TicketPriority } from "@/lib/repairs/labels";
import { uploadTicketPhotos } from "@/lib/repairs/photos";
import { similarOpenTickets } from "@/lib/repairs/similar";

/**
 * The report form (repairs-spec §5.2). The emergency rules run here as the
 * person types (no network) and again in createTicket; an emergency is only
 * recorded when the reporter says it's happening now. The reporter never
 * picks a trade. Photos are prepared on the phone and uploaded after the
 * problem exists; a failed photo never undoes the report.
 */

const PRIORITIES: TicketPriority[] = ["low", "normal", "urgent"];

export function ReportForm(props: {
  units: { id: string; label: string }[];
  openTickets: { id: string; reference: number; title: string; unit_id: string | null }[];
  building: BuildingEmergencyInfo | null;
  contacts: EmergencyContact[];
  boardContractors: EmergencyContractor[];
  isBoard: boolean;
}) {
  const router = useRouter();
  const ids = {
    title: useId(),
    where: useId(),
    whereHint: useId(),
    detail: useId(),
    description: useId(),
    access: useId(),
    accessHint: useId(),
    urgencyHint: useId(),
  };
  // One key per form: a retried submit finds the problem the first one made.
  const [clientKey] = useState(() => crypto.randomUUID());
  const [now] = useState(() => new Date());

  const [title, setTitle] = useState("");
  const [where, setWhere] = useState<string>("shared");
  const [detail, setDetail] = useState("");
  const [description, setDescription] = useState("");
  const [access, setAccess] = useState("");
  const [chosenPriority, setChosenPriority] = useState<TicketPriority | null>(null);
  const [notNowFor, setNotNowFor] = useState<EmergencyKind | null>(null);
  const [photos, setPhotos] = useState<HeldPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meToo, setMeToo] = useState<Record<string, "pending" | "done" | string>>({});

  const rule = useMemo(() => detectEmergency(`${title} ${description} ${detail}`, now), [title, description, detail, now]);
  const happeningNow = rule !== null && notNowFor !== rule.kind;
  const priority: TicketPriority = chosenPriority ?? (happeningNow ? "urgent" : "normal");

  const similar = useMemo(
    () => (title.trim().length >= 4 ? similarOpenTickets({ title, where }, props.openTickets) : []),
    [title, where, props.openTickets],
  );

  // Ask before leaving while photos are still uploading (the browser shows its own words).
  useEffect(() => {
    if (!progress) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [progress]);

  const unitChosen = where !== "shared";
  // An owner with one unit sees it second, right after "Shared area"; the board sees every unit.
  const unitOptions = props.units;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await createTicket({
      clientKey,
      title,
      description,
      where,
      location_detail: detail,
      access_notes: access,
      priority,
      emergencyConfirmed: happeningNow,
    });
    if ("error" in r) {
      setError(r.error);
      setBusy(false);
      return;
    }
    let failed = 0;
    if (photos.length > 0) {
      setProgress(`Uploading photo 1 of ${photos.length}…`);
      const result = await uploadTicketPhotos(
        r.ticketId,
        photos.map((p) => p.file),
        (i, n) => setProgress(`Uploading photo ${i} of ${n}…`),
      );
      failed = result.failed.length;
      setProgress(null);
    }
    router.push(`/maintenance/${r.ticketId}?reported=1${failed > 0 ? `&failed=${failed}` : ""}`);
  }

  async function seeingToo(id: string) {
    setMeToo((m) => ({ ...m, [id]: "pending" }));
    const r = await addMeToo(id, null);
    setMeToo((m) => ({ ...m, [id]: "error" in r ? r.error : "done" }));
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {/* Always in the DOM. A newly shown emergency is announced as an alert. */}
      <div>
        {rule ? (
          happeningNow ? (
            <div role="alert">
              <EmergencyBanner
                live
                kind={rule.kind}
                building={props.building}
                contacts={props.contacts}
                boardContractors={props.isBoard ? contractorsForTrade(props.boardContractors, rule.trade) : undefined}
              >
                <NowQuestion kind={rule.kind} onNotNow={() => setNotNowFor(rule.kind)} />
              </EmergencyBanner>
            </div>
          ) : (
            <div role="status" className="border-l-[3px] border-line-strong bg-fill px-4 py-3 text-[13px] text-ink">
              <p>
                Thanks. We won&rsquo;t mark it urgent. If anything changes, the safety steps are here.{" "}
                <button type="button" onClick={() => setNotNowFor(null)} className="min-h-[44px] underline underline-offset-2">
                  It is happening now
                </button>
              </p>
              <details className="mt-2">
                <summary className="min-h-[44px] cursor-pointer font-medium underline underline-offset-2">Show the safety steps</summary>
                <div className="mt-2">
                  <EmergencyBanner
                    live
                    kind={rule.kind}
                    building={props.building}
                    contacts={props.contacts}
                    boardContractors={props.isBoard ? contractorsForTrade(props.boardContractors, rule.trade) : undefined}
                  />
                </div>
              </details>
            </div>
          )
        ) : null}
      </div>

      <div>
        <label htmlFor={ids.title} className={labelClass}>
          What&rsquo;s wrong?
        </label>
        <input
          id={ids.title}
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Water stain on the hallway ceiling"
          className={inputClass}
          disabled={busy}
        />
      </div>

      <div>
        <label htmlFor={ids.where} className={labelClass}>
          Where is it?
        </label>
        <select
          id={ids.where}
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          className={inputClass}
          disabled={busy}
          aria-describedby={unitChosen && !props.isBoard ? ids.whereHint : undefined}
        >
          <option value="shared">Shared area (hallway, roof, basement, outside)</option>
          {unitOptions.map((u) => (
            <option key={u.id} value={u.id}>
              Inside {u.label}
            </option>
          ))}
        </select>
        {unitChosen && !props.isBoard ? (
          <p id={ids.whereHint} className={hintClass}>
            Depending on your declaration, some problems inside a unit are the owner&rsquo;s to fix. The board will let you know.
          </p>
        ) : null}
      </div>

      {similar.length > 0 ? (
        <section className="rounded-xl border border-line bg-paper px-4 py-3" aria-label="Already reported?">
          <h2 className="text-[14px] font-bold text-ink">Already reported?</h2>
          <p className="mt-1 text-[13px] text-mute">If it&rsquo;s one of these, you don&rsquo;t need a new report.</p>
          <ul className="mt-2 divide-y divide-line">
            {similar.map((t) => {
              const state = meToo[t.id];
              const shared = props.openTickets.find((o) => o.id === t.id)?.unit_id === null;
              return (
                <li key={t.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <Link href={`/maintenance/${t.id}`} className="text-[14px] text-ink underline-offset-2 hover:underline">
                    #{t.reference} {t.title}
                  </Link>
                  {shared ? (
                    state === "done" ? (
                      <span className="text-[13px] text-good-text">
                        Added. The board can see that you&rsquo;re seeing it too.{" "}
                        <Link href={`/maintenance/${t.id}`} className="underline underline-offset-2">
                          Go to #{t.reference}
                        </Link>
                      </span>
                    ) : (
                      <span className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => seeingToo(t.id)}
                          disabled={state === "pending" || busy}
                          className={btnSecondary}
                        >
                          {state === "pending" ? "Saving…" : "I'm seeing this too"}
                        </button>
                        {state && state !== "pending" ? <span className={errorClass}>{state}</span> : null}
                      </span>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div>
        <label htmlFor={ids.detail} className={labelClass}>
          Where exactly? <span className="font-normal text-mute">(optional)</span>
        </label>
        <input
          id={ids.detail}
          maxLength={200}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Back stairwell, 3rd floor landing"
          className={inputClass}
          disabled={busy}
        />
      </div>

      <div>
        <label htmlFor={ids.description} className={labelClass}>
          Anything that would help <span className="font-normal text-mute">(optional)</span>
        </label>
        <textarea
          id={ids.description}
          rows={4}
          maxLength={4000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="When you first noticed it, whether it's getting worse, anything you've already tried."
          className={textareaClass}
          disabled={busy}
        />
      </div>

      <fieldset>
        <legend className={labelClass}>
          Photos <span className="font-normal text-mute">(optional)</span>
        </legend>
        <div className="mt-2">
          <TicketPhotoPicker mode="hold" photos={photos} onChange={setPhotos} disabled={busy} />
        </div>
      </fieldset>

      <fieldset aria-describedby={happeningNow && chosenPriority === null ? ids.urgencyHint : undefined}>
        <legend className={labelClass}>How urgent?</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {PRIORITIES.map((p) => (
            <label key={p} className={choiceRow}>
              <input
                type="radio"
                name="priority"
                value={p}
                checked={priority === p}
                onChange={() => setChosenPriority(p)}
                disabled={busy}
                className="h-4 w-4"
              />
              {PRIORITY_LABEL[p]}
            </label>
          ))}
        </div>
        {happeningNow && chosenPriority === null ? (
          <p id={ids.urgencyHint} className={hintClass}>
            We&rsquo;ve marked this urgent because of what you described. You can change it.
          </p>
        ) : null}
      </fieldset>

      <div>
        <label htmlFor={ids.access} className={labelClass}>
          Access and timing <span className="font-normal text-mute">(optional)</span>
        </label>
        <textarea
          id={ids.access}
          rows={2}
          maxLength={1000}
          value={access}
          onChange={(e) => setAccess(e.target.value)}
          placeholder="When someone's home, a key with a neighbour, a dog in the unit."
          className={textareaClass}
          aria-describedby={ids.accessHint}
          disabled={busy}
        />
        <p id={ids.accessHint} className={hintClass}>
          {unitChosen ? "Anyone who can see this problem can read this." : "Every owner in the building can read this."}
        </p>
      </div>

      <div className="-mx-4 sm:mx-0">
        <StickyActions>
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? "Sending…" : "Report it"}
          </button>
          <Link href="/repairs" className={btnSecondary} aria-disabled={busy}>
            Cancel
          </Link>
        </StickyActions>
        <div className="space-y-1 px-4 sm:px-0" aria-live="polite">
          {progress ? <p className="text-[13px] text-mute">{progress}</p> : null}
          {error ? <p className={errorClass}>{error}</p> : null}
        </div>
      </div>
    </form>
  );
}

function NowQuestion({ kind, onNotNow }: { kind: EmergencyKind; onNotNow: () => void }) {
  const name = `now-${kind}`;
  return (
    <fieldset className="text-ink">
      <legend className="text-[13px] font-medium text-bad-text">Is this happening right now?</legend>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <label className={`${choiceRow} bg-paper`}>
          <input type="radio" name={name} defaultChecked className="h-4 w-4" />
          Yes
        </label>
        <label className={`${choiceRow} bg-paper`}>
          <input type="radio" name={name} onChange={onNotNow} className="h-4 w-4" />
          No, it&rsquo;s already under control
        </label>
      </div>
    </fieldset>
  );
}
