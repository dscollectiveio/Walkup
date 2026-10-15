// Shared class strings for Repairs pages (repairs-spec §16): 44px tap
// targets, 16px inputs on phones so iOS doesn't zoom, the same buttons as
// the foundation's DraftEmail. Pure; server and client components import it.

export const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-60";
export const btnSecondary =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-60";
export const btnDanger =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-bad-line bg-paper px-4 py-2 text-[13px] font-medium text-bad-text hover:bg-bad-tint disabled:opacity-60";
export const btnLink =
  "inline-flex min-h-[44px] items-center text-[13px] font-medium text-ink underline underline-offset-2 hover:text-ink-mid disabled:opacity-60";
export const inputClass =
  "mt-1 block w-full min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 py-2 text-[16px] text-ink sm:text-[14px]";
export const textareaClass =
  "mt-1 block w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[16px] text-ink sm:text-[14px]";
export const labelClass = "block text-[13px] font-medium text-ink";
export const hintClass = "mt-1 text-[12px] text-mute";
export const errorClass = "text-[13px] text-bad-text";
export const linkClass = "text-ink underline-offset-2 hover:underline";
/** A radio or checkbox row with a full-height tap target. */
export const choiceRow = "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 text-[14px] text-ink has-[:checked]:border-ink";
