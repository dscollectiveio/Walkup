"use client";

import { useActionState } from "react";
import { devSignIn } from "./actions";

/**
 * Development-only shortcut. Rendered only when the server has confirmed
 * NODE_ENV is not production AND the DEV_AUTH_* variables are present, so this
 * component never reaches a deployed build.
 *
 * It performs a real Supabase password sign-in — the resulting session is an
 * ordinary JWT and every RLS policy applies to it. Nothing here weakens
 * authorization; it only removes the typing.
 */
export function DevSignIn() {
  const [state, action, pending] = useActionState(
    async () => await devSignIn(),
    null,
  );

  return (
    <div className="mt-8 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-amber-900">
        Development only
      </p>
      <p className="mt-1 text-xs leading-relaxed text-amber-800">
        Signs in as <code>walkup-dev@dscollective.io</code> — a real account
        with a real token, so row-level security applies normally. Delete it
        before any real financial data exists.
      </p>

      {state?.error ? (
        <p className="mt-2 text-xs font-medium text-red-800">{state.error}</p>
      ) : null}

      <form action={action}>
        <button
          type="submit"
          disabled={pending}
          className="mt-3 w-full rounded border border-amber-400 bg-white px-3 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
        >
          {pending ? "Signing in…" : "Sign in as dev user"}
        </button>
      </form>
    </div>
  );
}
