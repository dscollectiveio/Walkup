"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { markRepairsSeen } from "@/app/maintenance/actions";

/**
 * Two small client islands for /repairs (repairs-spec §2.2, §15.1): record
 * this visit once (the server render already used the previous one), and
 * remember the problems layout per viewer. The URL always wins over the
 * remembered layout; storage can fail (private mode) and is then ignored.
 */

const LAYOUT_KEY = "walkup.repairs.layout";

export function MarkSeen() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void markRepairsSeen();
  }, []);
  return null;
}

export function LayoutMemory({ layout, fromUrl, boardHref }: { layout: "list" | "board"; fromUrl: boolean; boardHref: string }) {
  const router = useRouter();
  useEffect(() => {
    try {
      if (fromUrl) {
        window.localStorage.setItem(LAYOUT_KEY, layout);
        return;
      }
      if (window.localStorage.getItem(LAYOUT_KEY) === "board" && layout === "list") router.replace(boardHref);
    } catch {
      // No storage: the default layout stands.
    }
  }, [layout, fromUrl, boardHref, router]);
  return null;
}
