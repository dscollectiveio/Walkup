import { createClient } from "@/lib/supabase/server";
import { Answer, Card, Empty } from "@/components/ui";
import { ContactLine } from "@/components/owner/contact-line";
import { OutsideNoUnit } from "@/components/owner/outside-no-unit";
import { CopyField } from "@/components/owner/copy-field";
import { ReportPaymentForm } from "@/app/dues/report-payment-form";
import { buildingTodayIso } from "@/lib/dates";
import { loadOwnedUnits, loadSummary } from "@/lib/owner/load";
import { hasPaymentDetails, reportLine, reportStatusWords, suggestedMemo, type ReportRow } from "@/lib/owner/pay";
import { moneyAnswer, ownerStanding } from "@/lib/owner/standing";
import { ViewerUnavailable } from "@/components/owner/viewer-unavailable";
import { getViewer } from "@/lib/owner/viewer";
import { MyReports, type MyReport } from "./my-reports";

export const dynamic = "force-dynamic";

/** How to pay, and a way to tell the board you did (owner-portal-spec 6.3). Nothing here moves money. */
export default async function OwnerPayPage() {
  const viewer = await getViewer();
  if (!viewer) return <ViewerUnavailable />;
  const supabase = await createClient();
  const today = buildingTodayIso();
  const units = await loadOwnedUnits(supabase, viewer);
  const contactName = viewer.boardContact.name ?? "a board member";

  const heading = (
    <div>
      <h1 className="text-[20px] font-bold tracking-tight text-ink">How to pay</h1>
      <p className="mt-1 text-mute">You can pay however the board has set up, for example through your bank&rsquo;s bill pay. Check with your bank about any fees.</p>
    </div>
  );

  if (units.length === 0 && viewer.isOutside) {
    return (
      <div className="mx-auto w-full max-w-[760px] space-y-6">
        {heading}
        <OutsideNoUnit firstName={viewer.firstName} associationName={viewer.associationName} topRole={viewer.topRole} />
      </div>
    );
  }

  if (units.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[760px] space-y-6">
        {heading}
        <Card navy title="No unit is linked to your account yet">
          <p className="text-[14px] leading-relaxed text-ink">
            The board hasn&rsquo;t linked your sign-in to a unit. Ask {contactName} to send you a new invite from Building & Owners.
          </p>
          <div className="mt-3">
            <ContactLine contact={viewer.boardContact} />
          </div>
        </Card>
      </div>
    );
  }

  const [assocRes, summaries, reportsRes, sessionRes] = await Promise.all([
    supabase
      .from("associations")
      .select("dues_payee_name, dues_bank_name, dues_account_number, dues_routing_number, dues_zelle_handle, dues_payment_notes")
      .eq("id", viewer.associationId)
      .limit(1),
    Promise.all(units.map((u) => loadSummary(supabase, u.id, today))),
    supabase
      .from("dues_payment_reports")
      .select("id, unit_id, amount, paid_on, method, status, resolution_note, reported_by")
      .in("unit_id", units.map((u) => u.id))
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.auth.getClaims(),
  ]);
  const a = assocRes.data?.[0] as
    | {
        dues_payee_name: string | null;
        dues_bank_name: string | null;
        dues_account_number: string | null;
        dues_routing_number: string | null;
        dues_zelle_handle: string | null;
        dues_payment_notes: string | null;
      }
    | undefined;
  const configured = a ? hasPaymentDetails(a) : false;
  const myUserId = sessionRes.data?.claims?.sub ?? null;
  const unitLabel = new Map(units.map((u) => [u.id, u.label]));
  const reports: MyReport[] = ((reportsRes.data ?? []) as unknown as (ReportRow & { reported_by: string })[]).map((r) => ({
    id: r.id,
    line: reportLine(r, today),
    unitLabel: units.length > 1 ? (unitLabel.get(r.unit_id) ?? null) : null,
    status: reportStatusWords(r),
    pending: r.status === "pending" && r.reported_by === myUserId,
  }));
  const netCents = summaries.reduce((sum, s) => (s.ok ? sum + Math.round(Number(s.summary.net) * 100) : sum), 0);

  const fields: { label: string; value: string | null | undefined }[] = [
    { label: "Payee name", value: a?.dues_payee_name },
    { label: "Bank", value: a?.dues_bank_name },
    { label: "Account number", value: a?.dues_account_number },
    { label: "Routing number", value: a?.dues_routing_number },
    { label: "Zelle", value: a?.dues_zelle_handle },
  ];

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-6">
      {heading}

      <div className="space-y-3">
        {units.map((u, i) => {
          const s = summaries[i];
          if (!s.ok) {
            return <Answer key={u.id} status="neutral" headline="We couldn't load your balance" detail="Reload the page. If it keeps happening, tell the board." />;
          }
          const standing = ownerStanding(s.summary, s.hasHistory, today);
          const answer = moneyAnswer(s.summary, standing, today);
          return <Answer key={u.id} status={answer.status} headline={units.length > 1 ? `${u.label}: ${answer.headline}` : answer.headline} />;
        })}
      </div>

      <Card navy title="Send your payment here">
        {!configured || !a ? (
          <div>
            <Empty>The board hasn&rsquo;t added payment details yet. Ask {contactName}.</Empty>
            <div className="text-center">
              <ContactLine contact={viewer.boardContact} />
            </div>
          </div>
        ) : (
          <div>
            <div className="divide-y divide-line">
              {fields.map((f) => (f.value?.trim() ? <CopyField key={f.label} label={f.label} value={f.value.trim()} /> : null))}
              {a.dues_payment_notes?.trim() ? (
                <div className="py-2">
                  <div className="text-[11px] text-mute">Notes from the board</div>
                  <p className="whitespace-pre-wrap break-words text-[14px] text-ink">{a.dues_payment_notes.trim()}</p>
                </div>
              ) : null}
              {units.map((u) => (
                <CopyField
                  key={u.id}
                  label={units.length > 1 ? `Suggested memo for ${u.label}` : "Suggested memo"}
                  value={suggestedMemo(u.label, today)}
                  mono={false}
                />
              ))}
            </div>
            <p className="mt-4 border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-[13px] leading-relaxed text-warning-text">
              Only use the details on this page. If an email or text asks you to send money anywhere else, call the board first.
            </p>
          </div>
        )}
      </Card>

      <div id="report" className="scroll-mt-20">
        <Card navy title="Tell the board you paid">
          <p className="mb-3 text-[13px] text-mute">
            This does not move money. It tells the board to look for your payment. They record it when the deposit shows up at the bank.
          </p>
          <ReportPaymentForm units={units} defaultAmount={netCents > 0 ? netCents / 100 : undefined} />
          <h3 className="mb-1 mt-6 text-[13px] font-medium text-ink">My reports</h3>
          {reportsRes.error ? (
            <p className="text-[13px] text-mute">We couldn&rsquo;t load your reports.</p>
          ) : (
            <MyReports reports={reports} />
          )}
        </Card>
      </div>
    </div>
  );
}
