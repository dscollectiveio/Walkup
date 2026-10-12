// The three class strings every control on the admin page shares. A plain
// module (not "use client") so the server page and the client panels read
// the same ones.

export const inputClass = "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink";
export const btn = "min-h-[44px] rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-50";
export const primary = "min-h-[44px] rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50";
export const smallBtn = "min-h-[36px] rounded-md border border-line-strong bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill disabled:opacity-50";
