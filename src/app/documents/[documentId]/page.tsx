import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Restricted } from "@/components/ui";
import {
  currentAssociationId,
  getDocument,
  listCategories,
  listVersions,
} from "@/lib/documents/access";
import { DownloadButton } from "../document-row";
import { readableSize, visibilitySentence } from "@/lib/documents/format";
import { TagChip, UnfiledChip } from "../tag-chip";
import {
  PurgeButton,
  RenameForm,
  RerunButton,
  RestoreButton,
  VisibilityForm,
} from "./detail-actions";
import { aiConfigured } from "@/lib/ai/client";
import { coverageShort } from "@/lib/insurance/coverage";
import { ReadButtons } from "@/app/insurance/review/[documentId]/read-buttons";

export const dynamic = "force-dynamic";
// Uploads and re-reads run the document reader in after(); give it the
// full Vercel budget (foundation-spec 5.2).
export const maxDuration = 300;

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const supabase = await createClient();

  // Gated on the document itself, which carries the correct policy. An empty
  // result is indistinguishable from "does not exist", which is the point.
  const doc = await getDocument(supabase, documentId);
  if (!doc) return <Restricted what="this document" />;

  const associationId = await currentAssociationId(supabase);

  const [categories, versions, { data: units }, { data: isBoard }, { data: isAdmin }] =
    await Promise.all([
      listCategories(supabase),
      listVersions(supabase, doc.version_group_id),
      supabase.from("units").select("id, label").order("sort_order"),
      supabase.rpc("has_role_in", {
        assoc: associationId,
        roles: ["board_admin", "board_member"],
      }),
      supabase.rpc("has_role_in", { assoc: associationId, roles: ["board_admin"] }),
    ]);

  const canWrite = isBoard === true;
  const canPurge = isAdmin === true;
  const category = categories.find((c) => c.id === doc.category_id);
  const unitLabel =
    (units ?? []).find((u) => u.id === doc.restricted_to_unit_id)?.label ?? null;
  const binned = doc.deleted_at !== null;
  const isInsurance = category?.slug === "insurance";
  const linkedTo = await insuranceLinks(supabase, doc.id);

  const summary =
    doc.extraction && typeof doc.extraction === "object"
      ? ((doc.extraction as { summary?: string }).summary ?? null)
      : null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/documents"
          className="text-[12px] text-mute underline-offset-2 hover:underline"
        >
          ← Document Hub
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-[20px] font-bold tracking-tight text-ink">{doc.title}</h1>
          {category ? (
            <TagChip
              label={category.label}
              slug={category.slug}
              provisional={doc.tag_source === "auto" && doc.review_state === "needs_review"}
              confidence={doc.tag_confidence}
            />
          ) : (
            <UnfiledChip />
          )}
        </div>
        <p className="mt-1 text-[13px] text-mute">
          {[
            doc.filename !== doc.title ? doc.filename : null,
            readableSize(doc.byte_size),
            `added ${new Date(doc.uploaded_at).toLocaleDateString()}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {canWrite && !binned ? (
          <div className="mt-2">
            <RenameForm doc={doc} />
          </div>
        ) : null}
      </div>

      {binned ? (
        <div className="border-l-[3px] border-warning bg-warning-tint px-5 py-4">
          <p className="font-medium text-warning-text">This document is in the bin</p>
          <p className="mt-1 text-[13px] text-warning-text opacity-90">
            Owners can no longer see it. Nothing has been destroyed — restore it if this was a
            mistake.
          </p>
          {canWrite ? (
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <RestoreButton id={doc.id} />
              {canPurge ? <PurgeButton id={doc.id} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[3fr_2fr]">
        <Card title="The file">
          <div className="space-y-3">
            <DownloadButton
              id={doc.id}
              className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
            >
              Download
            </DownloadButton>

            {summary ? (
              <div className="border-l-[3px] border-info bg-info-tint px-4 py-3">
                <p className="text-[11px] font-medium text-info-text">
                  Summary written by Walkup, not by a person
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-info-text opacity-90">
                  {summary}
                </p>
              </div>
            ) : null}

            {/* Say what is actually true about the reading attempt rather than
                leaving an empty space that could mean anything. */}
            {doc.extraction_state === "pending" || doc.extraction_state === "running" ? (
              <p className="text-[12px] text-mute">
                {doc.extraction_state === "running"
                  ? "Reading this file now."
                  : "Nothing has been read out of this file yet."}
              </p>
            ) : doc.extraction_state === "skipped" ? (
              <div className="text-[12px] text-mute">
                <p>{doc.extraction_error ?? "There was nothing to read in this file."}</p>
                {canWrite ? (
                  <div className="mt-2">
                    <RerunButton id={doc.id} label="Try reading it again" />
                  </div>
                ) : null}
              </div>
            ) : doc.extraction_state === "failed" ? (
              <div className="text-[12px] text-bad-text">
                <p>
                  {doc.extraction_error ?? "Walkup could not read this file."} The file itself is
                  fine and downloads normally.
                </p>
                {canWrite ? (
                  <div className="mt-2">
                    <RerunButton id={doc.id} label="Try again" />
                  </div>
                ) : null}
              </div>
            ) : canWrite ? (
              <RerunButton id={doc.id} label="Read it again" />
            ) : null}

            {versions.length > 1 ? (
              <div className="border-t border-line pt-3">
                <h3 className="text-[12px] font-medium text-mute">Version history</h3>
                <ul className="mt-2 space-y-1.5">
                  {versions.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 text-[12px]">
                      <span className="text-ink">
                        Version {v.version_number}
                        {v.is_current_version ? (
                          <span className="ml-1.5 text-[11px] text-mute">current</span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-3 text-mute">
                        <span className="figures">
                          {new Date(v.uploaded_at).toLocaleDateString()}
                        </span>
                        <DownloadButton id={v.id}>Download</DownloadButton>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Card>

        {isInsurance && canWrite && !binned ? (
          <Card title="Use it on Insurance">
            {aiConfigured() ? (
              <>
                <p className="mb-3 text-[13px] text-mute">
                  Walkup reads the figures and you check each one before anything is saved.
                </p>
                <ReadButtons documentId={doc.id} />
              </>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link
                  href={`/insurance/policies/new?document=${doc.id}`}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid"
                >
                  Enter it as a policy
                </Link>
                <Link
                  href={`/insurance/quotes/new?document=${doc.id}`}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill"
                >
                  Enter it as a quote
                </Link>
              </div>
            )}
          </Card>
        ) : null}

        {linkedTo.length > 0 ? (
          <Card title="Linked to">
            <ul className="space-y-1 text-[13px]">
              {linkedTo.map((l) => (
                <li key={l.key}>
                  <Link href={l.href} className="inline-flex min-h-[36px] items-center text-ink underline underline-offset-2">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card title="Who can see it">
          <p className="text-[13px] text-ink">
            {visibilitySentence(doc.visibility, unitLabel)}
          </p>
          {canWrite && !binned ? (
            <div className="mt-2">
              <VisibilityForm doc={doc} units={units ?? []} />
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The policies, quotes and claims this document is attached to
 * (insurance-spec §12 I-8), labelled "{coverage short} · {carrier}". Read
 * under the caller's RLS, so anyone who can't read insurance sees none.
 */
async function insuranceLinks(supabase: Supabase, documentId: string): Promise<{ key: string; label: string; href: string }[]> {
  const { data: links } = await supabase
    .from("document_links")
    .select("target_table, target_id")
    .eq("document_id", documentId)
    .in("target_table", ["insurance_policies", "insurance_quotes", "insurance_claims"]);
  const ids = (table: string) => [...new Set((links ?? []).filter((l) => l.target_table === table).map((l) => l.target_id as string))];
  const policyIds = ids("insurance_policies");
  const quoteIds = ids("insurance_quotes");
  const claimIds = ids("insurance_claims");
  if (policyIds.length + quoteIds.length + claimIds.length === 0) return [];

  const none = Promise.resolve({ data: [] as Record<string, unknown>[] });
  const [{ data: policies }, { data: quotes }, { data: claims }] = await Promise.all([
    policyIds.length ? supabase.from("insurance_policies").select("id, coverage, carrier_name").in("id", policyIds) : none,
    quoteIds.length ? supabase.from("insurance_quotes").select("id, coverage, carrier_name").in("id", quoteIds) : none,
    claimIds.length
      ? supabase.from("insurance_claims").select("id, policy_id, claim_number, insurance_policies(coverage, carrier_name)").in("id", claimIds)
      : none,
  ]);
  const label = (coverage: unknown, carrier: unknown) =>
    [typeof coverage === "string" ? coverageShort(coverage) : null, typeof carrier === "string" ? carrier : null].filter(Boolean).join(" · ");
  const out: { key: string; label: string; href: string }[] = [];
  for (const p of policies ?? []) {
    out.push({ key: `p:${p.id}`, label: label(p.coverage, p.carrier_name) || "A policy", href: `/insurance/policies/${p.id}` });
  }
  for (const q of quotes ?? []) {
    out.push({ key: `q:${q.id}`, label: `Quote: ${label(q.coverage, q.carrier_name) || "a quote"}`, href: `/insurance/quotes/${q.id}` });
  }
  for (const c of claims ?? []) {
    const pol = (Array.isArray(c.insurance_policies) ? c.insurance_policies[0] : c.insurance_policies) as
      | { coverage?: unknown; carrier_name?: unknown }
      | null
      | undefined;
    const number = typeof c.claim_number === "string" && c.claim_number.trim() ? ` ${c.claim_number.trim()}` : "";
    out.push({
      key: `c:${c.id}`,
      label: `Claim${number}: ${label(pol?.coverage, pol?.carrier_name) || "a policy"}`,
      href: `/insurance/policies/${c.policy_id}`,
    });
  }
  return out;
}
