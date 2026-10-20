# Walkup design system

Approved by Doug, 2026-10-19. The visual version is `docs/design-system.html`
(open it in a browser; it has a light/dark switch). The values here are copied
from the app's own tokens (`src/app/globals.css`) and shared styles
(`src/components/ui.tsx`, `src/components/repairs/styles.ts`,
`src/components/section-header.ts`). If the app and this document disagree, fix
the one that is wrong and say so in the commit.

## 1. Principles

- **Plain English first, number second.** A sentence says what is true ("You're
  all paid up"); the figure supports it. The reader is a volunteer board member
  doing this in the evening.
- **Calm and warm.** Cream ground, white cards, navy structure, gold as the one
  accent. No shadows on cards, no gradients, nothing decorative that carries no
  meaning.
- **Show your work.** Every number can be traced. Status is never carried by
  color alone; it always has words.
- **Never clever with money.** Walkup prepares and reminds; the board decides.
  Copy and controls never imply Walkup moves money or sends email unapproved.
- **Everyone can use it.** Contrast 4.5:1 or better, a visible gold focus ring on
  everything, 44px touch targets on forms, motion that respects "reduce motion".

## 2. Color

Always use the token (a Tailwind utility such as `bg-ink`, `text-mute`), never a
hex value, so dark mode works. Never write `#D9A441`; write `bg-brass`.

| Token | Light | Use |
|---|---|---|
| `ink` | #1B2A41 navy | text, primary buttons, header bands |
| `ink-mid` | #283B5A | hover on navy |
| `brass` | #D9A441 gold | the one accent: header edges, focus ring, open or current things, bars |
| `on-brass` | #1B2A41 | text on a gold fill (always navy) |
| `bone` | #F5EFE3 cream | the page |
| `paper` | #FFFFFF | cards |
| `fill` | #ECE5D6 | nested panels, bar tracks, hover |
| `line` | #E3DED3 | hairlines and dividers |
| `line-strong` | #CDC6B6 | input borders, secondary buttons |
| `mute` | #5B6475 | secondary text (6.1:1 on white) |
| `mute-soft` | #8E93A3 | optional/disabled hints only |
| `eyebrow` | #8A5F12 | gold labels on cream (gold itself fails contrast as text) |

**Status families** (`good`, `warning`, `bad`, `info`, `neutral`): each has
`-tint` (fill), `-line` (border/rule) and `-text`. Always pair a tint with its own
text color. Gold is the warning family's rule color.

**Data series, in order:** navy blue `#2D4A7C`, gold `#D9A441`, green `#2F7A5C`,
brick `#A3432F`, slate `#5B6475`, light blue `#8FA3C4`, violet `#7A5C99`,
teal `#3F8FA3`.

**Rules for gold.** It marks things that are current or chosen: the left edge of a
header, the open unit, the current quarter, the focus ring, the Additional
Agreed Assessments bar. It is never body text on cream, and text on a gold fill is
always navy. Paid-progress bars are green; gold bars are for the assessment only.

## 3. Typography

One typeface: **Outfit** (via `next/font`, `--font-outfit`). No serif, no
monospace. The wordmark is Outfit Medium, -3% tracking.

| Role | Style |
|---|---|
| Page title (`h1`) | 20px, bold, `tracking-tight`, `text-ink`; subtitle `mt-1 text-mute` |
| Section title (eyebrow) | `.eyebrow`: 13px, weight 900, uppercase, +7% tracking |
| Headline answer | 18px bold, in the status text color |
| Body | 14px (13px in dense cards) |
| Secondary | 12 to 13px, `text-mute` |
| Small label | 11px, uppercase, +6% tracking, `text-mute` |
| Figures (money, counts) | `.figures`: weight 600, tabular lining numerals |

Form inputs are 16px on phones (no iOS zoom) and 14px on larger screens. Sentence
case everywhere except eyebrow labels. Big headline numbers are rare; the Total
bank balance is 22px so its header matches the Transactions header.

## 4. Layout, spacing and shape

- **Sidebar:** 288px open, 72px rail (forced under 1024px), drawer under 768px.
  White; the selected tab is navy with white text. The collapse button is full
  width with a divider above it.
- **Top bar:** 56px navy band, sticky. Help and Sign out are underlined text links;
  the gold initials circle opens Your account.
- **Page width:** content centered, up to 860px for forms and account pages and
  1100px for dashboards.
- **Card:** white, 1px `line` border, 8px radius (12px for unit cards), no
  shadow; body padding `px-5 py-4`.
- **Shape:** cards 8px, nested panels and inputs 6 to 8px, buttons 6px, pills round.
- **Depth:** only floating things (menus, dialogs, toasts) get the one soft
  shadow. An opened unit card gets a medium shadow to show it is active.
- **Spacing:** steps of 4, 8, 12, 16, 20, 24. Sections of a page 24px apart;
  cards inside a card 16px apart.
- **Dividers:** a thin `line` between sections of one card; a summary row and the
  list under it are separated by a divider with 20px above and below.

## 5. Headers (four levels)

The rule: the page-level card gets the strong navy band; anything inside a card
gets a soft tint with a gold edge.

1. **Page card header:** `<Card navy title="…" hint="…" action={…}>`. Navy band
   (`band bg-ink`, `px-5 py-3`, about 4rem tall on the Dashboard), eyebrow title, muted hint, light buttons on it. Stays navy in
   dark mode (a lighter, bluer navy).
2. **Section header:** `SECTION_HEADER` (`src/components/section-header.ts`): 7%
   navy tint, 3px gold left edge, 12px bold uppercase. For sections inside a
   card (The unit, People in this unit, Association, Location, Building).
3. **Summary card header:** `CARD_HEADER`: the same bar at 11px, for small
   summary cards (Building details, Insurance policy, Owner).
4. **Item header:** the same bar at a 14% tint, used when the header carries
   content and controls (each unit on the Dues tab).

## 6. Buttons

Shared classes live in `src/components/repairs/styles.ts` and `ui.tsx`. Use them;
do not write a new long class string for an existing role.

| Role | Class | Look |
|---|---|---|
| Primary | `btnPrimary` | navy, white text, 44px |
| Secondary | `btnSecondary` | white, strong border, navy text, 44px |
| Danger (the confirm step) | `btnDanger` | white, brick border and text, 44px |
| Link | `btnLink` | underlined text |
| On a navy band | `HEADER_BUTTON` | light button, navy text |
| Dense (inside cards) | same colors at 32px or 28px | only where the surrounding row is itself clickable |
| Panel toggle | navy dense button; the open one gets `ring-2 ring-brass` | one panel open at a time |
| Expand / Collapse | navy dense button with a chevron | |

- One primary action per area. Labels are sentence case verbs a person would say
  ("Record a payment", "Take them off this unit"), never a bare "Submit".
- **Destructive actions are two steps, inline:** a small red text link, then a
  plain-words warning plus a Confirm button and Cancel. Never a pop-up.
- Disabled is 60% opacity. The gold focus ring is never removed.

## 7. Forms and inputs

- Label above the box (`labelClass`: 13px medium); help text 12px `text-mute` below
  (`hintClass`); errors 13px `text-bad-text` next to the box (`errorClass`), focus
  moves to the first problem. Optional fields say "optional" in soft text.
- Inputs: `inputClass` (44px, 1px strong border, 8px radius, white fill).
- **Dollar boxes** use `MoneyInput`: format as you type ($5,400, cents allowed);
  the form saves the plain number. **Whole numbers** use `IntegerInput`
  (1,250). **Bathrooms** use `BathroomsInput` (always one decimal: 1.0, 2.5).
  **Addresses** use `AddressInput` (suggestions, a Unit / Apt box, a USPS check,
  always overridable). Money and numbers are right-aligned in their boxes.
- Two to four options that switch a mode are a pill-shaped segmented control
  (selected = navy). Radios and checkboxes use a full 44px row (`choiceRow`).

## 8. Status and feedback

- **Answer banner** (`<Answer status headline detail>`): sentence first, a 3px
  status-colored left rule, square corners, tinted fill.
- **Pills:** standing pills use the status tint and text pairs; "Required" is a
  navy pill, "Voluntary" is neutral; a share or percentage is a translucent gold
  bubble (`bg-brass/20`, `border-brass/40`).
- **Errors** are a bad-tinted bar with a left rule and a sentence that says how to
  fix it. **Empty states** are one calm sentence and one next step.

## 9. Data display

- **Dues year bar:** four quarters (green `bg-good`); money paid fills Q1 first;
  the current quarter has a gold ring; "behind" counts only fully passed quarters.
  Collapsed version: the same four segments, thin (6px), with tiny Q labels.
- **Additional Agreed Assessments:** one gold bar, always a different color from the
  dues bar and never part of it.
- **Tables:** money right-aligned with `.figures`; a zero in a table cell is a dash,
  not $0.00; column headers 11px uppercase `text-mute`.

## 10. Patterns

- **Collapsible unit card (Dues):** one per row, full width, item header, condensed
  strip when closed; open shows details left, panel buttons right, bars below.
- **Accordion:** only one item open at a time (units on Building & Owners); the
  open one is lit on the building graphic with a soft gold wash.
- **Edit in place:** Edit opens the form in the card (the card grows taller). Save is
  navy, Cancel is plain text. Nothing saves until Save.
- **Where things live:** setting up and changing live on a tab's own page; Your
  account (the gold circle) holds profile, plan, security and data. Walkup's own
  billing is never in the sidebar.

## 11. Motion

Color and border changes 300ms; bars grow over 500ms; the sidebar slides 160ms;
landing sections fade and rise over 800ms. Animation shows what changed, never
decorates, and drops to none under "reduce motion".

## 12. Dark mode

Cream and navy swap roles. Navy bands stay navy (`.band` re-scopes the tokens).
Status colors lighten until they pass contrast (`docs/reference/signal-theme.md`).
Never write a color value in a component; use a token and both themes work.

## 13. Copy and content

- **No em dashes** in anything a person reads. Use a period, comma or colon.
- Plain words, short sentences, say what happens next; say who ("a board admin
  can...", "only the board sees...").
- Walkup never says it moves, holds or sends money. Email is "sent only after a
  board admin approves it"; everything else is a draft in your own mail app.
- Money in dollars with commas ($5,400), cents only when they matter. Dates written
  out (June 1, 2026), Chicago time.
- Tab names: Dashboard, Announcements, Bank Feed & Transactions, Financial
  Statements, Budget & Spending, HOA Dues, Taxes, Insurance, Building & Owners,
  Repairs & Upkeep, Find a Contractor, Documents.

## 14. Accessibility checklist

Visible 2px gold focus ring everywhere; contrast 4.5:1 for text and 3:1 for large
text and control edges; 44px targets on forms and primary actions; every control
labeled; toggles use `aria-expanded`; segmented controls are a `radiogroup`; nothing
important by color alone.

## 15. Marketing site (the exceptions)

Landing bands rotate (taupe hero, then blue, taupe, white). Gold buttons have navy
text. The header is sticky with a dividing line and sections fade in on scroll.
Same typeface, same tokens, same plain voice as the app.

## 16. Decisions recorded (2026-10-19)

1. Two header strengths: sections 7%, items 14%.
2. Two button heights: 44px on forms, 28 to 32px inside dense cards.
3. Expand/Collapse buttons are navy; Your account keeps its pill tab strip.
4. Buttons on a navy band are light with navy text.
5. Gold is the only accent; paid-progress bars are green.
6. Older pages are brought in line with this document.

## 17. Checklist for any new page or change

- Top-level cards are `Card navy`; inside a card use `SECTION_HEADER` / `CARD_HEADER`.
- Buttons use the shared classes; no new long button class strings.
- No hex colors, no em dashes, no removed focus rings, money in `.figures`.
- Page title and subtitle in the standard style; copy in plain English.
- Check it in light and dark.
