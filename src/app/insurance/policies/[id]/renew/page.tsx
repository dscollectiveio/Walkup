import Link from "next/link";
import { notFound } from "next/navigation";
import { aiConfigured } from "@/lib/ai/client";
import { createClient } from "@/lib/supabase/server";
import { Card, Restricted } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { coverageShort } from "@/lib/insurance/coverage";
import { formatMoney } from "@/lib/insurance/format";
import { loadInsuranceContext, loadPolicy } from "@/lib/insurance/queries";
import { ImportUploader } from "../../../components/insurance-uploader";
import { BackLink } from "../../../components/page-header";
import { btnGhost } from "../../../components/styles";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** /insurance/policies/[id]/renew (§9.4.1): upload the renewal, start from a quote, or copy last term. */
export default async function RenewPolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.isBoard) return <Restricted what="insurance records" />;
  const policy = await loadPolicy(supabase, id, ctx.todayIso);
  if (!policy) notFound();
  const aiOn = aiConfigured();

  const { data: quoteRows } = await supabase
    .from("insurance_quotes")
    .select("id, carrier_name, annual_premium::text, quoted_on, declined_at")
    .eq("association_id", ctx.association.id)
    .eq("coverage", policy.coverage)
    .is("declined_at", null)
    .order("quoted_on", { ascending: false });
  const quotes = (quoteRows ?? []) as unknown as { id: string; carrier_name: string; annual_premium: string; quoted_on: string }[];

  return (
    <div className="space-y-6">
      <BackLink href={`/insurance/policies/${id}`}>Back to the policy</BackLink>
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">
          Renew {coverageShort(policy.coverage)}: {policy.carrier_name}
        </h1>
        <p className="mt-1 text-mute">Choose how to add the new term. The current policy stays active until the new one starts.</p>
      </div>

      <Card navy title="Upload the renewal declarations">
        <div className="space-y-3">
          <p className="text-[13px] text-ink">
            {aiOn
              ? "The most accurate. Walkup reads the new figures."
              : "Keep the new declarations on file, then enter the figures."}
          </p>
          <ImportUploader
            aiOn={aiOn}
            replacesPolicyId={policy.id}
            manualHref={`/insurance/policies/new?renews=${policy.id}&document={id}`}
          />
        </div>
      </Card>

      {quotes.length > 0 ? (
        <Card navy title="Start from a quote you received">
          <ul className="divide-y divide-line">
            {quotes.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="text-[13px]">
                  <div className="font-medium text-ink">{q.carrier_name}</div>
                  <div className="text-mute">
                    <span className="figures">{formatMoney(q.annual_premium)}</span> a year · quoted {shortDate(q.quoted_on, ctx.todayIso)}
                  </div>
                </div>
                <Link href={`/insurance/policies/new?from_quote=${q.id}`} className={btnGhost}>
                  Start from this quote
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card navy title="Copy last term and edit">
        <div className="space-y-3">
          <p className="text-[13px] text-ink">
            Last term&rsquo;s details are filled in, with the dates moved on a year. You enter the new premium.
          </p>
          <Link href={`/insurance/policies/new?renews=${policy.id}`} className={btnGhost}>
            Copy last term
          </Link>
        </div>
      </Card>
    </div>
  );
}
