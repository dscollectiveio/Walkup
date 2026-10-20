"use client";

import { btnPrimary } from "@/components/repairs/styles";

/** "Print or save as PDF" (§9.12): the browser's own print dialog. Hidden when printing. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={`${btnPrimary} print:hidden`}
    >
      Print or save as PDF
    </button>
  );
}
