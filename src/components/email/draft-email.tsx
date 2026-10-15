"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { getDownloadUrl } from "@/app/documents/actions";
import { longDate, todayIso } from "@/lib/dates";
import {
  composeHref,
  findBlanks,
  fitsMailto,
  parseEmailList,
  parseEmailListDetailed,
  pasteHref,
  plainTextEmail,
  type MailApp,
} from "@/lib/email/mailto";
import {
  blankSegments,
  blanksMessage,
  DRAFT_COPY,
  draftChanged,
  invalidMessage,
  MAIL_APP_STORAGE_KEY,
  nextPromptState,
  otherAppLabel,
  otherApps,
  parseMailApp,
  primaryState,
  type PromptEvent,
  type PromptState,
} from "./draft-email-state";

/**
 * The shared email draft (brief decision 8): edit, open in the board
 * member's own mail app (or Gmail / Outlook.com), copy, attach downloads,
 * mark as sent. Walkup never sends anything; the record of what was sent is
 * what the board edited, passed to onMarkSent.
 *
 * Rules for areas: one DraftEmail per contractor or agent (never several
 * businesses in one `to`); owner notices put the sender's own address in
 * `to` and owners in `bcc`.
 */

type Final = { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string };
type Result = { ok: true } | { error: string };

export interface DraftEmailProps {
  to: string[];
  subject: string;
  body: string;
  editable?: boolean;                               // default true
  onMarkSent?: (final: Final) => Promise<Result>;
  sentAt?: string | null;                           // ISO timestamp or date
  cc?: string[];
  bcc?: string[];
  title?: string;                                   // optional eyebrow, e.g. "Quote request to Acme Insurance"
  note?: string;                                    // e.g. "A mail link can't carry attachments. Download the declarations below and attach it."
  attachments?: { documentId: string; filename: string }[];
  warnings?: string[];                              // from draftEmail()
  onSave?: (draft: Final) => Promise<Result>;
  /** Called on every edit, so an area can persist edits made here (insurance-spec F-1). */
  onChange?: (v: { to: string[]; subject: string; body: string }) => void;
  /** Called by every "open" path: mail app, Gmail, Outlook.com, copy-and-open (repairs-spec 18.12 b). */
  onOpenMailApp?: () => void;
}

// The remembered mail app: a per-browser convenience in localStorage, read
// through useSyncExternalStore so the server render ("mailto") never
// mismatches. Storage can throw (private mode); a module variable keeps the
// choice for this page view anyway.
const APP_EVENT = "walkup:mail-app";
let memoryApp: MailApp | null = null;

function readApp(): MailApp {
  try {
    const stored = window.localStorage.getItem(MAIL_APP_STORAGE_KEY);
    if (stored) return parseMailApp(stored);
  } catch {
    // fall through to the in-memory choice
  }
  return memoryApp ?? "mailto";
}

function rememberApp(app: MailApp) {
  memoryApp = app;
  try {
    window.localStorage.setItem(MAIL_APP_STORAGE_KEY, app);
  } catch {
    // kept in memory only
  }
  window.dispatchEvent(new Event(APP_EVENT));
}

function subscribeApp(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(APP_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(APP_EVENT, cb);
  };
}

const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-60";
const btnSecondary =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-60";
const btnGhost =
  "inline-flex min-h-[44px] items-center justify-center rounded-md px-3 py-2 text-[13px] font-medium text-ink underline-offset-2 hover:underline disabled:opacity-60";
const inputClass =
  "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[16px] text-ink sm:text-[14px]";
const labelClass = "block text-[12px] font-medium text-ink";

const joinList = (xs: string[] | undefined) => (xs ?? []).join(", ");

