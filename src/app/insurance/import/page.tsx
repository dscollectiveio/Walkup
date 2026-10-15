import Link from "next/link";
import { aiConfigured } from "@/lib/ai/client";
import { createClient } from "@/lib/supabase/server";
import { Card, Restricted } from "@/components/ui";
import { isCoverageType } from "@/lib/insurance/coverage";
import { loadInsuranceContext } from "@/lib/insurance/queries";
import { BackLink } from "../components/page-header";
import { Chip } from "../components/status-chip";
import { ImportScreen } from "./import-screen";
import { READ_SELECT, itemCounts, readChip, readFilename, type ReadRow } from "./read-state";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** /insurance/import (insurance-spec §9.3.1): upload declarations, packages or quotes; reads in progress. */
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ coverage?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.isBoard) return <Restricted what="insurance imports" />;
  const assoc = ctx.association.id;

  const [reads, contacts, requests] = await Promise.all([
    supabase.from("insurance_document_reads").select(READ_SELECT).eq("association_id", assoc).order("created_at", { ascending: false }).limit(20),
    supabase.from("insurance_contacts").select("id, name").eq("association_id", assoc).is("archived_at", null).order("name"),
    supabase
      .from("insurance_quote_requests")
      .select("id, contact_id, created_at")
      .eq("association_id", assoc)
      .in("status", ["draft", "sent"])
      .not("contact_id", "is", null)
      .order("created_at", { ascending: false }),
  ]);
  const openRequest = new Map<string, string>();
  for (const r of (requests.data ?? []) as { id: string; contact_id: string }[]) {
    if (!openRequest.has(r.contact_id)) openRequest.set(r.contact_id, r.id);
  }
  const rows = (reads.data ?? []) as unknown as ReadRow[];
  const coverage = sp.coverage && isCoverageType(sp.coverage) ? sp.coverage : null;

  return (
    <div className="space-y-6">
      <BackLink href="/insurance">Insurance</BackLink>
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Import insurance documents</h1>
        <p className="mt-1 text-mute">Declarations pages, renewal packages or quotes. PDFs, Word documents (.docx) and photos all work.</p>
      </div>

      <Card title="Upload">
        <ImportScreen
          aiOn={aiConfigured()}
          manualCoverage={coverage}
          contacts={((contacts.data ?? []) as { id: string; name: string }[]).map((c) => ({
            ...c,
            openRequestId: openRequest.get(c.id) ?? null,
          }))}
        />
      </Card>

      {rows.length > 0 ? (
        <Card title="Reading now and recently">
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const chip = readChip(r);
              const c = itemCounts(r);
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-ink">{readFilename(r)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-mute">
                      <Chip tone="neutral">{r.mode === "quote" ? "Quote" : "Policy"}</Chip>
                      <Chip tone={chip.tone}>{chip.text}</Chip>
                      {r.state === "done" && c.total > 0 ? (
                        <span>
                          {c.total} {c.total === 1 ? (r.mode === "quote" ? "quote" : "policy") : r.mode === "quote" ? "quotes" : "policies"} found
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Link
                    href={`/insurance/import/${r.id}`}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill"
                  >
                    Open
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
