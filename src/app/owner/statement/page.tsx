import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import { ContactLine } from "@/components/owner/contact-line";
import { OutsideNoUnit } from "@/components/owner/outside-no-unit";
import { buildingTodayIso } from "@/lib/dates";
import { loadOwnedUnits, loadSummary } from "@/lib/owner/load";
import { balanceWords } from "@/lib/owner/statement";
import { ViewerUnavailable } from "@/components/owner/viewer-unavailable";
import { getViewer } from "@/lib/owner/viewer";

export const dynamic = "force-dynamic";

/** One unit goes straight to its statement; several get a chooser (owner-portal-spec 6.2). */
export default async function OwnerStatementIndex() {
  const viewer = await getViewer();
  if (!viewer) return <ViewerUnavailable />;
  const supabase = await createClient();
  const units = await loadOwnedUnits(supabase, viewer);

  if (units.length === 1) redirect(`/owner/statement/${units[0].id}`);

  if (units.length === 0 && viewer.isOutside) {
    return (
      <div className="mx-auto w-full max-w-[760px] space-y-6">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Statement</h1>
        <OutsideNoUnit firstName={viewer.firstName} associationName={viewer.associationName} topRole={viewer.topRole} />
      </div>
    );
  }

  if (units.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[760px] space-y-6">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Statement</h1>
        <Card navy title="No unit is linked to your account yet">
          <p className="text-[14px] leading-relaxed text-ink">
            The board hasn&rsquo;t linked your sign-in to a unit, so there&rsquo;s no statement to show. Ask{" "}
            {viewer.boardContact.name ?? "a board member"} to send you a new invite from Building & Owners.
          </p>
          <div className="mt-3">
            <ContactLine contact={viewer.boardContact} />
          </div>
        </Card>
      </div>
    );
  }

  const today = buildingTodayIso();
  const summaries = await Promise.all(units.map((u) => loadSummary(supabase, u.id, today)));
  return (
    <div className="mx-auto w-full max-w-[760px] space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Statement</h1>
        <p className="mt-1 text-mute">Choose a unit to see what was charged, what was paid, and what is left.</p>
      </div>
      <Card navy title="Choose a unit">
        <ul className="divide-y divide-line">
          {units.map((u, i) => {
            const s = summaries[i];
            return (
              <li key={u.id}>
                <Link href={`/owner/statement/${u.id}`} className="flex min-h-[48px] items-center justify-between gap-3 py-2 text-[14px] text-ink">
                  <span className="font-medium">{u.label}</span>
                  <span className="figures text-mute">{s.ok ? balanceWords(s.summary.net) : "Couldn't load"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
