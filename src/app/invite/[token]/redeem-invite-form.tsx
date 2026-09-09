"use client";

import { useActionState } from "react";
import { redeemInvite } from "./actions";

export function RedeemInviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(redeemInvite, null);

  return (
    <form action={action} className="mt-8 space-y-4">
      <input type="hidden" name="token" value={token} />

      <div>
        <label htmlFor="full_name" className="block text-[12px] font-medium text-ink">
          Your name
        </label>
        <input
          id="full_name"
          name="full_name"
          required
          className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
        />
      </div>

      {state?.error ? (
        <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-ink px-3 py-2 text-[13px] font-medium text-paper transition hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Joining…" : "Join"}
      </button>
    </form>
  );
}
