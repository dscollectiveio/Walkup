"use client";

import { InviteToSignIn } from "@/app/building/invite-to-sign-in";

/** One "Invite to sign in" per imported person who has an email and no login (import-spec 9.7). */
export function InviteList({
  people,
  associationName,
  boardContactName,
}: {
  people: { id: string; full_name: string; email: string | null }[];
  associationName: string;
  boardContactName: string | null;
}) {
  return (
    <ul className="divide-y divide-line">
      {people.map((p) => (
        <li key={p.id} className="space-y-2 py-3">
          <p className="text-[13px] font-medium text-ink">
            {p.full_name} <span className="font-normal text-mute">{p.email}</span>
          </p>
          <InviteToSignIn personId={p.id} associationName={associationName} boardContactName={boardContactName} />
        </li>
      ))}
    </ul>
  );
}
