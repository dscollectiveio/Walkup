"use client";

import { useState, useTransition } from "react";
import { deleteInvite } from "./actions";

export interface InviteRecord {
  id: string;
  token: string;
  role: string;
  email: string | null;
  expiresAt: string;
  redeemedAt: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  board_admin: "Board admin",
  board_member: "Board member",
  accountant: "Accountant",
  owner: "Owner",
};

function status(invite: InviteRecord): { label: string; className: string } {
  if (invite.redeemedAt) return { label: "Joined", className: "text-good-text" };
  if (new Date(invite.expiresAt) < new Date()) {
    return { label: "Expired", className: "text-mute-soft" };
  }
  return { label: "Pending", className: "text-mute" };
}

export function InviteRow({ invite }: { invite: InviteRecord }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { label, className } = status(invite);
  const canRevoke = !invite.redeemedAt;
  const link =
    typeof window !== "undefined" ? `${window.location.origin}/invite/${invite.token}` : "";

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <span className="text-[13px] font-medium text-ink">
          {ROLE_LABEL[invite.role] ?? invite.role}
        </span>
        {invite.email ? <span className="ml-2 text-[12px] text-mute">{invite.email}</span> : null}
        <span className={`ml-2 text-[11px] ${className}`}>{label}</span>
        <div className="mt-0.5 text-[11px] text-mute-soft">
          {invite.redeemedAt
            ? `Joined ${new Date(invite.redeemedAt).toLocaleDateString()}`
            : `Expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!invite.redeemedAt && new Date(invite.expiresAt) >= new Date() ? (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="rounded-md border border-line-strong px-2.5 py-1 text-[11px] text-ink hover:bg-fill"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        ) : null}
        {canRevoke ? (
          confirming ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startDelete(async () => {
                    setError(null);
                    const result = await deleteInvite(invite.id);
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
          )
        ) : null}
      </div>
      {error ? <p className="w-full text-[11px] text-bad-text">{error}</p> : null}
    </li>
  );
}
