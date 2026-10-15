import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { FIELDS, type ImportKind } from "@/lib/import/kinds";
import { csvLine } from "@/lib/import/safe-cell";
import { importViewer } from "@/lib/import/server";
import { templateHeaders } from "@/lib/import/templates";

export const dynamic = "force-dynamic";

/**
 * The rows with problems, as a CSV the board can fix and upload again
 * (import-spec 7.4). The first columns are the template's, so the fixed file
 * goes straight back in; its file hash differs but its row hashes match what
 * was already imported, so only the fixed rows are new. Every cell passes
 * csvLine, which guards a leading = + - @ so a spreadsheet shows text.
 */

// Template header -> staged key, in template order.
const COLUMN_KEYS: Record<ImportKind, string[]> = {
  units_owners: ["unit_label", "owner_name", "email", "phone", "mailing_address", "ownership_percent", "dues_amount"],
  transactions: ["date", "description", "amount", "payee", "category_key", "fund_key", "unit_label"],
  opening_accounts: ["account_key", "fund_key", "debit", "credit"],
  opening_units: ["unit_label", "amount"],
  contractors: ["name", "trade", "contact_name", "email", "phone", "website", "notes"],
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  if (!z.guid().safeParse(batchId).success) return NextResponse.json({ error: "We couldn't find that import." }, { status: 404 });

  const { supabase, associationId, role } = await importViewer();
  if (!associationId) return NextResponse.json({ error: "No association is visible to you." }, { status: 403 });
  if (role !== "board_admin") return NextResponse.json({ error: "Importing is for board admins." }, { status: 403 });

  const { data: batch } = await supabase.from("import_batches").select("id, kind, filename").eq("id", batchId).limit(1);
  const b = batch?.[0] as { id: string; kind: ImportKind; filename: string } | undefined;
  if (!b) return NextResponse.json({ error: "We couldn't find that import." }, { status: 404 });

  const { data: rows } = await supabase
    .from("import_rows")
    .select("row_number, mapped, errors")
    .eq("batch_id", batchId)
    .eq("status", "error")
    .order("row_number")
    .limit(5000);

  const keys = COLUMN_KEYS[b.kind];
  const known = new Set(FIELDS[b.kind].map((f) => f.key));
  const lines = [csvLine(["Row", ...templateHeaders(b.kind), "Problem"])];
  for (const r of (rows ?? []) as { row_number: number; mapped: Record<string, string>; errors: { message: string }[] }[]) {
    lines.push(
      csvLine([
        r.row_number,
        ...keys.map((k) => (known.has(k) ? (r.mapped?.[k] ?? "") : "")),
        (r.errors ?? []).map((e) => e.message).join(" "),
      ]),
    );
  }
  const body = `﻿${lines.join("\r\n")}\r\n`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="walkup-import-problems.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
