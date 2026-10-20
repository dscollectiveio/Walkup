"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * A password field with a show/hide eye. The outer margin of `className`
 * (the mt-* classes the auth inputs carry) moves to the wrapper so the icon
 * stays centred on the field. Defaults to hidden, and goes back to hidden if
 * the page is restored from history, so a password isn't left on screen.
 */
export function PasswordInput({ className = "", ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  const margin = className.match(/(?:^|\s)(mt-\S+)/)?.[1] ?? "";
  const inputClass = className.replace(/(?:^|\s)mt-\S+/g, "");
  const Icon = shown ? EyeOff : Eye;

  return (
    <div className={`relative ${margin}`}>
      <input {...props} type={shown ? "text" : "password"} className={`${inputClass} pr-11`} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-mute hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brass"
      >
        <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
      </button>
    </div>
  );
}
