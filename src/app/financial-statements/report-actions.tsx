import { emailHref, type Report } from "./report";

/** Download PDF + "Email - Financial Report" (full P&L or expenses only). Both work for one period or several. */
export function ReportActions({ report, pdfHref }: { report: Report; pdfHref: string }) {
  const item = "block rounded-md px-3 py-2 text-ink hover:bg-fill";
  return (
    <div className="flex items-center gap-2">
      <a
        href={pdfHref}
        download
        className="inline-flex h-9 items-center rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid"
      >
        Download PDF
      </a>
      <details className="relative">
        <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink transition-colors hover:bg-fill [&::-webkit-details-marker]:hidden">
          Email - Financial Report
        </summary>
        <div className="absolute right-0 z-10 mt-1 w-64 rounded-lg border border-line bg-paper p-1 text-[13px] shadow-lg">
          <a href={emailHref(report, "full")} className={item}>
            <span className="block">Full P&amp;L</span>
            <span className="block text-[11px] text-mute">Income, expenses and net income</span>
          </a>
          <a href={emailHref(report, "expenses")} className={item}>
            <span className="block">Expenses only</span>
            <span className="block text-[11px] text-mute">Just the expense lines and total</span>
          </a>
          <p className="border-t border-line px-3 py-2 text-[11px] text-mute">
            Opens a draft in your email app. Nothing is sent. Attach the PDF yourself if you want it included.
          </p>
        </div>
      </details>
    </div>
  );
}
