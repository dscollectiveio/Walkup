import { CONTACT_EMAIL, SECURITY_TXT_EXPIRES, SITE_URL } from "@/lib/site-config";

/** RFC 9116: where a researcher reports a vulnerability. Public, plain text. */
export function GET() {
  const body = [
    `Contact: mailto:${CONTACT_EMAIL}`,
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    "Preferred-Languages: en",
    `Canonical: ${SITE_URL}/.well-known/security.txt`,
    `Policy: ${SITE_URL}/security#reporting`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
}
