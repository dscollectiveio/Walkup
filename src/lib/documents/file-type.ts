import "server-only";

/**
 * What a file actually is, decided from its bytes. The sniffing itself lives
 * in ./sniff.ts (pure, so the browser can run the same check before a direct
 * upload); this module re-exports it for the server code that already
 * imports from here, and keeps the checksum.
 */
export {
  ACCEPTED_TYPES,
  mimeEssence,
  sniff,
  verifyBlobHead,
  verifyFile,
  type AcceptedType,
  type FileVerdict,
} from "./sniff";

/** SHA-256, hex. Identical bytes are the same document (0020). */
export async function checksum(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
