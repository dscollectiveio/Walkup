# Signal theme on Walkup's palette — what changed and why

Applied 2026-10-01 from `walkup-signal-theme-prompt.md`. Theming only: no
layout, copy, routes, data or behavior changed. Token *names* (`ink`,
`paper`, `bone`, `fill`, `line`, `mute`, …) are unchanged, so no consumer
churned; the values now come from CSS variables that flip with
`<html data-theme="dark">`.

## Survey findings that corrected the prompt's premises

| Item | Prompt assumed | Found |
|---|---|---|
| Fonts | Fraunces + Figtree | **Avenir Next** system stack only (no web font loaded). Nothing to remove. |
| Token source | unknown | `src/app/globals.css` `@theme` block; zero Tailwind config file (v4). |
| Dark mode | unknown | None existed. |
| Hardcoded colors outside tokens | risk surface | 22 literals in 3 files: `components/mark.tsx` (logo, 13), `financial-statements/pdf-document.tsx` (PDF, 7), `lib/tax/pdf.ts` (PDF, 2). Left as-is: the logo is a fixed asset and PDFs print on white. |
| Charts | library? | Hand-rolled SVG reading `var(--color-*)`; flips with the theme for free. |
| Radii | mixed | `rounded-md` 209, `rounded-lg` 167, `rounded-full` 91, `rounded-xl` 53, `rounded` 31, `rounded-t-[11px]` 6, `rounded-sm` 5. |
| Shadows | mixed | `shadow-lg` 5, `shadow-sm` 2, `shadow-xl` 1, `shadow` 1 — all on menus/toasts/dialogs; cards had none. |
| Third-party UI | ? | None (lucide-react icons, react-plaid-link only). |
| Email templates | ? | None exist; `mailto:` drafts only. |

## Mechanism

- `:root` holds the light set as `--w-*`; `[data-theme="dark"]` overrides it.
- Tailwind `@theme inline` maps `--color-ink: var(--w-ink)` etc., so `bg-ink` reads the variable at runtime.
- Fonts: `next/font/google` — Hanken Grotesk 400/500/600/700 as `--font-hanken`, JetBrains Mono 500 as `--font-jetbrains` (`src/app/layout.tsx`).
- Pre-paint script in `<head>` applies `localStorage["walkup.theme"]`, else `prefers-color-scheme`.
- Toggle: `src/components/sidebar/theme-toggle.tsx`, in the existing user row.
- Radius scale remapped (`--radius-xl: 8px`, `--radius-lg/md: 6px`, `--radius-sm: 4px`), so existing classes land on Signal's values without edits. Navy header bands `rounded-t-[11px]` → `[7px]` (8px card minus 1px border).
- Shadows: `--shadow-sm: none`; `shadow`/`-lg`/`-xl` all map to one pop shadow (`0 8px 24px rgba(0,0,0,.12)` light, `.5` dark).
- `.figures` → JetBrains Mono 500, tabular, −0.02em. `.eyebrow` added (11px, 600, 0.12em, uppercase).
- Icon stroke 1.75 → 1.6 everywhere (15 sites).

## Dark set, derived from the palette (ratios on `--surface` #14213d unless noted)

| Role (token) | Value | Derivation | Contrast |
|---|---|---|---|
| ground (`bone`) | #0b1222 | navy mixed 45% toward black | — |
| surface (`paper`) | #14213d | the sidebar navy | — |
| surface-2 (`fill`) | #27334d | navy +8% white | — |
| border (`line`) | #354058 | navy +14% white | — |
| border-strong (`line-strong`) | #565f73 | navy +28% white | — |
| text (`ink`) | #f4f2ed | the cream ground | 14.3:1 (11.3 on fill) |
| text-muted (`mute`) | #9fa3aa | cream 38% toward navy | 6.3:1 (5.0 on fill) |
| accent / ok (`moss`, `good`) | #86b2a0 | green +42% white | 6.8:1 |
| ok-soft (`good-tint`) / ok-text (`good-text`) | #193143 / #c1d7ce | green 82% toward navy / +70% white | text on soft 8.9:1 |
| danger (`rust`, `bad`) | #d0897e | brick +38% white | 5.8:1 |
| danger-soft / danger-text | #31273a / #eacac5 | | 9.3:1 |
| warning / soft / text | #d3ad78 / #33343d / #ecdcc5 | gold family | 7.6:1 / 9.2:1 |
| info (`slate`) / soft / text | #8c9bb7 / #1a2b4d / #c4ccda | slate +45% white | 5.7:1 / 8.7:1 |
| chart line (`series-1`) | #96a5be | slate +50% white | 6.4:1 |
| gold (`brass`) | #c08a3e | unchanged | 5.3:1 |
| nav bg | #0b1222 | = ground | — |
| primary button (`bg-ink`/`text-paper`) | cream fill, navy text | the band inverts | 14.3:1 |

Light-mode checks: `mute` darkened one step (#6e7385 → #62677a) so it passes
4.9:1 on paper and 4.1:1 on fill (was 3.9:1 on fill). `good-text` on
`good-tint` 7.5:1; paper on ink 16:1; `ondark-mute` on ink 6.5:1.

No new hue was introduced: every value above is a mix of navy, cream,
white/black, green, gold, brick red or slate.

## Minor adjustments beyond token swaps (veto any)

1. Card titles are eyebrow labels (shared `Card` plus the 7 inline card `<h2>`s on Home and Bank Feed). Section headings inside pages (Taxes, Insurance, dialog titles) stay as headings.
2. Headings keep weight **700**, not Signal's 600 — Doug chose bold over semibold earlier.
3. Navy header bands on cards are kept (Doug asked for them this week); the eyebrow sits in white on the band. In dark mode the band inverts to cream with navy text, matching the primary button rule.
4. The `Answer` banner keeps its left status rule — it is a documented brand signature (`ui.tsx`), not a border.
5. The sidebar keeps its collapsible icon-rail mode (also Doug's request); it got its own `nav-*` tokens so the band inversion never recolors it.
6. Focus ring now brass (was slate) so it reads in both modes.

## Not done / out of scope

- Screenshots of signed-in routes: Home and the rest sit behind MFA; verified on the login/MFA page in both modes and by computed styles. Please eyeball each route once signed in.
- PDF and logo colors untouched (see table).
- No test asserted a color or class that changed.