export function DraftEmail(props: DraftEmailProps) {
  const {
    editable = true, onMarkSent, onSave, onChange, onOpenMailApp,
    title, note, attachments, warnings, sentAt,
  } = props;
  const id = useId();

  const seedOf = () => ({
    to: joinList(props.to), cc: joinList(props.cc), bcc: joinList(props.bcc),
    subject: props.subject, body: props.body,
  });
  const [seed, setSeed] = useState(seedOf);
  const [toText, setToText] = useState(seed.to);
  const [ccText, setCcText] = useState(seed.cc);
  const [bccText, setBccText] = useState(seed.bcc);
  const [subject, setSubject] = useState(seed.subject);
  const [body, setBody] = useState(seed.body);
  const [saved, setSaved] = useState(seed);
  const [showCopies, setShowCopies] = useState(Boolean(seed.cc || seed.bcc));
  const [invalid, setInvalid] = useState<{ to: string[]; cc: string[]; bcc: string[] }>({ to: [], cc: [], bcc: [] });
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, setPending] = useState<"save" | "mark" | "download" | null>(null);
  const [markedOn, setMarkedOn] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PromptState>("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const readOnlyRef = useRef<HTMLDivElement>(null);

  // A new draft (new subject or body from the caller) re-seeds the editor.
  if (seed.subject !== props.subject || seed.body !== props.body) {
    const next = seedOf();
    setSeed(next);
    setToText(next.to);
    setCcText(next.cc);
    setBccText(next.bcc);
    setSubject(next.subject);
    setBody(next.body);
    setSaved(next);
    setShowCopies(Boolean(next.cc || next.bcc));
    setInvalid({ to: [], cc: [], bcc: [] });
    setStatus(null);
  }

  const app = useSyncExternalStore(subscribeApp, readApp, () => "mailto" as MailApp);

  const to = parseEmailList(toText);
  const cc = parseEmailList(ccText);
  const bcc = parseEmailList(bccText);
  const final: Final = { to, cc, bcc, subject, body };
  const blanks = findBlanks(subject, body);
  const fits = fitsMailto(subject, body);
  const primary = primaryState(blanks.length, fits, app);
  const sent = Boolean(sentAt || markedOn);
  const sentDate = markedOn ?? sentAt ?? null;
  const canMark = Boolean(onMarkSent);
  const changed = draftChanged({ to: toText, cc: ccText, bcc: bccText, subject, body }, saved);

  const promptEvent = (event: PromptEvent) =>
    setPrompt((s) => nextPromptState(s, event, { canMark, sent }));

  // "Did you send it?": the person comes back from their mail app.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setPrompt((s) => nextPromptState(s, "visible", { canMark, sent }));
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [canMark, sent]);

  function emitChange(next: { to?: string; subject?: string; body?: string }) {
    onChange?.({
      to: parseEmailList(next.to ?? toText),
      subject: next.subject ?? subject,
      body: next.body ?? body,
    });
  }

  function selectText() {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
      return;
    }
    const el = readOnlyRef.current;
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (el && sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  async function copy(text: string): Promise<boolean> {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setStatus({ text: DRAFT_COPY.copied });
      return true;
    } catch {
      selectText();
      setStatus({ text: DRAFT_COPY.copyFailed });
      return false;
    }
  }

  function opened(chosen: MailApp) {
    rememberApp(chosen);
    onOpenMailApp?.();
    promptEvent("opened");
  }

  async function copyAndOpen(chosen: MailApp) {
    await copy(body);
    const href = pasteHref(chosen, to, subject, { cc, bcc });
    opened(chosen);
    if (chosen === "mailto") window.location.assign(href);
    else window.open(href, "_blank", "noopener,noreferrer");
  }

  async function save() {
    if (!onSave) return;
    setPending("save");
    const r = await onSave(final);
    setPending(null);
    if ("error" in r) {
      setStatus({ text: r.error, bad: true });
      return;
    }
    setSaved({ to: toText, cc: ccText, bcc: bccText, subject, body });
    setStatus({ text: DRAFT_COPY.saved });
  }

  async function markSent() {
    if (!onMarkSent) return;
    setPending("mark");
    const r = await onMarkSent(final);
    setPending(null);
    if ("error" in r) {
      setStatus({ text: r.error, bad: true });
      return;
    }
    const today = todayIso();
    setMarkedOn(today);
    setPrompt("idle");
    setStatus(null); // the sent line below, inside the live region, says it
  }

  async function download(documentId: string) {
    setPending("download");
    try {
      const r = await getDownloadUrl(documentId);
      if ("error" in r) setStatus({ text: r.error, bad: true });
      else window.location.assign(r.url);
    } catch {
      setStatus({ text: "Couldn't start the download. Try again.", bad: true });
    } finally {
      setPending(null);
    }
  }

  function appAction(chosen: MailApp, label: string, className: string, key?: string) {
    if (fits) {
      const href = composeHref(chosen, to, subject, body, { cc, bcc });
      const external = chosen !== "mailto";
      return (
        <a
          key={key}
          href={href}
          className={className}
          onClick={() => opened(chosen)}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {label}
        </a>
      );
    }
    return (
      <button key={key} type="button" className={className} onClick={() => void copyAndOpen(chosen)}>
        {label}
      </button>
    );
  }

  const primaryButton = appAction(app, primary.label, primary.style === "primary" ? btnPrimary : btnSecondary);
  const copyButton = (
    <button type="button" className={btnSecondary} onClick={() => void copy(plainTextEmail(subject, body))}>
      Copy text
    </button>
  );
  const others = otherApps(app).map((a) => appAction(a, otherAppLabel(a, fits), btnSecondary, a));
  const saveButton =
    onSave && changed ? (
      <button type="button" className={btnSecondary} disabled={pending === "save"} onClick={() => void save()}>
        {pending === "save" ? "Saving…" : "Save changes"}
      </button>
    ) : null;
  const markButton = onMarkSent ? (
    sent ? (
      <button type="button" className={btnGhost} disabled={pending === "mark"} onClick={() => void markSent()}>
        {pending === "mark" ? "Recording…" : DRAFT_COPY.sentAgain}
      </button>
    ) : (
      <button type="button" className={btnSecondary} disabled={pending === "mark"} onClick={() => void markSent()}>
        {pending === "mark" ? "Recording…" : "Mark as sent"}
      </button>
    )
  ) : null;

  const askPrompt =
    prompt === "asking" && canMark && !sent ? (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-fill px-3 py-2">
        <span className="text-[13px] font-medium text-ink">{DRAFT_COPY.didYouSend}</span>
        <button type="button" className={btnPrimary} disabled={pending === "mark"} onClick={() => void markSent()}>
          {pending === "mark" ? "Recording…" : DRAFT_COPY.yesMark}
        </button>
        <button type="button" className={btnGhost} onClick={() => promptEvent("notYet")}>
          {DRAFT_COPY.notYet}
        </button>
      </div>
    ) : null;

  const hint = <p className="text-[12px] text-mute">{DRAFT_COPY.nothingOpened}</p>;

  function recipientField(
    which: "to" | "cc" | "bcc",
    label: string,
    value: string,
    set: (v: string) => void,
    extra?: string,
  ) {
    const fieldId = `${id}-${which}`;
    const bad = invalidMessage(invalid[which]);
    return (
      <div>
        <label htmlFor={fieldId} className={labelClass}>
          {label}
        </label>
        <input
          id={fieldId}
          type="text"
          inputMode="email"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            set(e.target.value);
            if (which === "to") emitChange({ to: e.target.value });
          }}
          onBlur={() => setInvalid((s) => ({ ...s, [which]: parseEmailListDetailed(value).invalid }))}
          aria-describedby={bad || extra ? `${fieldId}-help` : undefined}
          className={inputClass}
        />
        {bad || extra ? (
          <p id={`${fieldId}-help`} className="mt-1 text-[12px]">
            {bad ? <span className="block text-warning-text">{bad}</span> : null}
            {extra ? <span className="block text-mute">{extra}</span> : null}
          </p>
        ) : null}
      </div>
    );
  }

  const rows = Math.min(28, Math.max(9, body.split("\n").length + 1));
  const blanksLine = blanksMessage(blanks);

  return (
    <div className="space-y-4">
      {title ? <p className="eyebrow text-mute">{title}</p> : null}

      {editable ? (
        <div className="space-y-3">
          {recipientField("to", "To", toText, setToText)}
          {to.length === 0 ? <p className="text-[12px] text-warning-text">{DRAFT_COPY.noRecipient}</p> : null}
          {showCopies ? (
            <>
              {recipientField("cc", "Cc", ccText, setCcText)}
              {recipientField("bcc", "Bcc", bccText, setBccText, DRAFT_COPY.bccHint)}
            </>
          ) : (
            <button type="button" className="text-[12px] font-medium text-ink underline underline-offset-2" onClick={() => setShowCopies(true)}>
              {DRAFT_COPY.addCcBcc}
            </button>
          )}
          <div>
            <label htmlFor={`${id}-subject`} className={labelClass}>
              Subject
            </label>
            <input
              id={`${id}-subject`}
              type="text"
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                emitChange({ subject: e.target.value });
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`${id}-body`} className={labelClass}>
              Message
            </label>
            <div className="relative mt-1">
              <div
                ref={mirrorRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-lg border border-transparent px-3 py-2 font-sans text-[16px] leading-relaxed text-transparent sm:text-[14px]"
              >
                {blankSegments(body).map((s, i) =>
                  s.blank ? (
                    <span key={i} className="rounded-sm bg-warning-tint">
                      {s.text}
                    </span>
                  ) : (
                    <span key={i}>{s.text}</span>
                  ),
                )}
                {"\n"}
              </div>
              <textarea
                ref={textareaRef}
                id={`${id}-body`}
                rows={rows}
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  emitChange({ body: e.target.value });
                }}
                onScroll={(e) => {
                  if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
                }}
                className="relative block w-full resize-y rounded-lg border border-line-strong bg-transparent px-3 py-2 font-sans text-[16px] leading-relaxed text-ink sm:min-h-[20rem] sm:text-[14px]"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2 text-[13px]">
          <p>
            <span className="text-mute">To: </span>
            <span className="text-ink">{to.length ? to.join(", ") : "No recipient"}</span>
          </p>
          {to.length === 0 ? <p className="text-[12px] text-warning-text">{DRAFT_COPY.noRecipient}</p> : null}
          {cc.length ? (
            <p>
              <span className="text-mute">Cc: </span>
              <span className="text-ink">{cc.join(", ")}</span>
            </p>
          ) : null}
          {bcc.length ? (
            <p>
              <span className="text-mute">Bcc: </span>
              <span className="text-ink">{bcc.join(", ")}</span>
              <span className="block text-[12px] text-mute">{DRAFT_COPY.bccHint}</span>
            </p>
          ) : null}
          <p>
            <span className="text-mute">Subject: </span>
            <span className="text-ink">{subject}</span>
          </p>
          <div
            ref={readOnlyRef}
            className="whitespace-pre-wrap break-words rounded-lg border border-line bg-paper px-3 py-2 font-sans text-[14px] leading-relaxed text-ink"
          >
            {blankSegments(body).map((s, i) =>
              s.blank ? (
                <mark key={i} className="rounded-sm bg-warning-tint text-ink">
                  {s.text}
                </mark>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </div>
        </div>
      )}

      {warnings && warnings.length > 0 ? (
        <div className="border-l-[3px] border-warning bg-warning-tint px-4 py-3">
          <p className="text-[13px] font-bold text-warning-text">{DRAFT_COPY.checkHeadline}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] text-warning-text">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {blanksLine ? <p className="text-[13px] text-warning-text">{blanksLine}</p> : null}
      {!fits ? <p className="text-[13px] text-mute">{DRAFT_COPY.longDraft}</p> : null}

      {note || (attachments && attachments.length > 0) ? (
        <div className="space-y-2">
          {note ? <p className="text-[13px] text-mute">{note}</p> : null}
          {attachments?.length ? (
            <div className="flex flex-wrap gap-2">
              {attachments.map((a) => (
                <button
                  key={a.documentId}
                  type="button"
                  className={btnSecondary}
                  disabled={pending === "download"}
                  onClick={() => void download(a.documentId)}
                >
                  Download {a.filename} to attach
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* sm and up: one row of actions. */}
      <div className="hidden space-y-2 sm:block">
        {askPrompt}
        <div className="flex flex-wrap gap-2">
          {primaryButton}
          {copyButton}
          {others}
          {saveButton}
          {markButton}
        </div>
        {hint}
      </div>

      {/* Phones: a sticky bar with the two main actions; the rest under "More". */}
      <div
        className="sticky bottom-0 -mx-4 space-y-2 border-t border-line bg-paper px-4 py-3 sm:hidden"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {askPrompt}
        {hint}
        <details>
          <summary className="min-h-[44px] cursor-pointer py-2 text-[13px] font-medium text-ink">More</summary>
          <div className="flex flex-col gap-2 pb-2">
            {others}
            {saveButton}
            {markButton}
          </div>
        </details>
        <div className="grid grid-cols-2 gap-2">
          {primaryButton}
          {copyButton}
        </div>
      </div>

      <div role="status" aria-live="polite" className="space-y-1 text-[13px]">
        {status ? <p className={status.bad ? "text-bad-text" : "text-ink"}>{status.text}</p> : null}
        {sentDate ? <p className="text-good-text">Marked as sent on {longDate(sentDate)}.</p> : null}
      </div>
      <p className="text-[11px] text-mute">{DRAFT_COPY.footer}</p>
    </div>
  );
}
