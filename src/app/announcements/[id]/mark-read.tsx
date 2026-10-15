"use client";

import { useEffect } from "react";
import { markAnnouncementRead } from "../actions";

/** Records that this person opened the announcement, once, when the page shows. Renders nothing. */
export function MarkRead({ id }: { id: string }) {
  useEffect(() => {
    void markAnnouncementRead(id);
  }, [id]);
  return null;
}
