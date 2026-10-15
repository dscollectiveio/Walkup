import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/owner/viewer";
import { isUuid } from "@/lib/email-outbox/actions-core";
import { safeFilename } from "@/lib/email-outbox/sanitize";
import { loadLateFeeLetter } from "@/lib/statements/data";
import { LateFeeLetterPdf } from "@/lib/statements/late-fee-letter";

export const dynamic = "force-dynamic";

/**
 * The late fee notice as a letter to print and post by hand (money spec 8.5).
 * Board only. It describes a fee the board has already posted and says nothing
 * else about it.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ chargeId: string }> }) {
  const { chargeId } = await context.params;
  const viewer = await getViewer();
  if (!viewer?.isBoard || !isUuid(chargeId)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const supabase = await createClient();
  const data = await loadLateFeeLetter(supabase, chargeId);
  if (!data) return NextResponse.json({ error: "That late fee is not charged, or the unit has no current owner." }, { status: 404 });

  const buffer = await renderToBuffer(LateFeeLetterPdf({ data }));
  const filename = `${safeFilename(`Late fee notice ${data.unitLabel}`)}.pdf`;
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
