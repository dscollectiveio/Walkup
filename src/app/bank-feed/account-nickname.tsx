"use client";

import { useRef, useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { setBankAccountNickname } from "./actions";

/**
 * An account's name on the balances card, with a quiet way to give it a
 * nickname. The nickname leads and the bank's own name stays beside it in
 * small type; the pencil only shows when hovering or focusing the row, and
 * only for people who can rename. Enter or leaving the box saves, Esc cancels,
 * and an empty box takes the nickname away.
 */
export function AccountNickname({
  connectionId,
  plaidAccountId,
  bankName,
  nickname,
  canRename,
}: {
  connectionId: string;
  plaidAccountId: string;
  bankName: string;
  nickname: string | null;
  canRename: boolean;
}) {
  const [saved, setSaved] = useState(nickname);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  function commit(value: string) {
    const next = value.trim() || null;
    setEditing(false);
    if (next === saved) return;
    const prev = saved;
    setSaved(next);
    setError(null);
    start(async () => {
      const r = await setBankAccountNickname(
        connectionId,
        plaidAccountId,
        next ?? "",
      );
      if (r.error) {
        setSaved(prev);
        setError(r.error);
      }
    });
  }

  if (editing) {
    return (
      <span className="min-w-0 flex-1">
        <input
          ref={input}
          autoFocus
          defaultValue={saved ?? ""}
          maxLength={40}
          placeholder={bankName}
          aria-label={`Nickname for ${bankName}`}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            if (cancelled.current) {
              cancelled.current = false;
              setEditing(false);
            } else commit(e.currentTarget.value);
          }}
          className="w-full min-w-0 rounded border border-line-strong bg-paper px-1.5 py-0.5 text-[16px] text-ink sm:text-[13px]"
        />
      </span>
    );
  }

  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span
        className="min-w-0 break-words text-[13px] text-ink sm:truncate"
        title={saved ? `${saved} (${bankName})` : bankName}
      >
        {saved ?? bankName}
      </span>
      {saved ? (
        <span className="hidden shrink-0 text-[11px] text-mute-soft sm:inline">
          {bankName}
        </span>
      ) : null}
      {canRename ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => setEditing(true)}
          aria-label={saved ? `Rename ${saved}` : `Give ${bankName} a nickname`}
          title={saved ? "Rename" : "Add a nickname"}
          className="shrink-0 self-center rounded p-1 text-mute-soft opacity-100 hover:text-ink focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass sm:opacity-0 sm:group-hover/acct:opacity-100 sm:group-focus-within/acct:opacity-100"
        >
          <Pencil size={12} strokeWidth={1.6} aria-hidden="true" />
        </button>
      ) : null}
      {error ? (
        <span className="text-[11px] text-bad-text">{error}</span>
      ) : null}
    </span>
  );
}
