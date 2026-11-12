"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { PostingKind } from "./actions";
import type { Pickers } from "./transaction-row";

/** What a category choice sets on the row, all at once. */
export interface CategoryChoice {
  kind: PostingKind;
  accountId: string | null;
  unitId: string | null;
}

export interface CategoryOption extends CategoryChoice {
  id: string;
  /** What the person reads: "Utilities", "Dues · 2B", "Moved to Reserve Cash". */
  label: string;
  group: string;
}

/** Which way the money went decides which groups make sense; "any" is for a mixed selection. */
export type Direction = "in" | "out" | "any";

/** Strip the "6100 " account code so the option reads "Utilities", not "6100 Utilities". */
export function plainName(label: string): string {
  return label.replace(/^\d{3,5}\s+/, "");
}

/**
 * The group for money that moves between the association's own accounts. Named
 * for what a treasurer sees on the statement, so "credit card payment" finds
 * it as readily as "transfer" does (typing matches the group name too).
 */
export const MOVING_MONEY = "Moving money (transfer or card payment)";

/** The group a past or recommended choice is repeated in, at the top of the list. */
export const SUGGESTED = "Suggested for this payee";

/**
 * Every place a transaction can be filed, grouped the way a treasurer thinks
 * about it. Money out never offers dues or other income; money in never
 * offers an expense account. A refund that really is an expense credit is
 * rare enough to live with the mixed-selection path.
 */
export function categoryOptions(
  pickers: Pickers,
  direction: Direction,
  excludeAccountId?: string | null,
): CategoryOption[] {
  const expenses: CategoryOption[] = pickers.expenseAccounts.map((a) => ({
    id: `expense:${a.id}`,
    kind: "expense",
    accountId: a.id,
    unitId: null,
    label: plainName(a.label),
    group: "Expenses",
  }));
  const income: CategoryOption[] = pickers.incomeAccounts.map((a) => ({
    id: `income:${a.id}`,
    kind: "income",
    accountId: a.id,
    unitId: null,
    label: plainName(a.label),
    group: "Other income",
  }));
  const dues: CategoryOption[] = pickers.units.map((u) => ({
    id: `dues:${u.id}`,
    kind: "dues",
    accountId: null,
    unitId: u.id,
    label: `Dues · ${u.label}`,
    group: "Dues",
  }));
  // Never the account the money came from: moving it there is a transfer to itself.
  const transfers: CategoryOption[] = pickers.cashAccounts
    .filter((a) => a.id !== excludeAccountId)
    .map((a) => ({
      id: `transfer:${a.id}`,
      kind: "transfer",
      accountId: a.id,
      unitId: null,
      label: `Moved to ${plainName(a.label)}`,
      group: MOVING_MONEY,
    }));
  // Paying a card (money out only). Each connected card by name; when none is connected,
  // one choice that still keeps the payment out of expenses.
  const cardNames = pickers.cardNames ?? [];
  const cardPayable = pickers.cardPayableId ?? null;
  const cards: CategoryOption[] =
    cardPayable && direction !== "in"
      ? cardNames.length > 0
        ? cardNames.map((name, i) => ({
            id: `card:${i}`,
            kind: "transfer" as const,
            accountId: cardPayable,
            unitId: null,
            label: `Credit card payment · ${name}`,
            group: MOVING_MONEY,
          }))
        : [
            {
              id: "card:unconnected",
              kind: "transfer" as const,
              accountId: cardPayable,
              unitId: null,
              label: "Credit card payment",
              group: MOVING_MONEY,
            },
          ]
      : [];
  const moving = [...cards, ...transfers];
  const excluded: CategoryOption = {
    id: "excluded",
    kind: "excluded",
    accountId: null,
    unitId: null,
    label: "Not for the books",
    group: "Not for the books",
  };
  // Moving money leads: it is the one answer that is not a category at all, and
  // filing a card payment as an expense counts the same money twice.
  if (direction === "out") return [...moving, ...expenses, excluded];
  if (direction === "in") return [...moving, ...dues, ...income, excluded];
  return [...moving, ...expenses, ...income, ...dues, excluded];
}

export function optionFor(
  options: CategoryOption[],
  choice: CategoryChoice | null,
): CategoryOption | null {
  if (!choice) return null;
  return (
    options.find(
      (o) =>
        o.kind === choice.kind &&
        (o.accountId ?? null) === (choice.accountId ?? null) &&
        (o.unitId ?? null) === (choice.unitId ?? null),
    ) ?? null
  );
}

function matches(o: CategoryOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return o.label.toLowerCase().includes(q) || o.group.toLowerCase().includes(q);
}

/**
 * A combobox over categoryOptions(): type to narrow, up/down to move, Enter
 * to pick, Escape to close. Picking sets kind, account and unit in one go.
 * The input shows the chosen label when it is not being typed in.
 */
