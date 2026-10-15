import Link from "next/link";
import { Card, Stat } from "@/components/ui";
import { longDate } from "@/lib/dates";
import { formatMoney, formatPercent, periodLabel, telHref } from "@/lib/insurance/format";
import type { OwnerSummaryContent } from "@/lib/insurance/owner-summary";
import { COVERAGE_FORM_OWNER_WORDS } from "@/lib/insurance/owner-summary-text";
import { mailtoLink } from "@/lib/email/mailto";

/**
 * What owners see (insurance-spec §9.9, decision 9): the board-published
 * summary of the master policy. The owner page renders it from the
 * published snapshot; the editor renders it from the draft as a preview.
 * No server imports, so both can use it.
 */

function windHail(dollars: string | null, percent: string | null): string | null {
  const pct = formatPercent(percent);
  const min = formatMoney(dollars);
  if (pct) return min ? `${pct} (at least ${min})` : pct;
  return min;
}

export function OwnerSummaryView({
  content,
  publishedAt,
  todayIso,
  askCard,
}: {
  content: OwnerSummaryContent;
  /** The publish date for the footer; null in the editor's preview before publishing. */
  publishedAt: string | null;
  todayIso: string;
  /** "Ask the board for proof of insurance" (the owner page), or nothing (the preview). */
  askCard?: React.ReactNode;
}) {
  const m = content.master;
  const d = content.deductibles;
  const deductibles = [
    { label: "All other perils", value: formatMoney(d.all_perils) },
    { label: "Water damage", value: formatMoney(d.water) },
    { label: "Wind or hail", value: windHail(d.wind_hail, d.wind_hail_percent) },
    { label: "Per unit", value: formatMoney(d.per_unit) },
  ].filter((x): x is { label: string; value: string } => x.value !== null);
  const claimsTel = content.claims_line ? telHref(content.claims_line.phone) : null;
  const cc = content.certificate_contact;
  const ccTel = cc?.phone ? telHref(cc.phone) : null;

  return (
    <div className="space-y-6">
      {m && m.period_to < todayIso ? (
        <p className="border-l-[3px] border-warning bg-warning-tint px-4 py-3 text-[13px] text-warning-text">
          This summary is for the policy period that ended {longDate(m.period_to)}. The board is updating it.
        </p>
      ) : null}

      <Card title="The master policy">
        {m ? (
          <div className="space-y-2 text-[13px] text-ink">
            <p>
              {m.carrier}. {periodLabel(m.period_from, m.period_to)}.
            </p>
            <p>{COVERAGE_FORM_OWNER_WORDS[m.coverage_form]}</p>
          </div>
        ) : (
          <p className="text-[13px] text-ink">The board hasn&rsquo;t named the master policy in this summary.</p>
        )}
      </Card>

      <Card title="If there's damage">
        <div className="space-y-2 text-[13px] text-ink">
          <p>
            <Link href="/repairs" className="font-medium underline underline-offset-2">
              Report it to the board in Repairs.
            </Link>
          </p>
          {content.claims_line ? (
            <p>
              The building&rsquo;s insurer takes claims at{" "}
              {claimsTel ? (
                <a href={claimsTel} className="figures font-medium underline underline-offset-2">
                  {content.claims_line.phone}
                </a>
              ) : (
                <span className="figures">{content.claims_line.phone}</span>
              )}
              . The board usually reports building claims; tell them first.
            </p>
          ) : null}
        </div>
      </Card>

      {deductibles.length > 0 ? (
        <section aria-label="Deductibles" className="space-y-2">
          <h2 className="eyebrow text-mute">Deductibles</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {deductibles.map((x) => (
              <Stat key={x.label} label={x.label} value={x.value} />
            ))}
          </div>
        </section>
      ) : null}

      <Card title="What the master policy usually leaves to owners">
        <div className="space-y-3 text-[13px] text-ink">
          {content.left_to_owners.length ? (
            <ul className="list-disc space-y-1 pl-5">
              {content.left_to_owners.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          ) : null}
          {content.liability_requirement ? <p className="font-bold">{content.liability_requirement}</p> : null}
          {content.tips.length ? (
            <ul className="space-y-2">
              {content.tips.map((t, i) => (
                <li key={i} className="text-mute">
                  {t}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Card>

      <Card title="Proof of insurance for your lender">
        <div className="space-y-3 text-[13px] text-ink">
          <p>{content.certificate_instructions}</p>
          {cc && (cc.email || cc.phone) ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {cc.phone ? (
                ccTel ? (
                  <a href={ccTel} className="figures underline underline-offset-2">
                    {cc.phone}
                  </a>
                ) : (
                  <span className="figures">{cc.phone}</span>
                )
              ) : null}
              {cc.email ? (
                <a href={mailtoLink(cc.email)} className="break-all underline underline-offset-2">
                  {cc.email}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>
      {askCard}

      {content.board_note ? (
        <Card title="A note from the board">
          <p className="whitespace-pre-line text-[13px] text-ink">{content.board_note}</p>
        </Card>
      ) : null}

      <p className="text-[12px] text-mute">
        {publishedAt ? `Published by the board on ${longDate(publishedAt)}. ` : null}
        This is a summary, not the policy. Ask your own agent what&rsquo;s right for your unit.
      </p>
    </div>
  );
}
