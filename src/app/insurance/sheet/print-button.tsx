"use client";

/** "Print or save as PDF" (§9.12): the browser's own print dialog. Hidden when printing. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid print:hidden"
    >
      Print or save as PDF
    </button>
  );
}
