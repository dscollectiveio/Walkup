import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted } from "@/components/ui";
import { DownloadLink, UploadForm } from "./upload";

export const dynamic = "force-dynamic";

function readableSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DocumentsPage() {
  const supabase = await createClient();

  const { data: documents } = await supabase
    .from("documents")
    .select("id, filename, mime_type, byte_size, uploaded_at, document_links(relation)")
    .order("uploaded_at", { ascending: false });

  if (!documents) return <Restricted what="documents" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="mt-1 text-stone-500">
          Insurance certificates, minutes, W-9s, invoices — anything the next
          board will need and nobody can find in an old inbox.
        </p>
      </div>

      <UploadForm />

      <Card title="Everything stored">
        {documents.length === 0 ? (
          <Empty>
            Nothing uploaded yet. The insurance certificate and the declaration
            are usually the two worth having first.
          </Empty>
        ) : (
          <ul className="divide-y divide-stone-100">
            {documents.map((d) => {
              const links = (d.document_links ?? []) as unknown as { relation: string }[];
              return (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <DownloadLink id={d.id} filename={d.filename} />
                    <div className="mt-1 text-sm text-stone-500">
                      {[
                        links[0]?.relation,
                        readableSize(d.byte_size),
                        new Date(d.uploaded_at).toLocaleDateString(),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
