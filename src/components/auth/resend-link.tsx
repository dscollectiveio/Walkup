"use client";

import { useState, useTransition } from "react";
import { resendConfirmation } from "@/app/login/actions";

/** "Send the confirmation email again" — used after sign-up and on sign-in. */
export function ResendLink({ email, className = "" }: { email: string; className?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className={className}>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await resendConfirmation(email);
            setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "Sent — check your inbox." });
          })
        }
        className="font-semibold underline underline-offset-2 disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send it again"}
      </button>
      {msg ? <span className={`ml-2 ${msg.ok ? "" : "text-bad-text"}`}>{msg.text}</span> : null}
    </span>
  );
}
