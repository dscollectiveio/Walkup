"use client";

import { useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { Answer } from "@/components/ui";

const EVENT = "walkup:dismissed-banner";

function read(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

/**
 * An Answer banner with an X. Dismissing hides it on this browser until what
 * it is about changes (`signature` names the problems it lists), so a new
 * emergency or urgent problem brings it back. Storage failing just means the
 * banner shows again next time.
 */
export function DismissibleAnswer({
  storageKey,
  signature,
  status,
  headline,
  detail,
}: {
  storageKey: string;
  signature: string;
  status: "good" | "attention" | "bad" | "neutral";
  headline: string;
  detail?: string;
}) {
  const dismissed = useSyncExternalStore(
    (notify) => {
      window.addEventListener(EVENT, notify);
      window.addEventListener("storage", notify);
      return () => {
        window.removeEventListener(EVENT, notify);
        window.removeEventListener("storage", notify);
      };
    },
    () => read(storageKey) === signature,
    () => false,
  );

  if (dismissed) return null;

  return (
    <div className="relative">
      <Answer status={status} headline={headline} detail={detail} />
      <button
        type="button"
        onClick={() => {
          try {
            window.localStorage.setItem(storageKey, signature);
          } catch {
            /* storage unavailable: nothing to remember */
          }
          window.dispatchEvent(new Event(EVENT));
        }}
        aria-label="Dismiss this banner"
        title="Dismiss"
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md text-current opacity-70 hover:bg-ink/10 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
      >
        <X size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * An Answer banner with an X that only lasts for this visit: it comes back the
 * next time the page is opened (nothing is remembered).
 */
export function DismissibleOnceAnswer({
  status,
  headline,
  detail,
  children,
}: {
  status: "good" | "attention" | "bad" | "neutral";
  headline: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <div className="relative">
      <Answer status={status} headline={headline} detail={detail}>
        {children}
      </Answer>
      <button
        type="button"
        onClick={() => setGone(true)}
        aria-label="Dismiss this banner"
        title="Dismiss"
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md text-current opacity-70 hover:bg-ink/10 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
      >
        <X size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
