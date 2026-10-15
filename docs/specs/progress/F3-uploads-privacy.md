# F3-uploads-privacy: direct uploads (foundation-spec §6) and the privacy page (§9)

Step owner: Foundation. Date: 2026-10-14. No git commands run; nothing
applied to any Supabase project; no dev server started or stopped; no
dependencies added. Nothing under `src/lib/ai` or `src/lib/email` touched.

## Built

| File | What |
|---|---|
| `src/lib/documents/sniff.ts` (new, pure) | `ACCEPTED_TYPES`, `AcceptedType`, `sniff`, `FileVerdict`, `verifyFile` moved unchanged from `file-type.ts`; adds `mimeEssence` and `verifyBlobHead` (reads the first 1,024 bytes, passes `mimeEssence(file.type)`). |
| `src/lib/documents/file-type.ts` | Still `server-only`; re-exports everything above from `./sniff`, keeps `checksum`. Existing imports unchanged. |
| `src/lib/documents/upload-paths.ts` (new, pure) | §6.1 constants, `safeStorageName`, `randomSuffix`, `buildStoragePath`, `parseStoragePath` (mirror of SQL `storage_path_kind`), plus `isUuid`, `isPhotoType`, `PhotoType`. |
| `src/lib/documents/image-normalise.ts` (new, browser only) | `normaliseImage(file, { maxEdge, quality, keepSmaller })` per §6.5.1 (createImageBitmap with `imageOrientation: "from-image"`, OffscreenCanvas or `<canvas>`, white background so PNG transparency doesn't go black, JPEG, `.jpg` name), `jpegName`. Returns null when it can't decode. |
| `src/lib/documents/access.ts` | adds `signedImageUrls(supabase, rows, ttl = 600)` (§6.7) via `createSignedUrls`; rows Storage refuses are simply absent from the map. |
| `src/app/documents/upload/actions.ts` (new, `"use server"`) | `createUploadTarget`, `registerUpload`, `removeTicketPhoto` per §6.3, every step and error copy. `removeIfUnregistered` is the `discard()` for hub paths only. Ticket photos pass through `narrower_audience` from `attach_ticket_photo` (F1/Repairs (e)). |
| `src/app/documents/upload/link-targets.ts` (new) | `LINKABLE_TABLES`, `LinkableTable`, `isLinkableTable`, `revalidateLinked` (see deviation 1). |
| `src/components/upload/upload-copy.ts` (new, pure) | All §6.9 copy, `rowText(RowState)`, `rowActive`, `documentHelp`, `defaultHelp`, error builders, `reportPartialFailure(n)`, and the §6.7 photo helpers for Repairs: `photoCaption`, `photoAlt`, `isHeicPhoto`. |
| `src/components/upload/upload-file.ts` (new, `"use client"`) | `uploadFile(file, opts, onStage)`: `prepare` hook, image normalising, the §17 HEIC-to-JPEG for every caller, size and sniff checks, `createUploadTarget`, `uploadToSignedUrl` with the `new Blob([file], { type })` wrapper, one retry on "already exists", `registerUpload`, outcome mapping. |
| `src/components/upload/direct-upload.tsx` (new, client) | `DirectUpload` with every §6.5 prop plus §17 `prepareFiles`, `prepare`, `beforeList`. Drop zone only on fine pointers (`useSyncExternalStore` over `matchMedia`), label-wrapped hidden input (44 px), help line with `aria-describedby`, `aria-busy`, results in `<div aria-live="polite"><ul>`, indeterminate bar (`motion-safe` only), elapsed seconds `aria-hidden`, "Still uploading" after 15 s, "Try again: {name}" buttons, `beforeunload` prompt while active, "Open it" link for duplicate documents. Ticket-photo default `accept` is `image/jpeg,image/png` (§17: no HEIC). |
| `src/app/documents/upload-form.tsx` | Rebuilt on `DirectUpload` (§6.6): category select (ids mapped to slugs), locked while uploading, help line from the chosen category's default visibility, `router.refresh()` on completion. No form, no submit button. |
| `src/app/documents/entity-documents.tsx` | "Attach a document" is now `DirectUpload purpose="document" link={{ targetTable, targetId, relation: "source" }} multiple={false} maxFiles={1} dropZone={false} label="Choose a file" help={null}`, Cancel kept; closes and refreshes on success. |
| `src/app/documents/actions.ts`, `link-actions.ts` | `uploadDocuments` / `uploadAndLinkDocument` marked `@deprecated` (kept for Insurance). `link-actions.ts` imports `LINKABLE_TABLES`/`revalidateLinked` from `./upload/link-targets` (behaviour unchanged). |
| `src/app/documents/page.tsx`, `src/app/documents/[documentId]/page.tsx` | `export const maxDuration = 300;` (§1.2; registerUpload's `after()` read runs under the page's budget). |
| `next.config.ts` | `experimental.serverActions.bodySizeLimit: "4mb"` with the §6.4 comment. |
| `src/lib/security/csp.ts` | `img-src` adds the Supabase https origin only (§6.8). |
| `src/app/privacy/page.tsx` | §9 items 1 to 3, in place, no em dashes in new copy; Google/Photon/Resend paragraphs kept. "Last updated" was already 2026-10-14. |
| `tests/unit/upload-paths.test.ts` | `safeStorageName` (spaces, unicode, 120 chars, empty, no `/`), `randomSuffix`, `buildStoragePath` both shapes, `parseStoragePath` against every row of `tests/fixtures/storage-paths.ts` (shared with DB test 28), limits. |
| `tests/unit/sniff.test.ts` | §12.2 list: PDF, PNG, JPEG, HEIC (`heic`, `mif1`), docx declared/undeclared, CSV refinement (also with parameters), HTML declared as PDF -> `text/plain`, binary rejected, head-only read of a 5 MB blob; `mimeEssence`. |
| `tests/unit/csp.test.ts` | `img-src` has the https origin, no `wss:`, no other remote origin, closed for a missing/malformed URL; `connect-src` unchanged. |
| `tests/unit/privacy-page.test.ts` | §12.2 strings (whitespace collapsed first, since JSX collapses it and copy wraps), the first sharing paragraph names Supabase, Vercel, Plaid, Anthropic, Google, Photon, Resend; no em dashes in the new block. |
| `tests/unit/upload-copy.test.ts` | Every §6.9 string and every `rowText` branch, captions, alt text, HEIC chip. |

### Anthropic terms check (§9 build step)

Read https://www.anthropic.com/legal/commercial-terms on 2026-10-14
(Commercial Terms of Service, "Effective June 17, 2025"). Section B says
"Anthropic may not train models on Customer Content from Services." So the AI
block ends its intro paragraph with the spec's sentence: "Under Anthropic's
commercial terms, what Walkup sends is not used to train its models." No
retention period is stated.

## Deliberately different from the spec, and why

1. **`LINKABLE_TABLES` and `revalidateLinked` live in
   `src/app/documents/upload/link-targets.ts`, not exported from
   `link-actions.ts`.** `link-actions.ts` is a `"use server"` file, and Next
   allows only async function exports there (a const array and a sync
   function would break the build). `actions.ts` re-exports the
   `LinkableTable` type as §6.3 shows.
2. **`DirectUpload` gains `onBusyChange?: (busy: boolean) => void`** (additive).
   The hub must lock its category select while files are in flight (§6.6),
   and EntityDocuments disables Cancel; neither can see the component's
   state otherwise, and `onUploaded` doesn't fire for a list-level error.
3. **`onUploaded` docs gain optional `linkFailed`**, and `uploadFile`'s
   `onStage` gains an optional second argument `bytes` (the size actually
   sent, after conversion, so the row reads "Uploading 0.6 MB" for a
   converted 3 MB HEIC as §11.3 describes). EntityDocuments keeps the panel
   open when the only upload's link failed, so "Added, but it couldn't be
   attached here..." stays readable; otherwise it closes as §6.6 says.
4. **`registerUpload` photo result `alreadyStored` gains optional
   `narrowerAudience`**, and `UploadOutcome`/`RowState` carry it, giving the
   row "This photo is already on another problem with a smaller audience."
   (§17 Repairs (e), F1's request).
5. **`prepareFiles` runs before the `maxFiles` check** (§17: "before step 1";
   Insurance joins several photos into one PDF, so the count that matters is
   after joining). Its `{ error }` shows as a list error. `prepare` runs first
   inside each file's "preparing" stage, before normalising, and again on
   "Try again" (the row keeps the post-`prepareFiles` file).
6. **`beforeList` renders between the button/help line and the file list**, so
   Insurance's "pages of one document" choice is visible before picking.
7. **HEIC conversion for every caller (§17)**: when `normaliseImages` is off,
   `uploadFile` still converts a HEIC (by declared type, `.heic/.heif` name or
   sniffed brand) with the document settings; on failure the HEIC is uploaded
   as is.
8. **`uploadFile` options** are an exported `UploadFileOptions` interface (same
   fields as the spec's `Pick<DirectUploadProps, ...>` plus `prepare`), so the
   helper doesn't depend on the component module.
9. **Queued rows** read "Waiting…" (no copy specified for that state).
10. **Photo captions** take an already-formatted `dateText` rather than calling
    `longDate`: `src/lib/dates.ts` additions belong to another step, and this
    keeps `upload-copy.ts` free of that dependency. Repairs passes
    `longDate(uploaded_at)`.
11. **Duplicate ticket photo already on this problem with a visible id** maps to
    the duplicate row "This photo is already on this problem." (the spec's
    `duplicateOf` case); a fresh same-audience link reads "Added".
12. Document duplicate found while also linking: the link is attempted to the
    existing document; a non-23505 failure returns `linkFailed: true` as for a
    new document (the spec only said "ignore 23505").

## Left undone

- **Manual checks 12.3 #1 to #7 and #10** need the dev project with 0051
  applied and a signed-in browser; not done here (the lead applies 0051).
  Especially #5 (`owner_id` on signed uploads) before photo uploads ship: the
  fallback (browser `upload()` instead of `uploadToSignedUrl` for photos) is a
  small change in `uploadFile` step 5 if it fails.
- I did not exercise `DirectUpload` in a browser: `/documents` needs sign-in
  and I did not sign in. Checked: `/privacy` renders on the running dev server
  with the new copy; tsc and eslint are clean.

## Cross-workstream requests

- **Repairs:** ticket-photo pieces are ready: `DirectUpload purpose="ticket_photo"
  ticketId sharedTicket prepare={...}` (§17 `prepare` exists, so
  `TicketPhotoPicker`'s fallback isn't required), `uploadFile()` from
  `@/components/upload/upload-file` for report-time uploads,
  `reportPartialFailure(n)`, `photoCaption`, `photoAlt`, `isHeicPhoto` and
  `UPLOAD_COPY.removeConfirm/removeConfirmYes/removeConfirmNo/removeRefused`
  from `@/components/upload/upload-copy`, `removeTicketPhoto` from
  `@/app/documents/upload/actions`, `signedImageUrls` from
  `@/lib/documents/access`. Note photo removal is `removeTicketPhoto`
  (foundation §14), not `unlinkDocument` as repairs-spec §6 says. Add
  `export const maxDuration = 300;` to `src/app/maintenance/[ticketId]/page.tsx`
  and `src/app/contractors/[vendorId]/page.tsx` (both host `EntityDocuments`,
  whose `registerUpload` runs the reader in `after()`).
- **Insurance:** `prepareFiles` is typed `(files) => Promise<File[] | { error: string }>`
  (§17), `beforeList` and `groupAsOne` exist; `registerUpload` with an explicit
  `categorySlug` sets `tag_source = 'manual'` (F-3) and `read={false}` sets
  `extraction_state = 'skipped'`.
- **Integration:** `src/app/units/[unitId]/page.tsx` hosts `EntityDocuments`:
  add `export const maxDuration = 300;`. `/security` page and
  `docs/SECURITY_POLICY.md` §7 subprocessor text (Anthropic) per §14.
- **Foundation (F2, ai-max-duration test):** the two documents pages carry the
  literal `export const maxDuration = 300;`.

## Commands run

- `npx vitest run tests/unit/upload-paths.test.ts tests/unit/sniff.test.ts tests/unit/csp.test.ts tests/unit/privacy-page.test.ts tests/unit/upload-copy.test.ts`: 5 files, 77 tests passed.
- `npx tsc --noEmit`: first run showed 3 errors in my `actions.ts` (fixed) and one in `src/lib/ai/structured.ts` (F2's, in progress, missing `./internal`); second run: no errors.
- `npx eslint src/lib/documents src/app/documents src/components/upload src/app/privacy/page.tsx src/lib/security/csp.ts next.config.ts` plus the five new test files: clean.
- `npx vitest run tests/db/document-hub.test.ts tests/db/document-storage.test.ts tests/db/ai-and-uploads.test.ts tests/unit`: 50 files, 590 tests passed.
- `curl http://localhost:3100/privacy`: 200, new copy present. `/documents` redirects to `/login` (not signed in).