export function CategoryPicker({
  pickers,
  direction,
  value,
  onChange,
  defaultOpen = false,
  autoFocus = false,
  defaultQuery = "",
  label = "Category",
  suggested = [],
  suggestedLabel = SUGGESTED,
  excludeAccountId,
  placeholder = "Choose a category",
  dropUp = false,
}: {
  pickers: Pickers;
  direction: Direction;
  value: CategoryChoice | null;
  onChange: (choice: CategoryChoice) => void;
  /** Open the list straight away (the form was just opened to pick one). */
  defaultOpen?: boolean;
  autoFocus?: boolean;
  /** Text to start filtering with when nothing is chosen yet, e.g. "Dues". */
  defaultQuery?: string;
  label?: string;
  /** Up to three choices to repeat at the top while nothing is typed: how this payee has been filed before. */
  suggested?: CategoryChoice[];
  /** Heading for the suggested choices (default "Suggested for this payee"). */
  suggestedLabel?: string;
  /** The cash account the money came from; left out of the transfer choices. */
  excludeAccountId?: string | null;
  placeholder?: string;
  /** Open the list above the field, for a field at the bottom of the screen. */
  dropUp?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const options = categoryOptions(pickers, direction, excludeAccountId);
  const chosen = optionFor(options, value);

  // `query` is null while the input is just showing the chosen label.
  const [query, setQuery] = useState<string | null>(
    chosen ? null : defaultQuery || null,
  );
  const [open, setOpen] = useState(defaultOpen);
  const [active, setActive] = useState(0);

  const text = query ?? chosen?.label ?? "";
  const typing = (query ?? "").trim() !== "";
  // Repeats of real options, so ids are prefixed to stay unique in the list.
  const suggestedOptions: CategoryOption[] = typing
    ? []
    : suggested
        .map((c) => optionFor(options, c))
        .filter((o): o is CategoryOption => o !== null)
        .slice(0, 3)
        .map((o) => ({ ...o, id: `suggested:${o.id}`, group: suggestedLabel }));
  const visible = [
    ...suggestedOptions,
    ...options.filter((o) => matches(o, query ?? "")),
  ];
  const activeIdx = Math.min(active, Math.max(0, visible.length - 1));

  const pick = (o: CategoryOption) => {
    onChange({ kind: o.kind, accountId: o.accountId, unitId: o.unitId });
    setQuery(null);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive(Math.min(activeIdx + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (open) setActive(Math.max(activeIdx - 1, 0));
    } else if (e.key === "Enter") {
      if (open && visible[activeIdx]) {
        e.preventDefault();
        pick(visible[activeIdx]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        // Only the list closes; a second Escape is the form's to handle.
        e.stopPropagation();
        setOpen(false);
        setQuery(null);
      }
    }
  };

  const groups: {
    name: string;
    items: { o: CategoryOption; idx: number }[];
  }[] = [];
  visible.forEach((o, idx) => {
    const last = groups[groups.length - 1];
    if (last && last.name === o.group) last.items.push({ o, idx });
    else groups.push({ name: o.group, items: [{ o, idx }] });
  });

  return (
    <div className="relative min-w-[14rem]">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && visible[activeIdx]
            ? `${listId}-${visible[activeIdx].id}`
            : undefined
        }
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setQuery(null);
        }}
        onKeyDown={onKeyDown}
        className="mt-1 w-full rounded-lg border border-line-strong bg-paper py-1.5 pl-2.5 pr-8 min-h-[44px] text-[16px] text-ink sm:min-h-0 sm:text-[12px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brass"
      />
      <ChevronDown
        size={14}
        strokeWidth={1.6}
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-[calc(50%+2px)] -translate-y-1/2 text-mute"
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className={`absolute left-0 z-20 max-h-64 w-max min-w-full max-w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-line-strong bg-paper py-1 shadow-lg ${dropUp ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          {groups.map((g) => (
            <li key={g.name} role="presentation">
              {/* A lone group needs no heading: its options already say what they are. */}
              {groups.length > 1 ? (
                <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-[0.07em] text-mute-soft">
                  {g.name}
                </div>
              ) : null}
              <ul role="group" aria-label={g.name}>
                {g.items.map(({ o, idx }) => (
                  <li
                    key={o.id}
                    id={`${listId}-${o.id}`}
                    role="option"
                    aria-selected={
                      chosen?.id === o.id.replace(/^suggested:/, "")
                    }
                    // mousedown would blur the input (closing the list) before click fires.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => pick(o)}
                    className={`cursor-pointer px-2.5 py-3 text-[13px] sm:whitespace-nowrap sm:py-1 sm:text-[12px] ${
                      idx === activeIdx ? "bg-ink/10 text-ink" : "text-ink"
                    } ${chosen?.id === o.id.replace(/^suggested:/, "") ? "font-medium" : ""}`}
                  >
                    {o.label}
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {visible.length === 0 ? (
            <li className="px-2.5 py-1.5 text-[12px] text-mute">
              No match. Try “Transfer” or “Not for the books”.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
