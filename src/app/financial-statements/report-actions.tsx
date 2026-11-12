import { ChevronDown, FileSpreadsheet, FileText } from "lucide-react";
import { emailHref, type Report } from "./report";

const MENU_ITEM = "flex min-h-[44px] items-center gap-2.5 rounded-md px-3 py-2 text-ink hover:bg-fill";

/** One "Download" button that opens a short menu: PDF and Excel (Excel alone when there is nothing posted to put in a PDF). */
export function DownloadMenu({ pdfHref, excelHref }: { pdfHref?: string; excelHref: string }) {
  return (
    <details className="sm:relative">
      <summary className="inline-flex h-11 cursor-pointer list-none items-center gap-1.5 rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid sm:h-9 [&::-webkit-details-marker]:hidden">
        Download
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
      </summary>
      <div className="absolute inset-x-0 z-10 mt-1 min-w-[12rem] rounded-lg border border-line bg-paper p-1 text-[13px] shadow-lg sm:inset-x-auto sm:right-0 sm:w-48">
        {pdfHref ? (
          <a href={pdfHref} download className={MENU_ITEM}>
            <FileText size={16} strokeWidth={1.8} aria-hidden="true" className="text-bad-text" />
            PDF
          </a>
        ) : null}
        <a href={excelHref} download className={MENU_ITEM}>
          <FileSpreadsheet size={16} strokeWidth={1.8} aria-hidden="true" className="text-good-text" />
          Excel
        </a>
      </div>
    </details>
  );
}

/** "Email - Financial Report" (full P&L or expenses only), then "Download" (PDF or Excel). Both work for one period or several. */
export function ReportActions({ report, pdfHref, excelHref }: { report: Report; pdfHref: string; excelHref: string }) {
  const item = "block min-h-[44px] rounded-md px-3 py-2 text-ink hover:bg-fill";
  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <details className="sm:relative">
        <summary className="inline-flex h-11 cursor-pointer sm:h-9 list-none items-center rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink transition-colors hover:bg-fill [&::-webkit-details-marker]:hidden">
          Email report
        </summary>
        <div className="absolute inset-x-0 z-10 mt-1 min-w-[16rem] rounded-lg border border-line bg-paper p-1 text-[13px] shadow-lg sm:inset-x-auto sm:right-0 sm:w-64">
          <a href={emailHref(report, "full")} className={item}>
            <span className="block">Full P&amp;L</span>
            <span className="block text-[12px] text-mute sm:text-[11px]">Income, expenses and net income</span>
          </a>
          <a href={emailHref(report, "expenses")} className={item}>
            <span className="block">Expenses only</span>
            <span className="block text-[12px] text-mute sm:text-[11px]">Just the expense lines and total</span>
          </a>
          <p className="border-t border-line px-3 py-2 text-[12px] text-mute sm:text-[11px]">
            Opens a draft in your email app. Nothing is sent. Attach the PDF yourself if you want it included.
          </p>
        </div>
      </details>
      <DownloadMenu pdfHref={pdfHref} excelHref={excelHref} />
    </div>
  );
}
