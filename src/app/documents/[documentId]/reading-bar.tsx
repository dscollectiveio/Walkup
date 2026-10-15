"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { IndeterminateBar } from "@/components/ai/indeterminate-bar";

/**
 * Shown while Walkup is still reading a file: the same sliding bar as the
 * contractor search, and a refresh every three seconds (while the tab is in
 * view) so the summary appears the moment it is written. Renders nothing once
 * the page stops asking for it.
 */
export function ReadingBar({ label }: { label: string }) {
  const router = useRouter();
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 3000);
    return () => window.clearInterval(t);
  }, [router]);
  return <IndeterminateBar label={label} />;
}
