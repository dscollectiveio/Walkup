"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { DirectUpload } from "@/components/upload/direct-upload";
import { documentHelp } from "@/components/upload/upload-copy";
import type { DocumentCategory } from "@/lib/documents/access";
import { ACCOUNTANT_UPLOAD_COPY, accountantCategoryOptions } from "@/lib/documents/accountant-uploads";

/**
 * The hub's upload panel (board, and the accountant in five categories). Files go straight to Storage through
 * DirectUpload, so a 20 MB scan isn't stopped by the Server Action body
 * limit. Uploading starts as soon as files are picked or dropped; the
 * category chosen first decides where they're filed and who can see them.
 */
export function UploadForm({ categories, accountant = false }: { categories: DocumentCategory[]; accountant?: boolean }) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  // The accountant picks one of five and has no "Decide later": nothing they add is left unfiled.
  const options = accountant ? accountantCategoryOptions(categories) : categories;
  const category = options.find((c) => c.id === categoryId) ?? null;
  const needsCategory = accountant && !category;

  return (
    <Card navy title="Add documents">
      {/* The select is locked while files are in flight, so "Filing as" on
          each row is what actually happened to it. */}
      <DirectUpload
        centered
        purpose="document"
        categorySlug={category?.slug}
        categoryLabel={category?.label}
        label="Choose files"
        disabled={needsCategory}
        help={
          accountant
            ? needsCategory
              ? ACCOUNTANT_UPLOAD_COPY.chooseFirst
              : ACCOUNTANT_UPLOAD_COPY.help
            : documentHelp(category ? { label: category.label, defaultVisibility: category.default_visibility } : null)
        }
        beforeList={
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <label htmlFor="category_id" className="text-[12px] font-medium text-ink">
              File them as
            </label>
            <select
              id="category_id"
              value={categoryId}
              disabled={busy}
              onChange={(e) => setCategoryId(e.target.value)}
              className="rounded-lg border border-line-strong bg-paper px-3 py-2 text-[16px] text-ink disabled:opacity-50 sm:text-[13px]"
            >
              <option value="">{accountant ? ACCOUNTANT_UPLOAD_COPY.categoryPlaceholder : "Decide later"}</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        }
        onBusyChange={setBusy}
        onUploaded={() => router.refresh()}
      />
    </Card>
  );
}
