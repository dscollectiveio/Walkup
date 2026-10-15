// "You already have this policy" (insurance-spec §6.5a): catches the same
// declarations saved twice through different reads or by hand. Pure.

export interface DuplicateCandidate {
  id: string;
  coverage: string;
  carrier_name: string;
  effective_from: string;
  policy_number: string | null;
  created_at: string;
  archived_at: string | null;
}

const CARRIER_NOISE = new Set(["inc", "incorporated", "company", "co", "the"]);

/** Case-, space- and punctuation-insensitive, with "Inc."/"Company"/"Co." ignored. */
export function carrierKey(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t && !CARRIER_NOISE.has(t))
    .join("");
}

/** Digits and letters only, case-insensitive; null when nothing is left. */
export function policyNumberKey(n: string | null): string | null {
  const k = (n ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return k === "" ? null : k;
}

/**
 * A non-archived policy with the same coverage, the same carrier (case- and
 * space-insensitive, "Inc."/"Company"/"Co." and punctuation ignored) and the
 * same effective_from, and, when both have one, the same policy number
 * (digits and letters only, case-insensitive). Ignores `exceptId` (the policy
 * being edited). Returns the oldest match.
 */
export function findDuplicatePolicy(
  candidate: { coverage: string; carrier_name: string; effective_from: string; policy_number: string | null },
  existing: DuplicateCandidate[],
  exceptId: string | null,
): DuplicateCandidate | null {
  const carrier = carrierKey(candidate.carrier_name);
  const number = policyNumberKey(candidate.policy_number);
  const matches = existing.filter((p) => {
    if (p.archived_at || p.id === exceptId) return false;
    if (p.coverage !== candidate.coverage || p.effective_from !== candidate.effective_from) return false;
    if (carrierKey(p.carrier_name) !== carrier) return false;
    const other = policyNumberKey(p.policy_number);
    return number === null || other === null || number === other;
  });
  matches.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return matches[0] ?? null;
}
