"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StillWorking } from "@/components/repairs/sheet";
import { btnPrimary, btnSecondary, errorClass, inputClass, labelClass } from "@/components/repairs/styles";
import { humanDate } from "@/lib/repairs/format";
import { readCertificate, setInsuredUntil } from "../vendor-actions";

/**
 * "Read the certificate" (repairs-spec §10.8): Walkup reads a certificate of
 * insurance PDF's text (tax IDs redacted first) and offers the general
 * liability end date; the board confirms with "Use it". Nothing is written
 * until then. Scans can't be read; the board enters the date by hand.
 */
export function CertificateReader(props: { vendorId: string; documents: { id: string; filename: string }[]; todayIso: string }) {
  const router = useRouter();
  const fid = useId();
  const [docId, setDocId] = useState(props.documents[0]?.id ?? "");
  const [found, setFound] = useState<{ date: string | null; insurer: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [reading, startRead] = useTransition();
  const [saving, startSave] = useTransition();

  if (props.documents.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg border border-line px-4 py-3">
      {props.documents.length > 1 ? (
        <div>
          <label htmlFor={`${fid}-doc`} className={labelClass}>
            Certificate to read
          </label>
          <select id={`${fid}-doc`} value={docId} onChange={(e) => setDocId(e.target.value)} className={inputClass}>
            {props.documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.filename}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-[13px] text-mute">{props.documents[0].filename}</p>
      )}
      {found ? (
        found.date ? (
          <div className="space-y-2">
            <p className="text-[13px] text-ink">
              The certificate says general liability runs until {humanDate(found.date, props.todayIso)}
              {found.insurer ? ` (${found.insurer})` : ""}. Use this date?
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving}
                className={btnPrimary}
                onClick={() =>
                  startSave(async () => {
                    setError(null);
                    const r = await setInsuredUntil(props.vendorId, found.date!);
                    if ("error" in r) setError(r.error);
                    else {
                      setSaved(found.date);
                      setFound(null);
                      router.refresh();
                    }
                  })
                }
              >
                {saving ? "Saving…" : "Use it"}
              </button>
              <button type="button" onClick={() => setFound(null)} className={btnSecondary}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-mute">Walkup couldn&rsquo;t find a general liability end date on it. Enter the date by hand with Edit details.</p>
        )
      ) : (
        <button
          type="button"
          disabled={reading || !docId}
          className={btnSecondary}
          onClick={() =>
            startRead(async () => {
              setError(null);
              setSaved(null);
              const r = await readCertificate(docId);
              if ("error" in r) setError(r.error);
              else setFound({ date: r.insuredUntil, insurer: r.insurer });
            })
          }
        >
          {reading ? "Reading…" : "Read the certificate"}
        </button>
      )}
      {reading ? <StillWorking /> : null}
      {saved ? (
        <p role="status" className="text-[13px] text-good-text">
          Saved. Insured until {humanDate(saved, props.todayIso)}.
        </p>
      ) : null}
      {error ? <p className={errorClass}>{error}</p> : null}
    </div>
  );
}
