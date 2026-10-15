import { STATEMENT_PDF_ENABLED } from "@/lib/owner/flags";

/**
 * "Download PDF" for a unit statement. Renders nothing until the money spec
 * ships its route (STATEMENT_PDF_ENABLED), so no owner is sent to a page that
 * is not there. The route sets Content-Disposition, so no download attribute.
 */
export function StatementDownload({
  unitId,
  from,
  to,
  enabled = STATEMENT_PDF_ENABLED,
}: {
  unitId: string;
  from: string | null;
  to: string | null;
  enabled?: boolean;
}) {
  if (!enabled) return null;
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const href = `/statements/${unitId}/pdf${qs.size ? `?${qs.toString()}` : ""}`;
  return (
    <a
      href={href}
      className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill"
    >
      Download PDF
    </a>
  );
}
