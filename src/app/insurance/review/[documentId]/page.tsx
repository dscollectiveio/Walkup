import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import { loadInsuranceContext } from "@/lib/insurance/queries";
import { BackLink } from "../../components/page-header";
import { linkClass } from "../../components/styles";
import { ReadButtons } from "./read-buttons";

export const dynamic = "force-dynamic";
// The shim's buttons start a read (insurance-spec §3.1).
export const maxDuration = 300;

/** The reuse window of startInsuranceRead (§8.1 step 3). */
function thirtyDaysAgo(): string {
  return new Date(Date.now() - 30 * 86_400_000).toISOString();
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * /insurance/review/[documentId], the legacy route (insurance-spec §8.1).
 * Old links (the Document Hub, bookmarks) still land somewhere useful, and a
 * GET never starts work: the latest read of the document from the last 30
 * days opens if there is one; otherwise the board chooses to read it.
 */
export default async function LegacyReviewShim({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { documentId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.isBoard) notFound();

  // The old "enter it by hand" link.
  if (documentId === "manual") redirect(sp.mode === "quote" ? "/insurance/quotes/new" : "/insurance/policies/new");
  if (!isUuid(documentId)) notFound();

  const since = thirtyDaysAgo();
  const { data: reads } = await supabase
    .from("insurance_document_reads")
    .select("id")
    .eq("document_id", documentId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  const latest = ((reads ?? []) as { id: string }[])[0];
  if (latest) redirect(`/insurance/import/${latest.id}`);

  const { data } = await supabase.from("documents").select("id, filename, document_categories(slug)").eq("id", documentId).maybeSingle();
  type Doc = { id: string; filename: string; document_categories: { slug: string } | { slug: string }[] | null };
  const doc = data as Doc | null;
  if (!doc) notFound();
  const category = Array.isArray(doc.document_categories) ? doc.document_categories[0] : doc.document_categories;

  return (
    <div className="space-y-4">
      <BackLink href="/insurance">Insurance</BackLink>
      <Card title="Read this document">
        {category?.slug === "insurance" ? (
          <div className="space-y-3">
            <p className="text-[13px] text-ink">{doc.filename}</p>
            <p className="text-[13px] text-mute">Walkup reads the figures for you to check before anything is saved.</p>
            <ReadButtons documentId={doc.id} />
          </div>
        ) : (
          <div className="space-y-2 text-[13px]">
            <p className="text-ink">Walkup only reads files filed as Insurance.</p>
            <Link href={`/documents/${doc.id}`} className={linkClass}>
              Open {doc.filename} in the Document Hub
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
