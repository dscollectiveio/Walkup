"use client";

import { useMemo, useState } from "react";

interface OverdueUnit {
  id: string;
  label: string;
  ownerName: string | null;
  ownerEmail: string | null;
  owed: number;
}

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

/**
 * Drafts, not sending — same shape as the contractor-message pattern
 * (src/app/contractors/draft-panel.tsx). A mailto: link opens from the
 * board's own mailbox; Walkup never sends on the association's behalf, and
 * nothing here is persisted, unlike contractor messages — a payment
 * reminder isn't correspondence the next board needs a record of the way a
 * contractor negotiation is.
 */
export function ReminderLetterButton({ units }: { units: OverdueUnit[] }) {
  const [open, setOpen] = useState(false);
  const [unitId, setUnitId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const unit = units.find((u) => u.id === unitId);

  const mailto = useMemo(() => {
    if (!unit?.ownerEmail) return null;
    return `mailto:${encodeURIComponent(unit.ownerEmail)}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
  }, [unit, subject, body]);

  function selectUnit(id: string) {
    setUnitId(id);
    const u = units.find((x) => x.id === id);
    if (!u) return;
    setSubject(`Outstanding balance — ${u.label}`);
    setBody(
      `Hi ${u.ownerName ?? "there"},\n\n` +
        `This is a reminder that ${u.label} has an outstanding balance of ${money(u.owed)}. ` +
        `Please arrange payment when you're able.\n\n` +
        `Thanks,\nThe board`,
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill"
      >
        Send a reminder letter
      </button>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-line bg-paper p-5">
      <div>
        <label htmlFor="reminder_unit" className="block text-[12px] font-medium text-ink">
          Which unit?
        </label>
        <select
          id="reminder_unit"
          value={unitId}
          onChange={(e) => selectUnit(e.target.value)}
          className="mt-1 w-full max-w-sm rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
        >
          <option value="">Choose…</option>
          {units.map((u) => (
            <option key={u.id} value={u.id} disabled={!u.ownerEmail}>
              {u.label} — {money(u.owed)}
              {u.ownerEmail ? "" : " (no email on file)"}
            </option>
          ))}
        </select>
      </div>

      {unit ? (
        <>
          <div>
            <label htmlFor="reminder_subject" className="block text-[12px] font-medium text-ink">
              Subject
            </label>
            <input
              id="reminder_subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
            />
          </div>
          <div>
            <label htmlFor="reminder_body" className="block text-[12px] font-medium text-ink">
              Message
            </label>
            <textarea
              id="reminder_body"
              rows={7}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] leading-relaxed text-ink"
            />
          </div>
        </>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {mailto ? (
          <a
            href={mailto}
            className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid"
          >
            Open in your email app
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
