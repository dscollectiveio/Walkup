"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { refreshGoogle } from "../vendor-actions";

/**
 * Google's rating goes stale after 30 days (repairs-spec §10.2, map bug 8).
 * The profile renders this only when the rating is stale, a key exists and
 * the viewer is on the board: it asks for a refresh once, after the page has
 * shown, then reloads the page's data. A failure shows nothing; the old
 * figure stays with its date.
 */
export function GoogleRefresh({ vendorId }: { vendorId: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    // Once per mount, even under Strict Mode's double effect.
    if (started.current) return;
    started.current = true;
    refreshGoogle(vendorId)
      .then((r) => {
        if (r.ok && r.refreshed) router.refresh();
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  }, [vendorId, router]);

  if (!busy) return null;
  return (
    <span role="status" className="text-mute">
      {" · Updating from Google…"}
    </span>
  );
}
