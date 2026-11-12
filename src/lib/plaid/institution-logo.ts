import "server-only";
import { CountryCode, Products } from "plaid";
import { plaidClient, plaidErrorLog } from "@/lib/plaid";

/**
 * The logo of a connected bank, shown beside its name on the bank feed.
 *
 * Source 1 is Plaid: /institutions/search with include_optional_metadata
 * returns each institution's logo as a base64 PNG. It is keyed by the name
 * Link gave us, so it needs no access token and no schema change, every role
 * that can see the bank card can see the logo, and Plaid does not bill for
 * institution lookups.
 *
 * Plaid has no logo on file for some large banks (Chase is one). For those,
 * source 2 is the icon on the bank's own website: Plaid also returns the
 * bank's URL, and Google's public favicon service gives the icon for that
 * domain. Only the bank's public domain is sent, never anything about the
 * association. The image is fetched here and inlined as a data: URI, so the
 * browser never contacts a third party and the CSP stays as it is.
 *
 * Logos almost never change, so an answer is kept for a week per server
 * instance. A miss (no match, or a service down) is kept for an hour so a
 * page with an unlisted bank does not ask on every render. Nothing here is
 * ever fatal: no logo just means the card shows the bank's initial.
 */
const FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;
/** A real icon is a few KB; anything bigger is not something to inline in the page. */
const MAX_ICON_BYTES = 100_000;

const cache = new Map<
  string,
  { at: number; ttl: number; value: string | null }
>();

const keyFor = (name: string) => name.trim().toLowerCase();

/** The bank's own site icon as a data: URI, or null when it has none. */
async function siteIcon(
  url: string | null | undefined,
): Promise<string | null> {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  if (!host) return null;
  try {
    const response = await fetch(
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`,
      {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.startsWith("image/")) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return null;
    return `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/** A `data:` URI for the bank's logo, or null when neither source has one. */
export async function institutionLogo(
  institutionName: string,
): Promise<string | null> {
  const name = institutionName.trim();
  if (!name) return null;
  const key = keyFor(name);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;

  let value: string | null = null;
  try {
    const response = await plaidClient().institutionsSearch({
      query: name,
      // Plaid rejects an empty list; Transactions is the product this app connects with.
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      options: { include_optional_metadata: true },
    });
    const found = response.data.institutions;
    // Exact name only. A near match is a different bank, and showing the wrong
    // bank's logo is worse than showing none.
    const exact = found.find((i) => keyFor(i.name) === key);
    if (exact?.logo) value = `data:image/png;base64,${exact.logo}`;
    else value = await siteIcon(exact?.url);
  } catch (cause) {
    console.warn("Plaid institutionsSearch failed", plaidErrorLog(cause));
  }
  cache.set(key, {
    at: Date.now(),
    ttl: value ? FOUND_TTL_MS : MISS_TTL_MS,
    value,
  });
  return value;
}
