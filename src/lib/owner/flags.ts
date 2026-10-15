/**
 * The statement PDF route belongs to the money-and-reminders work
 * (money-and-reminders-spec). Until it ships `/statements/{unit}/pdf`, the
 * "Download PDF" link stays hidden so no owner is sent to a page that is not
 * there. Flip to true in the change that adds the route.
 */
export const STATEMENT_PDF_ENABLED = true;
