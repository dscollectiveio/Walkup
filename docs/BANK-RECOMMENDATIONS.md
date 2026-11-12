# Bank transaction recommendations: how they work, and a review

Written 2026-11-12 from the code as it stands (uncommitted work included). Nothing here changes behaviour.

## 1. What a recommendation is

When a bank transaction has no category yet, the Bank Feed shows a **Recommended** chip on the row, for example `✓ Utilities`, with a short reason under it. It is a suggestion only. Nothing is written to the database or the ledger until a board admin clicks it.

It is **entirely rule-based and deterministic**. There is no AI model, no Plaid category, and no learning beyond counting what your board did before. The same transaction and the same history always give the same answer.

Code: `src/lib/plaid/recommend.ts` (the decision), `suggest.ts` (keyword guesses), `similar.ts` (payee matching), `dedupe.ts` (rules), `supabase/migrations/0046` (the history table), `src/app/bank-feed/transactions-table.tsx` and `transaction-row.tsx` (the chips and bulk buttons).

## 2. The order of decisions

For each row that is not yet categorized, not posted and not retracted, `recommend()` tries these in order and stops at the first that answers:

| # | Source | Chip look | Needs a pick? | Posts in "Post all N recommended"? |
|---|---|---|---|---|
| 0 | **A saved rule** (not a recommendation: applied during sync) | Row arrives already categorized, "rule" tag, shows under Ready to post | no | only if the rule has auto_post and a board admin ran Sync now |
| 1 | **Duplicate guard** | Amber, "Already recorded · not for the books" | no | yes |
| 2 | **History**: your board filed this payee before | Filled blue | only if the past choice had no account or unit | yes |
| 3 | **Keyword guess** | Outlined blue, "a guess from the description" | for transfers and dues, always | no. Separate "Post the N guesses" |
| 4 | **Word overlap** with an account name (part of the keyword step) | same as 3 | no | no, same as 3 |
| 5 | Nothing | no chip | | |

