"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { useRouter } from "next/navigation";
import { connectBank, createLinkToken } from "./actions";

export function ConnectBankButton() {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    createLinkToken().then((result) => {
      if (result.error) setError(result.error);
      else setLinkToken(result.linkToken ?? null);
    });
  }, []);

  const onSuccess = useCallback(
    async (publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => {
      if (!publicToken) return;
      setConnecting(true);
      setError(null);
      const result = await connectBank(
        publicToken,
        metadata.institution?.name ?? "Connected account",
      );
      setConnecting(false);
      if (result.error) setError(result.error);
      else router.refresh();
    },
    [router],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    onSuccess,
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => open()}
        disabled={!ready || !linkToken || connecting}
        className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper transition hover:bg-ink-mid disabled:opacity-50"
      >
        {connecting ? "Connecting…" : "Connect your bank"}
      </button>
      {error ? (
        <p className="mt-3 border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
