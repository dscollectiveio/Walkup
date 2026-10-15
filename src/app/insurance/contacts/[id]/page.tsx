import Link from "next/link";
import { notFound } from "next/navigation";
import { aiConfigured } from "@/lib/ai/client";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty } from "@/components/ui";
import { longDate } from "@/lib/dates";
import { coverageShort } from "@/lib/insurance/coverage";
import { formatPhone, telHref } from "@/lib/insurance/format";
import { loadInsuranceContext, loadPolicies } from "@/lib/insurance/queries";
import { BackLink } from "../../components/page-header";
import { PolicyRow } from "../../components/policy-row";
import { CONTACT_SELECT, inForceByCoverage, loadMessages, loadQuoteList, loadRequests, type ContactRow } from "../../quotes-data";
import { CONTACT_KIND_LABEL, contactSourceBadge, hostOf } from "../../quote-helpers";
import { MessageList } from "../../tabs/message-list";
import { QuoteGroups } from "../../tabs/quote-groups";
import { RequestRows } from "../../tabs/request-rows";
import { WriteEmailMenu } from "../../tabs/quotes";
import { ContactActionsBar } from "./contact-actions-bar";
import { mailtoLink } from "@/lib/email/mailto";
import { safeHttpUrl } from "@/lib/security/safe-url";

export const dynamic = "force-dynamic";
// "Upload the quote" on a request row starts a read (insurance-spec §3.1).
export const maxDuration = 300;

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** /insurance/contacts/[id] (insurance-spec §9.11): who they are, and everything the board has done with them. */
export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.canRead) notFound();
  const { data } = await supabase.from("insurance_contacts").select(CONTACT_SELECT).eq("id", id).maybeSingle();
  const contact = (data ?? null) as unknown as ContactRow | null;
  if (!contact) notFound();
  const assoc = ctx.association.id;
  const canEdit = ctx.isBoard;

  const [requests, quotes, messages, policies] = await Promise.all([
    loadRequests(supabase, assoc, { contactId: id }),
    loadQuoteList(supabase, assoc, { contactId: id }),
    loadMessages(supabase, assoc, { contactId: id }),
    loadPolicies(supabase, assoc, ctx.todayIso),
  ]);
  const agentOf = policies.filter((p) => p.agent_contact_id === id && p.status !== "archived");
  const nowPremium: Record<string, string> = {};
  for (const [cov, p] of inForceByCoverage(policies)) nowPremium[cov] = p.annual_premium;
  const tel = contact.phone ? telHref(contact.phone) : null;
  const archived = contact.archived_at !== null;

  return (
    <div className="space-y-6">
      <BackLink href="/insurance?view=market">Marketplace</BackLink>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[20px] font-bold tracking-tight text-ink">{contact.name}</h1>
          {contact.is_current_agent ? <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] text-paper">Your agent</span> : null}
          {archived ? <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] text-mute">Archived</span> : null}
        </div>
        <p className="text-[13px] text-mute">
          {[
            CONTACT_KIND_LABEL[contact.kind] ?? "Contact",
            contact.person_name,
            [contact.city, contact.state_code].filter(Boolean).join(", ") || null,
            contactSourceBadge(contact.source, contact.found_at, ctx.todayIso),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {contact.phone ? (
            tel ? (
              <a href={tel} className="figures text-ink underline underline-offset-2">
                {formatPhone(contact.phone)}
              </a>
            ) : (
              <span className="figures text-ink">{contact.phone}</span>
            )
          ) : null}
          {contact.email ? (
            <a href={mailtoLink(contact.email)} className="break-all text-ink underline underline-offset-2">
              {contact.email}
            </a>
          ) : null}
          {contact.website_url ? (
            <a href={safeHttpUrl(contact.website_url) ?? undefined} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
              {hostOf(contact.website_url)}
            </a>
          ) : null}
        </div>
        {contact.lines.length ? (
          <div className="flex flex-wrap gap-1.5">
            {contact.lines.map((l) => (
              <span key={l} className="rounded-full bg-fill px-2.5 py-0.5 text-[11px] text-ink">
                {coverageShort(l)}
              </span>
            ))}
          </div>
        ) : null}
        {contact.source === "web" ? (
          <div className="space-y-1 text-[12px] text-mute">
            <p>
              {contact.found_at ? `Found on the web on ${longDate(contact.found_at)}.` : "Found on the web."} Walkup didn&rsquo;t check this business and
              doesn&rsquo;t endorse it.
            </p>
            {contact.source_urls.length ? (
              <p>
                Sources:{" "}
                {contact.source_urls.slice(0, 5).map((u, i) => (
                  <span key={u}>
                    {i > 0 ? ", " : ""}
                    <a href={u} target="_blank" rel="noopener noreferrer nofollow" className="text-ink underline underline-offset-2">
                      {hostOf(u)}
                    </a>
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        ) : null}
        {contact.source === "partner" ? <p className="text-[12px] text-mute">Listed with Walkup. Listing isn&rsquo;t an endorsement.</p> : null}
        {!contact.email && canEdit && !archived ? (
          <p className="text-[12px] text-mute">Add an email address (Edit) to ask them for quotes from Walkup.</p>
        ) : null}
        {contact.notes ? <p className="whitespace-pre-line text-[13px] text-ink">{contact.notes}</p> : null}
      </header>

      {canEdit ? (
        <ContactActionsBar
          archived={archived}
          contact={{
            id: contact.id, kind: contact.kind, name: contact.name, person_name: contact.person_name, email: contact.email,
            phone: contact.phone, website_url: contact.website_url, city: contact.city, state_code: contact.state_code,
            lines: contact.lines, is_current_agent: contact.is_current_agent, notes: contact.notes,
          }}
        />
      ) : null}

      <Card title="Quote requests">
        {requests.length === 0 ? (
          <Empty>No quote requests to {contact.name} yet.</Empty>
        ) : (
          <RequestRows requests={requests} canEdit={canEdit} aiOn={aiConfigured()} todayIso={ctx.todayIso} grouped={false} />
        )}
      </Card>

      <Card title="Quotes">
        {quotes.length === 0 ? (
          <Empty>No quotes from {contact.name} yet.</Empty>
        ) : (
          <QuoteGroups quotes={quotes} nowPremium={nowPremium} canEdit={canEdit} todayIso={ctx.todayIso} showContact={false} />
        )}
      </Card>

      <Card title="Emails">
        <div className="space-y-3">
          {canEdit && contact.email && !archived ? <WriteEmailMenu contactId={contact.id} /> : null}
          <MessageList messages={messages} canEdit={canEdit} todayIso={ctx.todayIso} openId={null} />
        </div>
      </Card>

      <Card title="Policies">
        {agentOf.length === 0 ? (
          <Empty>{contact.name} isn&rsquo;t the agent on any saved policy.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {agentOf.map((p) => (
              <PolicyRow key={p.id} policy={p} todayIso={ctx.todayIso} />
            ))}
          </ul>
        )}
      </Card>

      {canEdit ? (
        <p className="text-[13px]">
          <Link href="/insurance?view=market" className="text-mute underline underline-offset-2">
            All contacts
          </Link>
        </p>
      ) : null}
    </div>
  );
}
