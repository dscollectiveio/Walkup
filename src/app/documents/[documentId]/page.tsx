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
import { PurgeButton, RenameForm, RestoreButton, VisibilityForm } from "./detail-actions";

export const dynamic = "force-dynamic";

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
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">{doc.title}</h1>
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

            {/* Extraction lands in a later stage; until then this says what is
                true rather than pretending the field is simply empty. */}
            {doc.extraction_state === "pending" ? (
              <p className="text-[12px] text-mute">
                Nothing has been read out of this file yet.
              </p>
            ) : doc.extraction_state === "failed" ? (
              <p className="text-[12px] text-bad-text">
                Walkup could not read this file. The file itself is fine and downloads normally.
              </p>
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
