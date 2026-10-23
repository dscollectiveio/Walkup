"use client";

import { useRouter } from "next/navigation";
import { ClaimForm } from "../../claims-panel";

/** The claim form as a page (§9.4.3), used from a repair ("Start an insurance claim"). */
export function NewClaim({
  policies,
  defaultPolicyId,
  tickets,
  defaultTicketId,
  defaultDescription,
  claimsLines,
}: {
  policies: { id: string; label: string }[];
  defaultPolicyId: string | null;
  tickets: { id: string; label: string }[];
  defaultTicketId: string | null;
  defaultDescription: string | null;
  claimsLines: Record<string, { carrier: string; phone: string }>;
}) {
  const router = useRouter();
  const ordered = defaultPolicyId
    ? [...policies.filter((p) => p.id === defaultPolicyId), ...policies.filter((p) => p.id !== defaultPolicyId)]
    : policies;
  return (
    <div className="rounded-xl border border-line bg-paper">
      <ClaimForm
        claim={null}
        policyId={null}
        policies={ordered}
        tickets={tickets}
        defaultTicketId={defaultTicketId}
        defaultDescription={defaultDescription}
        claimsLine={ordered[0] ? claimsLines[ordered[0].id] ?? null : null}
        onCancel={() => router.back()}
        onSaved={() => {
          router.push(defaultTicketId ? `/maintenance/${defaultTicketId}` : "/insurance?open=policies#policies");
        }}
      />
    </div>
  );
}
