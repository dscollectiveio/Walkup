"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { useRouter } from "next/navigation";
import { connectBank, createLinkToken } from "./actions";
import { clearLinkTokenForOAuth, storeLinkTokenForOAuth } from "./oauth-link-token";

const STYLES = {
  primary:
    "rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper transition hover:bg-ink-mid disabled:opacity-50",
  outline:
    "inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-paper px-3 py-1.5 text-[12px] font-medium text-ink transition hover:bg-fill disabled:opacity-50",
};

export function ConnectBankButton({
  label = "Connect your bank",
  variant = "primary",
}: {
  label?: string;
  variant?: keyof typeof STYLES;
} = {}) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createLinkToken().then((result) => {
      if (result.error) setError(result.error);
      else setLinkToken(result.linkToken ?? null);
    });
  }, []);

  return (
    <div>
      {/* usePlaidLink must never see a placeholder token — it does not
          re-initialize its Link instance when the token option changes
          later, so mounting it early with "" left it permanently stuck on
          an empty token even after the real one arrived. Mounting this
          component only once linkToken is real avoids that entirely. */}
      {linkToken ? (
        <PlaidLinkButton
          linkToken={linkToken}
          onError={setError}
          label={label}
          busyLabel="Connecting…"
          className={STYLES[variant]}
          onLinked={(publicToken, metadata) =>
            connectBank(publicToken, metadata.institution?.name ?? "Connected account")
          }
        />
      ) : (
        <button
          type="button"
          disabled
          className={STYLES[variant]}
        >
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
  onLinked: (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => Promise<{ error?: string }>;
  /** Set for update mode, so an OAuth round trip comes back knowing which connection to repair. */
  reconnectConnectionId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onSuccess = useCallback(
    async (publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => {
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
