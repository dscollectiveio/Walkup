"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { connectBank } from "../actions";
import { takeLinkTokenForOAuth } from "../oauth-link-token";

/**
 * Where an OAuth institution (most large US banks in production) sends the
 * browser back after the bank-side authorization step. Plaid requires
 * reopening Link with the SAME token that started the flow plus
 * receivedRedirectUri — a freshly minted token here would be the wrong one.
 * Registered with Plaid as the (query-free) redirect_uri; Plaid appends its
 * own ?oauth_state_id=... on return, which this page never needs to read
 * itself — usePlaidLink handles it via receivedRedirectUri.
 */
export default function BankFeedOAuthPage() {
  const [linkToken, setLinkToken] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Wrapped in a resolved promise, matching the pattern already used in
    // connect-bank-button.tsx — reading localStorage only client-side, but
    // without setState synchronously inside the effect body.
    Promise.resolve().then(() => setLinkToken(takeLinkTokenForOAuth()));
  }, []);

  if (linkToken === undefined) return null;

  if (!linkToken) {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-ink">
          This link expired or was opened in a different browser tab. Starting a
          fresh Link token here wouldn&rsquo;t match what the bank authorized.
        </p>
        <Link href="/bank-feed" className="text-[13px] underline underline-offset-2">
          Start again
        </Link>
      </div>
    );
  }

  return <ResumeLink linkToken={linkToken} error={error} onError={setError} />;
}

function ResumeLink({
  linkToken,
  error,
  onError,
}: {
  linkToken: string;
  error: string | null;
  onError: (message: string) => void;
}) {
  const router = useRouter();

  const onSuccess = useCallback(
    async (publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => {
      if (!publicToken) return;
      const result = await connectBank(
        publicToken,
        metadata.institution?.name ?? "Connected account",
      );
      if (result.error) onError(result.error);
      else router.replace("/bank-feed");
    },
    [router, onError],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    receivedRedirectUri: typeof window !== "undefined" ? window.location.href : undefined,
    onSuccess,
    onExit: (plaidError) => {
      if (plaidError) onError(plaidError.display_message ?? plaidError.error_message ?? "");
      router.replace("/bank-feed");
    },
  });

  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-mute">Finishing up with your bank…</p>
      {error ? (
        <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
