import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { stripeConfigProblem, stripeIsLive } from "@/lib/billing/config";
import { StripeError, stripeRequest } from "@/lib/billing/stripe";

/**
 * Stripe Connect (Standard, OAuth) for online dues payments, DECISIONS #57.
 * The association connects its own Stripe account. Walkup keeps only the
 * account id (acct_...): the OAuth access token Stripe returns is dropped,
 * and every later call uses the platform key with the Stripe-Account header.
 */

const OAUTH = "https://connect.stripe.com/oauth";
const STATE_TTL_MS = 30 * 60_000;

/** Why online payments can't be set up right now, in plain words, or null when they can. */
export function connectConfigProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  // A board admin can't act on which key is missing, so one plain sentence for all of them.
  const NOT_YET = "Online payments aren't available in Walkup yet.";
  if (stripeConfigProblem(env)) return NOT_YET;
  const id = env.STRIPE_CONNECT_CLIENT_ID?.trim();
  if (!id || !/^ca_[A-Za-z0-9]+$/.test(id)) return NOT_YET;
  return null;
}

// ---------------------------------------------------------------------------
// The OAuth state: who started the connection, for which building, until when.
// Signed, so a callback can't be forged or pointed at another association, and
// bound to the user, so someone else's link can't connect their Stripe account
// to your building.
// ---------------------------------------------------------------------------

export interface ConnectState {
  associationId: string;
  userId: string;
  expiresAt: number;
}

function stateKey(env: NodeJS.ProcessEnv): Buffer {
  const secret = env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("STRIPE_SECRET_KEY is not set");
  return createHmac("sha256", secret).update("walkup:connect-state:v1").digest();
}

const b64url = (b: Buffer) => b.toString("base64url");

export function signConnectState(
  input: { associationId: string; userId: string },
  opts: { now?: number; env?: NodeJS.ProcessEnv } = {},
): string {
  const env = opts.env ?? process.env;
  const body: ConnectState & { n: string } = {
    associationId: input.associationId,
    userId: input.userId,
    expiresAt: (opts.now ?? Date.now()) + STATE_TTL_MS,
    n: b64url(randomBytes(9)),
  };
  const payload = b64url(Buffer.from(JSON.stringify(body)));
  const mac = b64url(createHmac("sha256", stateKey(env)).update(payload).digest());
  return `${payload}.${mac}`;
}

/** The state's contents when the signature checks out and it hasn't expired, else null. */
export function verifyConnectState(
  state: string | null | undefined,
  opts: { now?: number; env?: NodeJS.ProcessEnv } = {},
): ConnectState | null {
  if (!state || state.length > 1000) return null;
  const [payload, mac, extra] = state.split(".");
  if (!payload || !mac || extra !== undefined) return null;
  let expected: Buffer;
  try {
    expected = createHmac("sha256", stateKey(opts.env ?? process.env)).update(payload).digest();
  } catch {
    return null;
  }
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<ConnectState>;
    if (typeof body.associationId !== "string" || typeof body.userId !== "string" || typeof body.expiresAt !== "number") return null;
    if (body.expiresAt < (opts.now ?? Date.now())) return null;
    return { associationId: body.associationId, userId: body.userId, expiresAt: body.expiresAt };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The OAuth calls
// ---------------------------------------------------------------------------

/** Stripe's page where the board admin signs in to (or creates) the association's Stripe account. */
export function connectAuthorizeUrl(input: { state: string; redirectUri: string; env?: NodeJS.ProcessEnv }): string {
  const env = input.env ?? process.env;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.STRIPE_CONNECT_CLIENT_ID!.trim(),
    scope: "read_write",
    state: input.state,
    redirect_uri: input.redirectUri,
  });
  return `${OAUTH}/authorize?${params.toString()}`;
}

async function oauthPost<T>(path: string, params: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<T> {
  const problem = connectConfigProblem();
  if (problem) throw new StripeError(problem, 0, "not_configured");
  const res = await fetchImpl(`${OAUTH}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY!.trim()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: string; error_description?: string })
    | null;
  if (!res.ok || !json || json.error) {
    throw new StripeError(json?.error_description ?? `Stripe answered ${res.status}`, res.status, json?.error);
  }
  return json;
}

/** Trades the one-time code for the connected account id. The access token is not kept. */
export async function exchangeConnectCode(
  code: string,
  fetchImpl?: typeof fetch,
): Promise<{ stripeAccountId: string; livemode: boolean }> {
  const r = await oauthPost<{ stripe_user_id?: string; livemode?: boolean }>(
    "token",
    { grant_type: "authorization_code", code },
    fetchImpl,
  );
  if (!r.stripe_user_id || !/^acct_[A-Za-z0-9]+$/.test(r.stripe_user_id)) {
    throw new StripeError("Stripe didn't return an account.", 502);
  }
  const livemode = r.livemode === true;
  if (livemode !== stripeIsLive()) {
    throw new StripeError("That Stripe account is in the wrong mode (test vs live).", 400, "mode_mismatch");
  }
  return { stripeAccountId: r.stripe_user_id, livemode };
}

/** Disconnects Walkup from the account at Stripe. Already disconnected counts as done. */
export async function deauthorizeConnectAccount(stripeAccountId: string, fetchImpl?: typeof fetch): Promise<void> {
  try {
    await oauthPost(
      "deauthorize",
      { client_id: process.env.STRIPE_CONNECT_CLIENT_ID!.trim(), stripe_user_id: stripeAccountId },
      fetchImpl,
    );
  } catch (e) {
    if (e instanceof StripeError && (e.code === "invalid_client" || e.status === 401)) return;
    throw e;
  }
}

export interface ConnectAccountStatus {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

/** Whether Stripe will take payments for the account and pay them out yet. */
export async function fetchConnectAccountStatus(stripeAccountId: string): Promise<ConnectAccountStatus> {
  const a = await stripeRequest<{ charges_enabled?: boolean; payouts_enabled?: boolean; details_submitted?: boolean }>(
    "GET",
    `/accounts/${encodeURIComponent(stripeAccountId)}`,
  );
  return {
    chargesEnabled: a.charges_enabled === true,
    payoutsEnabled: a.payouts_enabled === true,
    detailsSubmitted: a.details_submitted === true,
  };
}
