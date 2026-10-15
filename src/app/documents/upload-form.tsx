"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DirectUpload } from "@/components/upload/direct-upload";
import { documentHelp } from "@/components/upload/upload-copy";
import type { DocumentCategory } from "@/lib/documents/access";

/**
 * The hub's upload panel (board only). Files go straight to Storage through
 * DirectUpload, so a 20 MB scan isn't stopped by the Server Action body
 * limit. Uploading starts as soon as files are picked or dropped; the
 * category chosen first decides where they're filed and who can see them.
 */
export function UploadForm({ categories }: { categories: DocumentCategory[] }) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const category = categories.find((c) => c.id === categoryId) ?? null;

  return (
    <div className="rounded-xl border border-line bg-paper p-5">
      <p className="text-[12px] font-medium text-ink">Add documents</p>
      <div className="mt-2">
        <label htmlFor="category_id" className="block text-[12px] font-medium text-ink">
          File them as
        </label>
        <select
          id="category_id"
          value={categoryId}
          disabled={busy}
          onChange={(e) => setCategoryId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[16px] text-ink disabled:opacity-50 sm:w-auto sm:text-[13px]"
        >
          <option value="">Decide later</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/* The select is locked while files are in flight, so "Filing as" on
          each row is what actually happened to it. */}
      <div className="mt-3">
        <DirectUpload
          purpose="document"
          categorySlug={category?.slug}
          categoryLabel={category?.label}
          label="Choose files"
          help={documentHelp(
            category ? { label: category.label, defaultVisibility: category.default_visibility } : null,
          )}
          onBusyChange={setBusy}
          onUploaded={() => router.refresh()}
        />
      </div>
    </div>
  );
}