### 2.0 Saved rules (before any of this)
A rule is "payee contains X, so file as Y". During every sync (manual or the daily cron), each new row is matched against the saved rules, first match wins (oldest rule first). A match fills in the category and records `rule_id` so the row shows a "rule" tag. Only a manual Sync now by a board admin may also **post** rows whose rule has `auto_post`; the cron never posts. Rules are only created from the form after the second filing of a payee, with an explicit yes. Chips, "x" and "Post all" never create a rule (DECISIONS #29).

### 2.1 History (the strongest source)
- **The key.** The description is lowercased, digits, `#` and `*` removed, other punctuation removed, spaces collapsed. "COMED 8841 10/03" and "ComEd *9120" both become `comed`. Under three letters is too short to match. The database has the same function (`bank_payee_key`) and a test keeps them identical.
- **Direction matters.** The key also includes money in versus money out, so a vendor refund is not filed like a payment to them.
- **The tally.** `bank_payee_history` holds one row per association, payee key, direction and exact choice (kind, account, unit) with a count and a running total of amounts. A database trigger keeps it current whenever a row is categorized, changed, un-categorized or retracted, so the page reads a few dozen rows and never re-counts thousands of transactions. Rows for zero dollars do not count.
- **The pick.** For a payee and direction, the **most frequent choice wins**. Ties keep the first row seen.
- **The reason shown:** "you filed this payee the same way N times before" (once, twice, N times).
- **Needs a pick** when the winning choice is `dues` without a unit, or an expense, income or transfer without an account.

### 2.2 Duplicate guard (inside the history branch)
If history says "dues for unit U", the amount is money in, and Dues has a **hand-recorded** payment (check, cash or other, never a bank posting) for the same unit and the same amount within ±10 days, the recommendation becomes **"Not for the books"** (`excluded`) with the reason "looks like the $X you recorded by hand on Mon D, already in the books". This prevents counting the same dues twice. It applies to that one row only and does not sweep in other rows from the same payee.

### 2.3 Keyword guesses (`suggest.ts`)
Used only when history has no answer. Checked in this order:
1. **Transfer**: description matches `transfer`, `webxfr`, `chasbk` or `xfer`, in either direction. Always needs a pick of the other account.
2. **Money in**: if it matches `deposit`, `zelle` or `ach credit`, guess **Dues**, and the treasurer must pick the unit. Otherwise try word overlap against income account names, and give nothing if none overlaps.
3. **Money out**: walk a fixed table of patterns, first hit wins, and only if the association has an account with that exact name:
   - ComEd, electric: Utilities
   - water: Utilities
   - Nicor, gas company: Utilities
   - West Bend, insurance: Insurance
   - Home Depot, Lowe's, Ace Hardware: Repairs & Maintenance
   - landscaping, snow removal, lawn: Landscaping / Snow Removal
   - janitorial, cleaning service: Janitorial
   - tax service, attorney, law offices, CPA, accounting, community association, management company: Professional Fees
   - Illinois Secretary of State: State Filing Fees
   - chargeback, return item, NSF, service charge, maintenance fee: Bank & Merchant Fees
   Then fall back to **word overlap**: words of three or more letters shared between the description and an expense account name, highest count wins.

The reason shown is "a guess from the description". A keyword transfer says "looks like a move between your own accounts", and a keyword dues guess says "looks like an owner payment, pick the unit".

## 3. What happens when you click

- **Click the chip:** files the category **and posts** the row to the ledger, and also files and posts every other still-uncategorized row with the same payee and direction that is loaded on the page (the chip says "+N more"). Exception: the duplicate chip affects only its own row.
- **"Save for later"** (beside the chip) files without posting.
- **Pending rows:** the chip only saves the category and says it will post once the bank settles it.
- **Needs-a-pick chips** open the form with the kind pre-selected, and do not post.
- **"Post all N recommended"** posts every settled, one-click recommendation from history or the duplicate guard. Keyword guesses are a separate, quieter "Post the N guesses" button, and "also the N guesses" if both exist.
- **Safety nets:** a 10-second Undo (which writes reversing entries, never deletes), and a preview before posting more than ten rows with up to three flags: first-time payees, and amounts more than three times that payee's usual (the usual amount is the mean from the same tally, excluding the row being checked). These are nudges, never blocks.
- **After the second filing** of a payee the same way with no rule yet, the form asks "Always file X as Y?". One yes creates a rule.

## 4. Where things stand in your dev data (2026-11-12)

243 transactions need a category, and there are **6 payees in the tally and 0 rules**. So nearly everything today is a keyword guess or no suggestion, and the history path (the strongest one) has barely started to learn. This improves as your board files rows, or as the real production history is used.

## 5. Review: what is good

- Nothing is ever applied without a click, and history is clearly separated from guesses, in look and in the bulk button.
- The tally is cheap and always consistent with the audited rows, with a database test guarding the key.
- The duplicate guard prevents a real double-counting bug.
- Undo, the large-batch preview and the unusual-amount flags are sensible.
- Rules are never created silently.

## 6. Review: weaknesses and risks, most important first

1. **One past filing is enough to be "backed by your history".** A payee filed once becomes a history recommendation and is included in "Post all N recommended". If that one filing was a mistake, "Post all" repeats it across every future row. There is no minimum count and no confidence level.
2. **Conflicting history is not detected.** If a payee was filed as Utilities 5 times and Repairs 4 times, it recommends Utilities with the reason "same way 5 times", with no mention of the 4. Recency is ignored too, so a payee you recently changed how you file keeps losing to the old habit until the new count overtakes it.
3. **Amount is ignored when choosing.** A payee that sometimes means regular dues and sometimes a special assessment, or a vendor with different kinds of bills, gets one answer. The unusual-amount flag only shows in the preview for bigger batches (more than ten rows), not on a single chip click.
4. **Digits are stripped from the key.** Payees whose names differ only by digits, or that contain digits ("7-Eleven" becomes "eleven", two different "ACH 1099" style payees), can be merged. "Zelle" style descriptions carry the sender's name, which usually keeps them apart, but anything generic ("ONLINE TRANSFER", "DEPOSIT") merges every instance into one payee.
5. **The money-in rule is blunt.** Any description containing "deposit", "zelle" or "ach credit" is guessed as Dues. That includes a mobile check deposit that is really a refund, insurance proceeds or interest. It is only a guess that needs a unit pick, so the harm is small, but it can mislead a new treasurer.
6. **The keyword table is built around one association.** ComEd, Nicor, West Bend and the Illinois Secretary of State are specific to the Chicago building the app was calibrated on. Another association in another state gets mostly the word-overlap fallback. Also the table only works if the account is named **exactly** as listed ("Utilities", "Insurance", and so on). A renamed or customized chart of accounts silently produces no guess.
7. **Word overlap is weak.** It picks the account sharing the most three-letter-plus words and breaks ties by list order. "Service" or "Association" in a description can point to an unrelated account.
8. **Plaid's own category is stored but unused.** `raw_category` is saved on every transaction and not read by the recommender. The code comments say Plaid mis-categorizes some payees (West Bend as Food and Drink), which is a fair reason, but it could still help as a weak tiebreaker for first-time payees.
9. **Rule-filed rows feed the tally.** A rule's choice counts as a filing, so a wrong rule makes its own mistake look like more history.
10. **"+N more" only sees what is loaded.** Same-payee grouping covers rows currently on the page (the list is capped), so a click may file fewer siblings than exist, and the rest wait.
11. **The duplicate guard is narrow.** It needs history already saying "dues for this unit" and an exact amount. A first-time payer, a part payment, or a payment more than ten days apart is not caught.
12. **Transfers are never one-click from keywords.** Fine and safe, but every transfer needs a manual pick of the other account the first time.

## 7. Suggested improvements (not built, for your decision)

- Require at least two matching filings before a history recommendation joins "Post all", and show "filed N times, and M times as something else" when history disagrees.
- Weight recent filings more than old ones.
- Compare the amount with the payee's usual on the chip itself, not only in the batch preview.
- Make the keyword table per-association (editable), or ship a small neutral starter set, and match account names loosely.
- Narrow the money-in "Dues" guess, for example Zelle only, or treat "deposit" as unknown.
- Use Plaid's category as a low-confidence hint for first-time payees.
- Tests exist for recommend.ts (13) and suggest.ts (12), plus a database test for key parity. New behaviour would need more.
