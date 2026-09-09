"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { useRouter } from "next/navigation";
import { connectBank, createLinkToken } from "./actions";
import { clearLinkTokenForOAuth, storeLinkTokenForOAuth } from "./oauth-link-token";

export function ConnectBankButton() {
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
        <PlaidLinkButton linkToken={linkToken} onError={setError} />
      ) : (
        <button
          type="button"
          disabled
          className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper opacity-50"
        >
          {error ? "Connect your bank" : "Loading…"}
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

function PlaidLinkButton({
  linkToken,
  onError,
}: {
  linkToken: string;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);

  const onSuccess = useCallback(
    async (publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => {
      clearLinkTokenForOAuth();
      if (!publicToken) return;
      setConnecting(true);
      onError("");
      const result = await connectBank(
        publicToken,
        metadata.institution?.name ?? "Connected account",
      );
      setConnecting(false);
      if (result.error) onError(result.error);
      else router.refresh();
    },
    [router, onError],
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
        storeLinkTokenForOAuth(linkToken);
        open();
      }}
      disabled={!ready || connecting}
      className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper transition hover:bg-ink-mid disabled:opacity-50"
    >
      {connecting ? "Connecting…" : "Connect your bank"}
    </button>
  );
}
