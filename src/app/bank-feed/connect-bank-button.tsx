"use client";

import { useCallback, useEffect, useState } from "react";
import {
  usePlaidLink,
  type PlaidLinkOnSuccessMetadata,
} from "react-plaid-link";
import { useRouter } from "next/navigation";
import { connectBank, createLinkToken } from "./actions";
import {
  clearLinkTokenForOAuth,
  storeLinkTokenForOAuth,
} from "./oauth-link-token";

const STYLES = {
  primary:
    "min-h-[44px] rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper transition hover:bg-ink-mid disabled:opacity-50",
  outline:
    "inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-line-strong bg-paper px-3 py-1.5 sm:min-h-0 text-[12px] font-medium text-ink transition hover:bg-fill disabled:opacity-50",
};

/** January 1 of this year: where most associations' books begin. */
function defaultBooksStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

export function ConnectBankButton({
  label = "Connect your bank",
  variant = "primary",
}: {
  label?: string;
  variant?: keyof typeof STYLES;
} = {}) {
  // A Link token is made for one books start date; changing the date makes a new one.
  const [issued, setIssued] = useState<{ start: string; token: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  // Asked up front, so the list starts short: only activity from this date on comes in.
  const asksStart = variant === "primary";
  const [booksStart, setBooksStart] = useState(
    asksStart ? defaultBooksStart : "",
  );
  const linkToken = issued && issued.start === booksStart ? issued.token : null;

  useEffect(() => {
    let current = true;
    createLinkToken(booksStart || undefined).then((result) => {
      if (!current) return;
      if (result.error) setError(result.error);
      else if (result.linkToken) {
        setError(null);
        setIssued({ start: booksStart, token: result.linkToken });
      }
    });
    return () => {
      current = false;
    };
  }, [booksStart]);

  return (
    <div>
      {asksStart ? (
        <label className="mb-3 block text-[13px] text-ink">
          When do your books start?
          <input
            type="date"
            value={booksStart}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setBooksStart(e.target.value)}
            className="mt-1 block min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 py-1.5 text-[16px] text-ink sm:min-h-0 sm:text-[13px]"
          />
          <span className="mt-1 block text-[12px] text-mute">
            Only activity from this date on is brought in, up to two years back.
          </span>
        </label>
      ) : null}
      {/* usePlaidLink must never see a placeholder token — it does not
          re-initialize its Link instance when the token option changes
          later, so mounting it early with "" left it permanently stuck on
          an empty token even after the real one arrived. Mounting this
          component only once linkToken is real avoids that entirely. */}
      {linkToken ? (
        <PlaidLinkButton
          key={linkToken}
          linkToken={linkToken}
          onError={setError}
          label={label}
          busyLabel="Connecting…"
          className={STYLES[variant]}
          onLinked={(publicToken, metadata) =>
            connectBank(
              publicToken,
              metadata.institution?.name ?? "Connected account",
            )
          }
        />
      ) : (
        <button type="button" disabled className={STYLES[variant]}>
          {error ? label : "Loading…"}
        </button>
      )}
      {error ? (
        <p className="mt-3 border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Opens Plaid Link for a ready token and hands the result to `onLinked` —
 * connectBank for a new bank, reconnectBank for update mode. Shared so the
 * OAuth stash/clear dance lives in one place.
 */
export function PlaidLinkButton({
  linkToken,
  onError,
  label,
  busyLabel,
  className,
  onLinked,
  reconnectConnectionId,
}: {
  linkToken: string;
  onError: (message: string) => void;
  label: string;
  busyLabel: string;
  className: string;
  onLinked: (
    publicToken: string,
    metadata: PlaidLinkOnSuccessMetadata,
  ) => Promise<{ error?: string }>;
  /** Set for update mode, so an OAuth round trip comes back knowing which connection to repair. */
  reconnectConnectionId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onSuccess = useCallback(
    async (
      publicToken: string | null,
      metadata: PlaidLinkOnSuccessMetadata,
    ) => {
      clearLinkTokenForOAuth();
      if (!publicToken) return;
      setBusy(true);
      onError("");
      const result = await onLinked(publicToken, metadata);
      setBusy(false);
      if (result.error) onError(result.error);
      else router.refresh();
    },
    [router, onError, onLinked],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: clearLinkTokenForOAuth,
  });

  return (
    <button
      type="button"
      onClick={() => {
        // Stashed before open(), not on success — an OAuth institution
        // leaves the page entirely, so this has to be in place before the
        // redirect, not after it returns. /bank-feed/oauth reads it back.
        storeLinkTokenForOAuth(linkToken, reconnectConnectionId);
        open();
      }}
      disabled={!ready || busy}
      className={className}
    >
      {busy ? busyLabel : label}
    </button>
  );
}
