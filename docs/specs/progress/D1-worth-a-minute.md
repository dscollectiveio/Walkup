# D1: "Worth a minute today" redesign (lead engineer, at Doug's request, 2026-10-14)

Done outside the build workflow, before X1-integration. X1: build on this, don't revert it.

- `src/components/home/worth-a-minute.tsx` is now a card of small cards
  (navy header like Coming up / Where the association stands, count chip
  "{n} to look at · {k} needs attention", up to 3 item cards in a responsive
  grid, the rest under a "Show {n} more" `<details>` list). With no items it
  renders a single compact "All clear today" row; `src/app/page.tsx` passes
  `emptyNote` instead of rendering its own green/grey strips.
- `src/lib/home/urgent-items.ts` no longer slices to 3: it returns every item
  sorted by severity; `WORTH_A_MINUTE_VISIBLE = 3` controls what shows in full.
  Several delinquent units are grouped into one item. Copy tightened, no em
  dashes (a unit test enforces it).
- New tones/labels live in `TONE` (bad = "Needs attention", warning = "When you
  can"). When repairs-spec §18.2 adds keys, add them to `UrgentItem["key"]` and
  the `ICONS` map; keep titles short and `why` to one or two sentences.
- Tests: `tests/unit/urgent-items.test.ts` (new) and `urgent-items-sync.test.ts` pass.
