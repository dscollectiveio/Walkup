// The bills table's fixed columns, shared by the header row (server) and the
// rows (client) so they always line up. Desktop only; below that each row
// stacks into one block.

export const BILL_COLUMNS =
  "xl:grid xl:grid-cols-[minmax(0,1fr)_9rem_9rem_8rem_6.5rem] xl:items-center xl:gap-x-3";

/**
 * Right-hand offsets of the thin vertical rules between the columns: the
 * running width of the columns to the right of each rule plus half a 0.75rem gap.
 */
export const BILL_LINES = ["xl:right-[6.875rem]", "xl:right-[15.625rem]", "xl:right-[25.375rem]", "xl:right-[35.125rem]"];
