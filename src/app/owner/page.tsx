import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty } from "@/components/ui";
import { btnPrimary, btnSecondary } from "@/components/repairs/styles";
import { AnnouncementItem } from "@/components/owner/announcement-item";
import { ContactLine } from "@/components/owner/contact-line";
import { MoneyAnswerCard, MoneyAnswerError } from "@/components/owner/money-answer";
import { buildingTodayIso, shortDate } from "@/lib/dates";
import { loadAnnouncements, loadOwnedUnits, loadSummary } from "@/lib/owner/load";
import { ownerRepairsSummary } from "@/lib/owner/repairs-summary";
import { ViewerUnavailable } from "@/components/owner/viewer-unavailable";
import { getViewer } from "@/lib/owner/viewer";

export const dynamic = "force-dynamic";

/**
 * The owner's home (owner-portal-spec 6.1): what they owe first, then what the
 * board posted, their repairs, what was shared, and who to contact. Board
 * members who own a unit get the same page from "My unit".
 */
export default async function OwnerHomePage() {
  const viewer = await getViewer();
  if (!viewer) return <ViewerUnavailable />;

  const supabase = await createClient();
  const today = buildingTodayIso();
  const owns = viewer.ownedUnitIds.length > 0;

  const header = (
    <div>
      <h1 className="text-[20px] font-bold tracking-tight text-ink">Hi {viewer.firstName}</h1>
      <p className="mt-1 text-mute">{viewer.associationName}</p>
    </div>
  );

  if (!owns) {
    return (
      <div className="mx-auto w-full max-w-[760px] space-y-6">
        {header}
        {viewer.isStaff ? (
          <Card title="This page is for owners">
            <p className="text-[14px] text-ink">
              You don&rsquo;t own a unit in {viewer.associationName}, so there&rsquo;s no balance to show here. Your Dashboard has the association&rsquo;s numbers.
            </p>
            <p className="mt-4">
              <Link href="/" className={btnPrimary}>
                Go to the Dashboard
              </Link>
            </p>
          </Card>
        ) : (
          <Card title="No unit is linked to your account yet">
            <p className="text-[14px] leading-relaxed text-ink">
              The board hasn&rsquo;t linked your sign-in to a unit. That usually means an invite was used that wasn&rsquo;t made for you. Ask{" "}
              {viewer.boardContact.name ?? "a board member"} to send you a new invite from Building Info.
            </p>
            <div className="mt-3">
              <ContactLine contact={viewer.boardContact} />
            </div>
          </Card>
        )}
      </div>
    );
  }

  const [units, announcements, repairs, docsRes] = await Promise.all([
    loadOwnedUnits(supabase, viewer),
    loadAnnouncements(supabase, today, 3),
    ownerRepairsSummary(supabase, viewer, today),
    supabase
      .from("documents")
      .select("id, title, filename, uploaded_at")
      .is("deleted_at", null)
      .or(`visibility.eq.all_owners,restricted_to_unit_id.in.(${viewer.ownedUnitIds.join(",")})`)
      .order("uploaded_at", { ascending: false })
      .limit(5),
  ]);
  const summaries = await Promise.all(units.map((u) => loadSummary(supabase, u.id, today)));
  const docs = docsRes.data ?? [];

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-6">
      {header}

      <div className="space-y-4">
        {units.map((u, i) => {
          const s = summaries[i];
          return (
            <div key={u.id} className="space-y-2">
              {units.length > 1 ? <h2 className="text-[15px] font-bold text-ink">{u.label}</h2> : null}
              {s.ok ? (
                <MoneyAnswerCard summary={s.summary} hasEverBeenCharged={s.hasHistory} todayIso={today} />
              ) : (
                <MoneyAnswerError />
              )}
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 min-[900px]:grid-cols-2 min-[900px]:items-start">
        <Card title="Announcements">
          {announcements === null ? (
            <p className="text-[13px] text-mute">We couldn&rsquo;t load announcements. Reload the page.</p>
          ) : announcements.rows.length === 0 ? (
            <Empty>Nothing posted yet. When the board posts something, it shows up here.</Empty>
          ) : (
            <div className="divide-y divide-line">
              {announcements.rows.map((r) => (
                <AnnouncementItem key={r.id} row={r} unread={announcements.unread.has(r.id)} todayIso={today} compact />
              ))}
            </div>
          )}
          <p className="mt-2 border-t border-line pt-3">
            <Link href="/announcements" className="inline-flex min-h-[44px] items-center text-[13px] font-medium text-ink underline underline-offset-2">
              See all announcements
            </Link>
          </p>
        </Card>

        <Card title="Repairs">
          {repairs.latest ? (
            <div>
              <p className="text-[15px] font-medium text-ink">
                {repairs.open === 0
                  ? "Nothing you reported is open"
                  : `You have ${repairs.open} open ${repairs.open === 1 ? "report" : "reports"}`}
              </p>
              <p className="mt-1 text-[13px] text-mute">
                <Link href={`/maintenance/${repairs.latest.id}`} className="text-ink underline underline-offset-2">
                  #{repairs.latest.reference} {repairs.latest.title}
                </Link>
                : {repairs.latest.line}
              </p>
              {repairs.waitingOnYou > 0 ? (
                <p className="mt-2 border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-[13px] text-warning-text">
                  {repairs.waitingOnYou} fixed {repairs.waitingOnYou === 1 ? "problem" : "problems"} waiting for you to confirm
                </p>
              ) : null}
            </div>
          ) : (
            <Empty>Nothing has been reported yet. If something&rsquo;s broken, report it and the board sees it here.</Empty>
          )}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Link href="/repairs/report" className={btnPrimary}>
              Report a problem
            </Link>
            <Link href="/repairs" className={btnSecondary}>
              See all repairs
            </Link>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 min-[900px]:grid-cols-2 min-[900px]:items-start">
        <Card title="Shared with you">
          {docs.length === 0 ? (
            <Empty>The board hasn&rsquo;t shared any documents yet.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {docs.map((d) => (
                <li key={d.id} className="flex items-baseline justify-between gap-3 py-2.5">
                  <Link href={`/documents/${d.id}`} className="min-w-0 break-words text-[14px] text-ink underline-offset-2 hover:underline">
                    {(d.title as string | null) || (d.filename as string)}
                  </Link>
                  <span className="shrink-0 text-[12px] text-mute">{shortDate(d.uploaded_at as string, today)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 border-t border-line pt-3">
            <Link href="/documents" className="inline-flex min-h-[44px] items-center text-[13px] font-medium text-ink underline underline-offset-2">
              Open the Document Hub
            </Link>
          </p>
        </Card>

        <Card title="Who to contact">
          <ContactLine contact={viewer.boardContact} canEdit={viewer.isBoardAdmin} />
          <p className="mt-2 border-t border-line pt-3">
            <Link href="/repairs/emergency-info" className="inline-flex min-h-[44px] items-center text-[13px] font-medium text-ink underline underline-offset-2">
              What to do in an emergency
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
