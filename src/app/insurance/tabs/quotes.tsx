import Link from "next/link";
import { Answer, Card, Empty } from "@/components/ui";
import type { runCoverageCheck } from "@/lib/insurance/coverage-check";
import type { InsuranceContext, PolicyWithStatus, Supabase } from "@/lib/insurance/queries";
import { btnGhost, btnPrimary } from "../components/styles";
import { Toast } from "../components/toast";
import { inForceByCoverage, loadMessages, loadQuoteList, loadRequestFlow, loadRequests } from "../quotes-data";
import { MessageList } from "./message-list";
import { QuoteGroups } from "./quote-groups";
import { RequestFlow } from "./request-flow";
import { RequestRows } from "./request-rows";

/**
 * Quotes & emails (insurance-spec §9.7): drafts waiting, quote requests by
 * contact, quotes received by coverage, and every email Walkup drafted.
 * `?new=1` opens the request flow (§9.7.2) at the top; `?drafts=n&open=id`
 * arrives from it with the first draft open.
 */

type Check = ReturnType<typeof runCoverageCheck>;

export interface QuotesSearch {
  new?: string;
  coverage?: string;
  contact?: string;
  drafts?: string;
  open?: string;
}

const isUuid = (v: string | undefined): v is string => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const WRITE_KINDS: { kind: string; label: string }[] = [
  { kind: "certificate_request", label: "Ask for a certificate of insurance" },
  { kind: "claim_report", label: "Report a claim" },
  { kind: "change_request", label: "Ask for a change to a policy" },
  { kind: "coverage_question", label: "Ask a coverage question" },
  { kind: "documents_request", label: "Ask for our current documents" },
  { kind: "quote_follow_up", label: "Follow up on a quote" },
];

/** "Write an email": a disclosure menu of links (no hover-only affordance, §11.6). */
export function WriteEmailMenu({ contactId }: { contactId?: string }) {
  return (
    <details className="relative">
      <summary className={`${btnGhost} cursor-pointer list-none`}>Write an email</summary>
      <ul className="z-20 mt-1 w-full min-w-[16rem] rounded-lg border border-line bg-paper py-1 shadow-lg sm:absolute sm:right-0 sm:w-auto">
        {WRITE_KINDS.map((k) => (
          <li key={k.kind}>
            <Link
              href={`/insurance/emails/new?kind=${k.kind}${contactId ? `&contact=${contactId}` : ""}`}
              className="flex min-h-[44px] items-center px-4 text-[13px] text-ink hover:bg-fill"
            >
              {k.label}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

export async function QuotesTab({
  supabase,
  ctx,
  policies,
  check,
  aiOn,
  sp,
}: {
  supabase: Supabase;
  ctx: InsuranceContext;
  policies: PolicyWithStatus[];
  check: Check;
  aiOn: boolean;
  sp: QuotesSearch;
}) {
  const assoc = ctx.association.id;
  const showFlow = ctx.isBoard && sp.new === "1";
  const [requests, quotes, messages, flow] = await Promise.all([
    loadRequests(supabase, assoc),
    loadQuoteList(supabase, assoc),
    loadMessages(supabase, assoc),
    showFlow ? loadRequestFlow(supabase, ctx, policies, check) : Promise.resolve(null),
  ]);
  const nowPremium: Record<string, string> = {};
  for (const [cov, p] of inForceByCoverage(policies)) nowPremium[cov] = p.annual_premium;
  const drafts = messages.filter((m) => m.status === "draft").length;
  const draftsMade = Number(sp.drafts ?? "0");
  const contactParam = (sp.contact ?? "").split(",").filter(isUuid);

  return (
    <div className="space-y-6">
      {flow ? <RequestFlow data={flow} preselectContacts={contactParam} preselectCoverage={sp.coverage ?? null} /> : null}

      {ctx.isBoard && drafts > 0 ? (
        <Answer status="attention" headline={drafts === 1 ? "1 email is ready to send." : `${drafts} emails are ready to send.`}>
          <a href="#emails" className={btnGhost}>
            Review drafts
          </a>
        </Answer>
      ) : null}

      <Card navy title="Quote requests">
        <div className="space-y-4">
          {ctx.isBoard ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/insurance?view=quotes&new=1" className={btnPrimary}>
                Ask for quotes
              </Link>
              <Link href="/insurance/quotes/new" className={btnGhost}>
                Add a quote you received
              </Link>
            </div>
          ) : null}
          {requests.length === 0 ? (
            <Empty>No quote requests yet. You can ask your agent and other agencies for quotes from here.</Empty>
          ) : (
            <RequestRows requests={requests} canEdit={ctx.isBoard} aiOn={aiOn} todayIso={ctx.todayIso} />
          )}
        </div>
      </Card>

      <Card navy title="Quotes received">
        {quotes.length === 0 ? (
          <Empty>No quotes yet. When one arrives, upload it or enter it here.</Empty>
        ) : (
          <QuoteGroups quotes={quotes} nowPremium={nowPremium} canEdit={ctx.isBoard} todayIso={ctx.todayIso} />
        )}
      </Card>

      <div id="emails" className="scroll-mt-4">
        <Card navy title="Emails">
          <div className="space-y-3">
            {ctx.isBoard ? (
              <div className="flex flex-wrap gap-2">
                <WriteEmailMenu />
              </div>
            ) : null}
            <MessageList
              messages={messages}
              canEdit={ctx.isBoard}
              todayIso={ctx.todayIso}
              openId={ctx.isBoard && isUuid(sp.open) ? sp.open : null}
            />
          </div>
        </Card>
      </div>

      <Toast message={draftsMade > 0 ? `${draftsMade} ${draftsMade === 1 ? "draft" : "drafts"} ready. Open each one to send it from your email.` : null} />
    </div>
  );
}
