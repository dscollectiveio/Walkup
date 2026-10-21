import { createClient } from "@/lib/supabase/server";
import { Empty, Restricted } from "@/components/ui";
import {
  currentAssociationId,
  listCategories,
  listDocuments,
  type DocumentRow,
} from "@/lib/documents/access";
import { UploadForm } from "./upload-form";
import { DocumentFilters } from "./document-filters";
import { DocumentListRow } from "./document-row";
import { ReviewRow } from "./review-row";
import { NewFromOwners, type OwnerDocumentNotice } from "./new-from-owners";
import { shortDate, todayIso as todayIsoOf } from "@/lib/dates";
import { canAccountantRemove } from "@/lib/documents/accountant-uploads";

export const dynamic = "force-dynamic";
// Uploads and re-reads run the document reader in after(); give it the
// full Vercel budget (foundation-spec 5.2).
export const maxDuration = 300;

interface Search {
  category?: string;
  q?: string;
  view?: string;
  sort?: string;
}

export default async function DocumentHubPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { category, q, view, sort: sortParam } = await searchParams;
  const sort = sortParam === "oldest" || sortParam === "title" ? sortParam : "newest";
  const supabase = await createClient();

  const associationId = await currentAssociationId(supabase);
  if (!associationId) return <Restricted what="documents" />;

  const isBinned = view === "binned";
  const isReview = view === "review";

  const [categories, documents, countRows] = await Promise.all([
    listCategories(supabase),
    listDocuments(supabase, {
      category,
      q,
      binned: isBinned,
      reviewState: isReview ? "needs_review" : undefined,
    }),
    // Counts come from one light query and are tallied here rather than in a
    // view: PostgREST cannot GROUP BY, and a building's document count is in
    // the dozens. A view would be the right answer at a thousand.
    supabase
      .from("documents")
      .select("category_id, review_state, deleted_at")
      .eq("is_current_version", true),
  ]);

  if (documents === null || countRows.error) return <Restricted what="documents" />;

  const all = (countRows.data ?? []) as Pick<
    DocumentRow,
    "category_id" | "review_state" | "deleted_at"
  >[];
  const live = all.filter((d) => d.deleted_at === null);
  const binnedCount = all.length - live.length;
  const reviewCount = live.filter((d) => d.review_state === "needs_review").length;
  const unfiledCount = live.filter((d) => d.category_id === null).length;

  const perCategory = new Map<string, number>();
  for (const d of live) {
    if (d.category_id) perCategory.set(d.category_id, (perCategory.get(d.category_id) ?? 0) + 1);
  }

  // Only board and accountant can see the trash, so only they are offered it.
  // An owner reaching this page sees the documents they are entitled to and no
  // machinery for managing them.
  const { data: boardCheck } = await supabase.rpc("has_role_in", {
    assoc: associationId,
    roles: ["board_admin", "board_member"],
  });
  const canWrite = boardCheck === true;

  // The accountant adds documents in five categories and removes their own for 30 days (0081). Nothing
  // else on this page is theirs to change.
  let isAccountant = false;
  let userId: string | null = null;
  if (!canWrite) {
    const { data: accountantCheck } = await supabase.rpc("has_role_in", { assoc: associationId, roles: ["accountant"] });
    isAccountant = accountantCheck === true;
    if (isAccountant) userId = (await supabase.auth.getUser()).data.user?.id ?? null;
  }
  const slugOf = new Map(categories.map((c) => [c.id, c.slug]));

  // What owners added for their units since the board last looked (0079). In-app only. A failed read is
  // simply an empty strip: the documents themselves are in the list below either way.
  let ownerNotices: OwnerDocumentNotice[] = [];
  if (canWrite) {
    const { data: noticeRows } = await supabase.rpc("list_owner_document_notices", { p_association_id: associationId });
    const today = todayIsoOf();
    ownerNotices = ((noticeRows ?? []) as {
      notice_id: string;
      document_id: string;
      title: string | null;
      filename: string;
      kind: string | null;
      unit_label: string;
      uploaded_by_name: string | null;
      added_at: string;
    }[]).map((n) => ({
      noticeId: n.notice_id,
      documentId: n.document_id,
      title: n.title || n.filename,
      kind: n.kind,
      unitLabel: n.unit_label,
      uploadedByName: n.uploaded_by_name,
      dateText: shortDate(n.added_at, today),
    }));
  }

  const qs = (next: Partial<Search>) => {
    const p = new URLSearchParams();
    const merged = { category, q, view, sort: sortParam, ...next };
    if (merged.category) p.set("category", merged.category);
    if (merged.q) p.set("q", merged.q);
    if (merged.view) p.set("view", merged.view);
    if (merged.sort) p.set("sort", merged.sort);
    const s = p.toString();
    return s ? `/documents?${s}` : "/documents";
  };

  const shownDocs =
    sort === "oldest"
      ? [...documents].sort((x, y) => x.uploaded_at.localeCompare(y.uploaded_at))
      : sort === "title"
        ? [...documents].sort((x, y) => x.title.localeCompare(y.title, undefined, { sensitivity: "base" }))
        : documents;

  const nothingAtAll = live.length === 0 && binnedCount === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Documents</h1>
        <p className="mt-1 text-mute">
          Insurance certificates, minutes, W-9s, invoices, anything the next board will need and
          nobody can find in an old inbox.
        </p>
      </div>

      {canWrite ? <NewFromOwners notices={ownerNotices} /> : null}

      {canWrite ? <UploadForm categories={categories} /> : null}
      {isAccountant ? <UploadForm categories={categories} accountant /> : null}

      <section className="rounded-xl border border-line bg-paper">
        <header className="rounded-t-[7px] band bg-ink px-5 py-3">
          <h2 className="eyebrow text-paper">
            {isBinned ? "Binned" : isReview ? "Waiting on you" : q ? `Matching “${q}”` : "All Documents"}
          </h2>
          {isBinned ? (
            <p className="mt-1.5 text-[13px] text-ondark-mute">Binned documents stay here so a mistake is recoverable. Nothing is destroyed until someone says so.</p>
          ) : isReview ? (
            <p className="mt-1.5 text-[13px] text-ondark-mute">
              Walkup guessed at these and wasn&rsquo;t sure. Confirm or correct each one. It only takes a moment, and nothing is filed on a guess alone.
            </p>
          ) : null}
        </header>
        {!nothingAtAll ? (
          <div className="border-b-2 border-line-strong bg-fill/40">
            <DocumentFilters
              key={qs({})}
              category={category ?? ""}
              view={view ?? ""}
              sort={sort}
              q={q ?? ""}
              total={live.length}
              reviewCount={reviewCount}
              unfiledCount={unfiledCount}
              binnedCount={canWrite ? binnedCount : null}
              categories={categories.filter((c) => (perCategory.get(c.id) ?? 0) > 0).map((c) => ({ id: c.id, label: c.label, count: perCategory.get(c.id) ?? 0 }))}
              clearHref={category || q || view || sortParam ? "/documents" : null}
            />
          </div>
        ) : null}
        <div className="px-5 py-4">
        {documents.length === 0 ? (
          <Empty>
            {nothingAtAll
              ? "Nothing here yet. The insurance certificate and the declaration are usually the two worth having first."
              : isReview
                ? "Nothing waiting. Every document has been filed by a person."
                : isBinned
                  ? "The bin is empty."
                  : q
                    ? "No document matches that. Search covers titles, filenames and the text inside the files."
                    : "Nothing filed here yet."}
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {shownDocs.map((d) =>
              isReview && canWrite ? (
                <ReviewRow key={d.id} doc={d} categories={categories} />
              ) : (
                <DocumentListRow
                  key={d.id}
                  doc={d}
                  categories={categories}
                  canWrite={canWrite}
                  canRemoveOwn={
                    isAccountant &&
                    canAccountantRemove(
                      {
                        uploadedBy: d.uploaded_by,
                        uploadedAt: d.uploaded_at,
                        deletedAt: d.deleted_at,
                        restrictedToUnitId: d.restricted_to_unit_id,
                        categorySlug: d.category_id ? (slugOf.get(d.category_id) ?? null) : null,
                      },
                      userId,
                    )
                  }
                />
              ),
            )}
          </ul>
        )}
        </div>
      </section>
    </div>
  );
}
