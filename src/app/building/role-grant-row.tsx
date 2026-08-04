"use client";

import { useState, useTransition } from "react";
import { revokeRole } from "./actions";

export interface RoleGrantRecord {
  id: string;
  personName: string;
  role: string;
  grantedOn: string;
  expiresOn: string | null;
  revokedAt: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  board_admin: "Board admin",
  board_member: "Board member",
  accountant: "Accountant",
  owner: "Owner",
};

function status(grant: RoleGrantRecord): { label: string; className: string } {
  if (grant.revokedAt) return { label: "Revoked", className: "text-mute-soft" };
  const today = new Date().toISOString().slice(0, 10);
  if (grant.expiresOn && grant.expiresOn < today) {
    return { label: "Expired", className: "text-mute-soft" };
  }
  return { label: "Active", className: "text-good-text" };
}

export function RoleGrantRow({ grant }: { grant: RoleGrantRecord }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startRevoke] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { label, className } = status(grant);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <span className="text-[13px] font-medium text-ink">{grant.personName}</span>
        <span className="ml-2 text-[12px] text-mute">{ROLE_LABEL[grant.role] ?? grant.role}</span>
        <span className={`ml-2 text-[11px] ${className}`}>{label}</span>
        <div className="mt-0.5 text-[11px] text-mute-soft">
          Granted {grant.grantedOn}
          {grant.expiresOn ? ` · expires ${grant.expiresOn}` : ""}
        </div>
      </div>
      {!grant.revokedAt ? (
        <div className="flex shrink-0 items-center gap-2">
          {confirming ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startRevoke(async () => {
                    setError(null);
                    const result = await revokeRole(grant.id);
                    if (result.error) setError(result.error);
                    else setConfirming(false);
                  })
                }
                className="rounded-md border border-bad-line bg-bad-tint px-2.5 py-1 text-[11px] font-medium text-bad-text hover:bg-bad-tint/80"
              >
                {pending ? "Revoking…" : "Confirm revoke"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-[12px] text-mute underline-offset-2 hover:underline"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-[12px] text-bad-text underline-offset-2 hover:underline"
            >
              Revoke
            </button>
          )}
        </div>
      ) : null}
      {error ? <p className="w-full text-[11px] text-bad-text">{error}</p> : null}
    </li>
  );
}
