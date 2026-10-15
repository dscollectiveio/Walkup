import Link from "next/link";
import { redirect } from "next/navigation";
import { aiConfigured } from "@/lib/ai/client";
import { detectColumns } from "@/lib/import/columns";
import { isImportKind, KIND_LABEL } from "@/lib/import/kinds";
import { importViewer, loadAndParse } from "@/lib/import/server";
import { BoardOnly, BTN_SECONDARY, ErrorNote, PageHeader } from "../ui";
import { MappingStep } from "./mapping-step";
import { RemoveAndRetry } from "./remove-and-retry";
import { UploadStep } from "./upload-step";

export const dynamic = "force-dynamic";
// Reading a 5,000 row workbook happens here and in the start action.
export const maxDuration = 60;

export default async function NewImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const kindParam = Array.isArray(sp.kind) ? sp.kind[0] : sp.kind;
  if (!isImportKind(kindParam)) redirect("/building/import");
  const kind = kindParam;
  const doc = Array.isArray(sp.doc) ? sp.doc[0] : sp.doc;

  const { supabase, associationId, role } = await importViewer();
  if (!associationId || role !== "board_admin") {
    return <BoardOnly what="Importing" why="Only a board admin can bring in spreadsheets." />;
  }

  if (!doc) {
    return (
      <div className="space-y-6">
        <PageHeader title={`Upload your ${KIND_LABEL[kind].toLowerCase()}`} />
        <UploadStep kind={kind} />
      </div>
    );
  }

  const loaded = await loadAndParse(supabase, doc, kind);
  if (!loaded.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title={`Upload your ${KIND_LABEL[kind].toLowerCase()}`} />
        <ErrorNote>{loaded.error}</ErrorNote>
        <RemoveAndRetry documentId={doc} kind={kind} />
      </div>
    );
  }

  const { file } = loaded;
  const sampleRows = file.rows.slice(0, 8);
  const detected = detectColumns(kind, file.headers, sampleRows);
  const sensitive = new Set(detected.unmapped.filter((u) => u.sensitive).map((u) => u.index));
  const columns = file.headers.map((header, index) => ({
    index,
    header,
    sensitive: sensitive.has(index),
    samples: sensitive.has(index)
      ? []
      : sampleRows.map((r) => r[index] ?? "").filter((v) => v !== "").slice(0, 3).map((v) => v.slice(0, 60)),
  }));

  return (
    <div className="space-y-6">
      <PageHeader title={`Import ${KIND_LABEL[kind].toLowerCase()}`} />
      <MappingStep
        kind={kind}
        documentId={doc}
        filename={loaded.doc.filename}
        rowCount={file.rowCount}
        columns={columns}
        detected={detected.detected.map((d) => ({ field: d.field, index: d.index, score: d.score, reason: d.reason }))}
        initialMapping={detected.mapping}
        keepCopyDefault={sp.keep === "1"}
        aiAvailable={aiConfigured()}
        warnings={file.warnings}
      />
      <p className="text-[12px] text-mute">
        <Link href="/building/import" className={`${BTN_SECONDARY} !min-h-[36px] !px-3`}>
          Back to Import
        </Link>
      </p>
    </div>
  );
}
