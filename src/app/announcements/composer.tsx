"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { DirectUpload } from "@/components/upload/direct-upload";
import { btnPrimary, btnSecondary, choiceRow, errorClass, hintClass, inputClass, labelClass, textareaClass } from "@/components/repairs/styles";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  announcementInput,
  attachmentFix,
  ownersReached,
  type AnnouncementInput,
  type AttachableDocument,
} from "@/lib/owner/announcements";
import { saveAnnouncement, shareDocumentWithOwners } from "./actions";

export interface ComposerUnit {
  id: string;
  label: string;
  ownerName: string | null;
}

export interface ComposerInitial {
  id: string | null;
  title: string;
  body: string;
  audience: "all" | "units";
  unitIds: string[];
  pinned: boolean;
  attachmentDocumentId: string | null;
  expiresOn: string | null;
  status: "draft" | "published";
}

const VISIBILITY_WORDS = (d: AttachableDocument) =>
  d.restrictedToUnitId ? "one unit only" : d.visibility === "all_owners" ? "shared with all owners" : "board only";

type Errors = Partial<Record<keyof AnnouncementInput, string>>;

/** Write, aim and post a notice (owner-portal-spec 6.5). Plain text only; the database re-checks every rule. */
export function Composer({
  initial,
  units,
  ownersByUnit,
  documents,
}: {
  initial: ComposerInitial | null;
  units: ComposerUnit[];
  ownersByUnit: Record<string, string[]>;
  documents: AttachableDocument[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const posted = initial?.status === "published";

  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [audience, setAudience] = useState<"all" | "units">(initial?.audience ?? "all");
  const [unitIds, setUnitIds] = useState<string[]>(initial?.unitIds ?? []);
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [expiresOn, setExpiresOn] = useState(initial?.expiresOn ?? "");
  const [docs, setDocs] = useState<AttachableDocument[]>(documents);
  const [attachmentId, setAttachmentId] = useState<string | null>(initial?.attachmentDocumentId ?? null);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const summaryRef = useRef<HTMLParagraphElement>(null);

  const attachment = docs.find((d) => d.id === attachmentId) ?? null;
  const fix = attachment ? attachmentFix(attachment, audience, unitIds) : "none";
  const reach = useMemo(() => ownersReached(audience, unitIds, ownersByUnit), [audience, unitIds, ownersByUnit]);
  const blocked = fix !== "none";

  useEffect(() => {
    if (serverError || Object.keys(errors).length) summaryRef.current?.focus();
  }, [serverError, errors]);

  function toggleUnit(id: string) {
    setUnitIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  /** Validate the form as it stands; shows the problems and returns null, or the clean input. */
  function check(publish: boolean): AnnouncementInput | null {
    setServerError(null);
    const parsed = announcementInput.safeParse({
      id: initial?.id ?? null,
      title,
      body,
      audience,
      unitIds: audience === "units" ? unitIds : [],
      pinned: pinned && publish,
      attachmentDocumentId: attachmentId,
      expiresOn: expiresOn || null,
      publish,
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof AnnouncementInput;
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return null;
    }
    setErrors({});
    return parsed.data;
  }

  function submit(publish: boolean) {
    const input = check(publish);
    if (!input) {
      setConfirming(false);
      return;
    }
    start(async () => {
      const r = await saveAnnouncement(input);
      if ("error" in r) {
        setServerError(r.error);
        if (r.fieldErrors) setErrors(r.fieldErrors);
        setConfirming(false);
        return;
      }
      router.push(`/announcements?tab=${publish ? "posted" : "drafts"}&notice=${publish ? "posted" : "draft"}`);
      router.refresh();
    });
  }

  function share() {
    if (!attachment) return;
    setShareError(null);
    start(async () => {
      const r = await shareDocumentWithOwners(attachment.id);
      if ("error" in r) setShareError(r.error);
      else setDocs((cur) => cur.map((d) => (d.id === attachment.id ? { ...d, visibility: "all_owners", restrictedToUnitId: null } : d)));
    });
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      {serverError || hasErrors ? (
        <p ref={summaryRef} tabIndex={-1} role="alert" className="border-l-[3px] border-bad bg-bad-tint px-4 py-2 text-[14px] text-bad-text">
          {serverError ?? "Fix the highlighted fields."}
        </p>
      ) : null}

      <div>
        <label htmlFor="an-title" className={labelClass}>
          Title
        </label>
        <input
          id="an-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={ANNOUNCEMENT_TITLE_MAX}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? "an-title-error" : undefined}
          className={inputClass}
        />
        {title.length >= 100 ? (
          <p className={hintClass}>
            {title.length} of {ANNOUNCEMENT_TITLE_MAX}
          </p>
        ) : null}
        {errors.title ? (
          <p id="an-title-error" className={errorClass}>
            {errors.title}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="an-body" className={labelClass}>
          Message
        </label>
        <textarea
          id="an-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          maxLength={ANNOUNCEMENT_BODY_MAX}
          aria-invalid={errors.body ? true : undefined}
          aria-describedby={errors.body ? "an-body-error an-body-hint" : "an-body-hint"}
          className={textareaClass}
        />
        <p id="an-body-hint" className={hintClass}>
          Plain text. Owners see it exactly as typed. {body.length.toLocaleString("en-US")} of {ANNOUNCEMENT_BODY_MAX.toLocaleString("en-US")}
        </p>
        {errors.body ? (
          <p id="an-body-error" className={errorClass}>
            {errors.body}
          </p>
        ) : null}
      </div>

      <fieldset>
        <legend className={labelClass}>Who is this for?</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          <label className={choiceRow}>
            <input type="radio" name="audience" checked={audience === "all"} onChange={() => setAudience("all")} />
            All owners
          </label>
          <label className={choiceRow}>
            <input type="radio" name="audience" checked={audience === "units"} onChange={() => setAudience("units")} />
            Chosen units
          </label>
        </div>
      </fieldset>

      {audience === "units" ? (
        <fieldset aria-describedby={errors.unitIds ? "an-units-error" : undefined}>
          <legend className={labelClass}>Which units?</legend>
          <div className="mt-1 flex gap-2">
            <button type="button" className={btnSecondary} onClick={() => setUnitIds(units.map((u) => u.id))}>
              Select all
            </button>
            <button type="button" className={btnSecondary} onClick={() => setUnitIds([])}>
              Clear
            </button>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {units.map((u) => (
              <label key={u.id} className={choiceRow}>
                <input type="checkbox" checked={unitIds.includes(u.id)} onChange={() => toggleUnit(u.id)} />
                <span>
                  {u.label}
                  {u.ownerName ? <span className="text-mute"> · {u.ownerName}</span> : null}
                </span>
              </label>
            ))}
          </div>
          {errors.unitIds ? (
            <p id="an-units-error" className={errorClass}>
              {errors.unitIds}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <div>
        <label className={choiceRow}>
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          Pin it to the top
        </label>
        <p className={hintClass}>Up to three at a time. Pinned posts stay above newer ones. A pin takes effect when you post.</p>
      </div>

      <div>
        <label htmlFor="an-until" className={labelClass}>
          Show until <span className="font-normal text-mute">(optional)</span>
        </label>
        <input id="an-until" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} className={`${inputClass} sm:max-w-[220px]`} />
        <p className={hintClass}>After this day owners no longer see it. Leave empty to keep it up.</p>
        {errors.expiresOn ? <p className={errorClass}>{errors.expiresOn}</p> : null}
      </div>

      <fieldset>
        <legend className={labelClass}>
          Attach a file <span className="font-normal text-mute">(optional)</span>
        </legend>
        <div className="mt-2 space-y-3">
          <DirectUpload
            purpose="document"
            categorySlug="other"
            multiple={false}
            maxFiles={1}
            label="Add a file"
            help="PDF, photo or Office file. Owners can open it from the announcement."
            onUploaded={(uploaded) => {
              const first = uploaded.find((u) => u.documentId ?? u.duplicateOf);
              const id = first?.documentId ?? first?.duplicateOf ?? null;
              if (!id || !first) return;
              setDocs((cur) =>
                cur.some((d) => d.id === id) ? cur : [{ id, title: first.filename, visibility: "board_only", restrictedToUnitId: null }, ...cur],
              );
              setAttachmentId(id);
            }}
          />
          {docs.length > 0 ? (
            <div>
              <label htmlFor="an-doc" className="block text-[13px] text-mute">
                Or pick from Documents
              </label>
              <select
                id="an-doc"
                value={attachmentId ?? ""}
                onChange={(e) => {
                  setAttachmentId(e.target.value || null);
                  setShareError(null);
                }}
                className={inputClass}
              >
                <option value="">No file</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title} ({VISIBILITY_WORDS(d)})
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {attachment ? (
            <div className="rounded-lg border border-line px-3 py-2 text-[13px]">
              <p className="text-ink">
                Attached: <span className="font-medium">{attachment.title}</span>{" "}
                <button type="button" className="ml-1 inline-flex min-h-[44px] items-center underline underline-offset-2" onClick={() => setAttachmentId(null)}>
                  Remove
                </button>
              </p>
              {fix === "share" ? (
                <div className="mt-1 border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-warning-text">
                  <p>Owners can&rsquo;t open this file yet.</p>
                  <button type="button" onClick={share} disabled={pending} className={`${btnSecondary} mt-2`}>
                    Share it with all owners
                  </button>
                </div>
              ) : null}
              {fix === "unit_only" ? (
                <p className="mt-1 border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-warning-text">
                  {audience === "units" && unitIds.length > 1
                    ? "Files can only be attached when you post to everyone or to one unit."
                    : "This file belongs to one unit. Post to that unit only, or pick another file."}
                </p>
              ) : null}
              {shareError ? (
                <p role="alert" className={errorClass}>
                  {shareError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </fieldset>

      <details className="rounded-lg border border-line px-4 py-2">
        <summary className="min-h-[44px] cursor-pointer py-2 text-[13px] font-medium text-ink">Preview</summary>
        <div className="pb-3">
          <p className="break-words text-[18px] font-bold text-ink">{title || "Your title"}</p>
          <div className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{body || "Your message"}</div>
        </div>
      </details>

      <div className="space-y-3 border-t border-line pt-4">
        {confirming ? (
          <div role="group" aria-label="Confirm posting" className="rounded-lg border border-line-strong bg-fill/40 p-4">
            <p className="text-[14px] text-ink">
              This goes to {reach} {reach === 1 ? "owner" : "owners"} now. You can edit it later, but they may already have read it.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button type="button" className={btnPrimary} disabled={pending || blocked} onClick={() => submit(true)}>
                {pending ? "Posting..." : "Post now"}
              </button>
              <button type="button" className={btnSecondary} disabled={pending} onClick={() => setConfirming(false)}>
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            {posted ? (
              <button type="button" className={btnPrimary} disabled={pending || blocked} onClick={() => submit(true)}>
                {pending ? "Saving..." : "Save changes"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={pending || blocked}
                  onClick={() => {
                    if (check(true)) setConfirming(true);
                  }}
                >
                  Post announcement
                </button>
                <button type="button" className={btnSecondary} disabled={pending} onClick={() => submit(false)}>
                  Save draft
                </button>
              </>
            )}
            <Link href="/announcements" className={btnSecondary}>
              Cancel
            </Link>
          </div>
        )}
      </div>
    </form>
  );
}
