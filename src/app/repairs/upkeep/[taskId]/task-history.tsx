"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { btnDanger, btnPrimary, btnSecondary, errorClass, inputClass, labelClass, linkClass } from "@/components/repairs/styles";
import { humanDate, moneyText } from "@/lib/repairs/format";
import { deleteUpkeepLog, updateUpkeepLog } from "../../upkeep-actions";

export interface LogRow {
  id: string;
  doneOn: string;
  cost: string | null;
  vendorId: string | null;
  vendorName: string | null;
  note: string | null;
  ticket: { id: string; reference: number } | null;
}

/**
 * One upkeep job's history (repairs-spec §12.3 card 3): a table on wide
 * screens, cards on phones. The board corrects a row in place (the trigger
 * works the schedule out again); a board admin deletes. Owners see no cost
 * and no contractor.
 */
export function TaskHistory(props: {
  rows: LogRow[];
  seesMoney: boolean;
  isBoard: boolean;
  isAdmin: boolean;
  vendors: { id: string; name: string }[];
  todayIso: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  if (props.rows.length === 0) return <p className="text-[13px] text-mute">Not done yet.</p>;
  const cols = props.seesMoney;
  return (
    <div>
      <table className="hidden w-full text-left text-[13px] sm:table">
        <thead>
          <tr className="border-b border-line text-[12px] text-mute">
            <th scope="col" className="py-2 pr-3 font-medium">
              Done on
            </th>
            {cols ? (
              <th scope="col" className="py-2 pr-3 font-medium">
                Who
              </th>
            ) : null}
            {cols ? (
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Cost
              </th>
            ) : null}
            <th scope="col" className="py-2 pr-3 font-medium">
              Note
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Problem
            </th>
            {props.isBoard ? (
              <th scope="col" className="py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {props.rows.map((r) =>
            editing === r.id ? (
              <tr key={r.id}>
                <td colSpan={6} className="py-3">
                  <EditLog row={r} vendors={props.vendors} todayIso={props.todayIso} onDone={() => setEditing(null)} />
                </td>
              </tr>
            ) : (
              <tr key={r.id} className="align-top">
                <th scope="row" className="py-2 pr-3 font-normal text-ink">
                  {humanDate(r.doneOn, props.todayIso)}
                </th>
                {cols ? <td className="py-2 pr-3 text-ink">{r.vendorName ?? ""}</td> : null}
                {cols ? <td className="figures py-2 pr-3 text-right text-ink">{r.cost ? moneyText(r.cost) : ""}</td> : null}
                <td className="py-2 pr-3 text-mute">{r.note ?? ""}</td>
                <td className="py-2 pr-3">
                  {r.ticket ? (
                    <Link href={`/maintenance/${r.ticket.id}`} className={linkClass}>
                      #{r.ticket.reference}
                    </Link>
                  ) : null}
                </td>
                {props.isBoard ? (
                  <td className="py-1">
                    <RowActions row={r} isAdmin={props.isAdmin} onEdit={() => setEditing(r.id)} />
                  </td>
                ) : null}
              </tr>
            ),
          )}
        </tbody>
      </table>

      <ul className="divide-y divide-line sm:hidden">
        {props.rows.map((r) => (
          <li key={r.id} className="space-y-1 py-3 text-[13px]">
            {editing === r.id ? (
              <EditLog row={r} vendors={props.vendors} todayIso={props.todayIso} onDone={() => setEditing(null)} />
            ) : (
              <>
                <p className="font-medium text-ink">
                  {humanDate(r.doneOn, props.todayIso)}
                  {cols && r.cost ? <span className="figures font-normal"> · {moneyText(r.cost)}</span> : null}
                </p>
                {cols && r.vendorName ? <p className="text-mute">{r.vendorName}</p> : null}
                {r.note ? <p className="text-mute">{r.note}</p> : null}
                {r.ticket ? (
                  <Link href={`/maintenance/${r.ticket.id}`} className={linkClass}>
                    Problem #{r.ticket.reference}
                  </Link>
                ) : null}
                {props.isBoard ? <RowActions row={r} isAdmin={props.isAdmin} onEdit={() => setEditing(r.id)} /> : null}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RowActions({ row, isAdmin, onEdit }: { row: LogRow; isAdmin: boolean; onEdit: () => void }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onEdit} className="inline-flex min-h-[44px] items-center text-[13px] text-ink underline underline-offset-2">
          Edit
        </button>
        {isAdmin && !confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex min-h-[44px] items-center text-[13px] text-bad-text underline underline-offset-2"
          >
            Delete
          </button>
        ) : null}
      </div>
      {confirming ? (
        <div className="space-y-2 rounded-lg border border-bad-line bg-bad-tint px-3 py-3">
          <p className="text-[13px] text-bad-text">Delete this entry? The next due date will be worked out again from what&rsquo;s left.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              className={btnDanger}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await deleteUpkeepLog(row.id);
                  if ("error" in r) setError(r.error);
                  else router.refresh();
                })
              }
            >
              {pending ? "Deleting…" : "Delete"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={btnSecondary}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className={errorClass}>{error}</p> : null}
    </div>
  );
}

function EditLog({ row, vendors, todayIso, onDone }: { row: LogRow; vendors: { id: string; name: string }[]; todayIso: string; onDone: () => void }) {
  const router = useRouter();
  const fid = useId();
  const [doneOn, setDoneOn] = useState(row.doneOn);
  const [cost, setCost] = useState(row.cost ?? "");
  const [vendorId, setVendorId] = useState(row.vendorId ?? "");
  const [note, setNote] = useState(row.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Keep a contractor who has since been archived selectable on their own row.
  const options = row.vendorId && !vendors.some((v) => v.id === row.vendorId) ? [{ id: row.vendorId, name: row.vendorName ?? "Their contractor" }, ...vendors] : vendors;
  return (
    <div className="space-y-3 rounded-lg border border-line bg-fill/40 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${fid}-on`} className={labelClass}>
            Done on
          </label>
          <input id={`${fid}-on`} type="date" max={todayIso} value={doneOn} onChange={(e) => setDoneOn(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`${fid}-cost`} className={labelClass}>
            Cost
          </label>
          <input id={`${fid}-cost`} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className={`figures ${inputClass}`} />
        </div>
        <div>
          <label htmlFor={`${fid}-who`} className={labelClass}>
            Who did it
          </label>
          <select id={`${fid}-who`} value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={inputClass}>
            <option value="">Not recorded</option>
            {options.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${fid}-note`} className={labelClass}>
            Note
          </label>
          <input id={`${fid}-note`} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className={btnPrimary}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await updateUpkeepLog(row.id, { done_on: doneOn, cost: cost.trim() || null, vendor_id: vendorId || null, note: note.trim() || null });
              if ("error" in r) setError(r.error);
              else {
                onDone();
                router.refresh();
              }
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className={btnSecondary}>
          Cancel
        </button>
      </div>
      {error ? <p className={errorClass}>{error}</p> : null}
    </div>
  );
}
