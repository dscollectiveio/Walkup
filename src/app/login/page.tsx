"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, null);

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Walkup</h1>
      <p className="mt-1 text-sm text-stone-500">
        Sign in to your association&rsquo;s books.
      </p>

      <form action={action} className="mt-8 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="mt-1 w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        {state?.error ? (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded bg-stone-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-50"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
