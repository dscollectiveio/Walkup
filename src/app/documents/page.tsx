import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted } from "@/components/ui";
import {
  currentAssociationId,
  listCategories,
  listDocuments,
  type DocumentRow,
} from "@/lib/documents/access";
import { UploadForm } from "./upload-form";
import { DocumentListRow } from "./document-row";

export const dynamic = "force-dynamic";

interface Search {
  category?: string;
  q?: string;
  view?: string;
}

/** A view rail entry. `href` carries the whole filter, so views are linkable. */
function ViewLink({
  label,
  count,
  active,
  href,
  tone = "quiet",
}: {
  label: string;
  count: number;
  active: boolean;
  href: string;
  tone?: "quiet" | "attention";
}) {
  const base = "rounded-full border px-3 py-1 text-[12px] whitespace-nowrap";
  const style = active
    ? "border-ink bg-ink text-paper"
    : tone === "attention"
      ? "border-warning-line bg-warning-tint text-warning-text hover:bg-warning-tint/70"
      : "border-line-strong bg-paper text-ink hover:bg-fill";

  return (
    <Link href={href} className={`${base} ${style}`} aria-current={active ? "page" : undefined}>
      {label}
      <span className={`figures ml-1.5 ${active ? "text-paper/70" : "text-mute"}`}>{count}</span>
    </Link>
  );
}

export default async function DocumentHubPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { category, q, view } = await searchParams;
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

  const qs = (next: Partial<Search>) => {
    const p = new URLSearchParams();
    const merged = { category, q, view, ...next };
    if (merged.category) p.set("category", merged.category);
    if (merged.q) p.set("q", merged.q);
    if (merged.view) p.set("view", merged.view);
    const s = p.toString();
    return s ? `/documents?${s}` : "/documents";
  };

  const nothingAtAll = live.length === 0 && binnedCount === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Document Hub</h1>
        <p className="mt-1 text-mute">
          Insurance certificates, minutes, W-9s, invoices — anything the next board will need and
          nobody can find in an old inbox.
        </p>
      </div>

      {canWrite ? <UploadForm categories={categories} /> : null}

      {!nothingAtAll ? (
        <>
          {/* Below 860px this scrolls sideways rather than wrapping into a
              block that pushes the list off the screen. */}
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <div className="flex items-center gap-2">
              <ViewLink
                label="All"
                count={live.length}
                active={!category && !view}
                href="/documents"
              />
              {reviewCount > 0 ? (
                <ViewLink
                  label="Needs review"
                  count={reviewCount}
                  active={isReview}
                  href={qs({ view: "review", category: undefined })}
                  tone="attention"
                />
              ) : null}
              {unfiledCount > 0 ? (
                <ViewLink
                  label="Unfiled"
                  count={unfiledCount}
                  active={category === "unfiled"}
                  href={qs({ category: "unfiled", view: undefined })}
                />
              ) : null}
              {categories
                .filter((c) => (perCategory.get(c.id) ?? 0) > 0)
                .map((c) => (
                  <ViewLink
                    key={c.id}
                    label={c.label}
                    count={perCategory.get(c.id) ?? 0}
                    active={category === c.id}
                    href={qs({ category: c.id, view: undefined })}
                  />
                ))}
              {canWrite && binnedCount > 0 ? (
                <ViewLink
                  label="Binned"
                  count={binnedCount}
                  active={isBinned}
                  href={qs({ view: "binned", category: undefined })}
                />
              ) : null}
            </div>
          </div>

          <form action="/documents" className="flex flex-wrap items-center gap-2">
            {category ? <input type="hidden" name="category" value={category} /> : null}
            {view ? <input type="hidden" name="view" value={view} /> : null}
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search titles and what's inside the files"
              aria-label="Search documents"
              className="w-full max-w-[420px] rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
            />
            <button
              type="submit"
              className="rounded-md border border-line-strong px-3 py-2 text-[13px] text-ink hover:bg-fill"
            >
              Search
            </button>
            {q ? (
              <Link
                href={qs({ q: undefined })}
                className="text-[12px] text-mute underline-offset-2 hover:underline"
              >
                Clear
              </Link>
            ) : null}
          </form>
        </>
      ) : null}

      <Card
        title={
          isBinned
            ? "Binned"
            : isReview
              ? "Waiting on you"
              : q
                ? `Matching “${q}”`
                : "Everything stored"
        }
        hint={
          isBinned
            ? "Binned documents stay here so a mistake is recoverable. Nothing is destroyed until someone says so."
            : undefined
        }
      >
        {documents.length === 0 ? (
          <Empty>
            {nothingAtAll
              ? "Nothing here yet — the insurance certificate and the declaration are usually the two worth having first."
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
            {documents.map((d) => (
              <DocumentListRow key={d.id} doc={d} categories={categories} canWrite={canWrite} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
