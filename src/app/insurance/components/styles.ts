// Class strings for the insurance area (insurance-spec §9): one copy, so every
// screen's inputs and buttons look and size the same (44 px hit targets).

export const inputClass =
  "mt-1 block min-h-[44px] w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink disabled:opacity-60";

export const labelClass = "block text-[12px] font-medium text-ink";

export const helpClass = "mt-1 text-[12px] text-mute";

export const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50";

export const btnGhost =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-50";

export const btnDanger =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-bad-line bg-bad-tint px-4 text-[13px] font-medium text-bad-text hover:opacity-90 disabled:opacity-50";

export const linkClass = "font-medium text-ink underline underline-offset-2";

/** The action-error block (§11.4): directly above the button that failed. */
export const errorBlock = "border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text";

export const warningBlock = "border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-[13px] text-warning-text";

export const infoBlock = "border-l-[3px] border-info bg-info-tint px-3 py-2 text-[13px] text-info-text";

/** Native <dialog>: centred on desktop, a full-screen sheet on phones (§11.6). */
export const dialogClass =
  "m-0 h-[100dvh] max-h-none w-full max-w-none bg-paper p-0 text-ink backdrop:bg-ink/40 sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:w-[min(36rem,calc(100vw-2rem))] sm:rounded-xl sm:border sm:border-line sm:shadow-xl";
