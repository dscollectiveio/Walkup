"use client";

import { useEffect, useState } from "react";
import { createUpdateLinkToken, reconnectBank } from "./actions";
import { PlaidLinkButton } from "./connect-bank-button";

const STYLE =
  "inline-flex h-9 items-center whitespace-nowrap rounded-md bg-ink px-3 text-[13px] font-medium text-paper transition-colors hover:bg-ink-mid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:opacity-50";

/**
 * "Reconnect Chase": opens Plaid Link in update mode so the person signs in
 * at the bank again. Nothing is re-imported — the connection, its history
 * and every posting stay as they were; on success the connection is marked
 * active and synced.
 */
export function ReconnectButton({
  connectionId,
  institutionName,
}: {
  connectionId: string;
  institutionName: string;
}) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = `Reconnect ${institutionName}`;

  useEffect(() => {
    createUpdateLinkToken(connectionId).then((result) => {
      if (result.error) setError(result.error);
      else setLinkToken(result.linkToken ?? null);
    });
  }, [connectionId]);

  return (
    <div>
      {linkToken ? (
        <PlaidLinkButton
          linkToken={linkToken}
          onError={setError}
          label={label}
          busyLabel="Reconnecting…"
          className={STYLE}
          reconnectConnectionId={connectionId}
          onLinked={() => reconnectBank(connectionId)}
        />
      ) : (
        <button type="button" disabled className={STYLE}>
          {error ? label : "Loading…"}
        </button>
      )}
      {error ? <p className="mt-2 text-[12px] text-bad-text">{error}</p> : null}
    </div>
  );
}
