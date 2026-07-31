import { createClient } from "@/lib/supabase/server";
import { Answer, Card, Empty, Restricted } from "@/components/ui";
import { DraftPanel } from "./draft-panel";

export const dynamic = "force-dynamic";

export default async function ContractorsPage() {
  const supabase = await createClient();

  const [{ data: vendors }, { data: drafts }, { data: openTickets }] = await Promise.all([
    supabase
      .from("vendors")
      .select(
        "id, name, trade, contact_name, phone, email, is_preferred, insured_until, license_number, w9_on_file, is_1099_exempt",
      )
      .order("is_preferred", { ascending: false })
      .order("name"),
    supabase
      .from("contractor_messages")
      .select("id, subject, body, status, to_email, created_at, vendors(name), tickets(reference, title)")
      .order("created_at", { ascending: false }),
    supabase
      .from("tickets")
      .select("id, reference, title")
      .not("status", "in", '("resolved","closed")')
      .order("opened_on", { ascending: false }),
  ]);

  if (!vendors) return <Restricted what="contractors" />;

  const today = new Date();
  const lapsed = vendors.filter(
    (v) => v.insured_until && new Date(v.insured_until) < today,
  );
  const missingW9 = vendors.filter((v) => !v.w9_on_file && !v.is_1099_exempt);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Contractors</h1>
        <p className="mt-1 text-mute">
          Who you call, their details, and emails waiting to be sent.
        </p>
      </div>

      {lapsed.length > 0 ? (
        <Answer
          status="bad"
          headline={`${lapsed.length} contractor${lapsed.length === 1 ? " has" : "s have"} lapsed insurance`}
          detail={`${lapsed.map((v) => v.name).join(", ")} — get a current certificate before any further work. An uninsured contractor injured on association property becomes the association's liability.`}
        />
      ) : null}

      {missingW9.length > 0 ? (
        <Answer
          status="attention"
          headline={`${missingW9.length} contractor${missingW9.length === 1 ? "" : "s"} without a W-9 on file`}
          detail={`${missingW9.map((v) => v.name).join(", ")} — you need one before you can issue a 1099 in January. Easier to collect now than at year end.`}
        />
      ) : null}

      <Card title="Your contractors">
        {vendors.length === 0 ? (
          <Empty>Nobody saved yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {vendors.map((v) => {
              const isLapsed = v.insured_until && new Date(v.insured_until) < today;
              return (
                <li key={v.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{v.name}</span>
                      {v.is_preferred ? (
                        <span className="rounded-full border border-good-line bg-good-tint px-2 py-0.5 text-[11px] text-good-text">
                          preferred
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-[13px] text-mute">
                      {[v.trade, v.contact_name, v.phone, v.email].filter(Boolean).join(" · ")}
                    </div>
                    {v.license_number ? (
                      <div className="mt-0.5 text-[11px] text-mute-soft">
                        Licence {v.license_number}
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right text-[11px]">
                    {isLapsed ? (
                      <div className="font-medium text-bad-text">
                        Insurance expired {v.insured_until}
                      </div>
                    ) : v.insured_until ? (
                      <div className="text-mute">Insured to {v.insured_until}</div>
                    ) : (
                      <div className="text-warning-text">No insurance on file</div>
                    )}
                    <div className={v.w9_on_file ? "text-mute" : "text-warning-text"}>
                      {v.w9_on_file
                        ? "W-9 on file"
                        : v.is_1099_exempt
                          ? "1099 exempt"
                          : "W-9 missing"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <DraftPanel
        vendors={vendors.map((v) => ({ id: v.id, name: v.name, email: v.email }))}
        tickets={openTickets ?? []}
        drafts={(drafts ?? []).map((d) => ({
          id: d.id,
          subject: d.subject,
          body: d.body,
          status: d.status,
          to_email: d.to_email,
          vendor_name: (d.vendors as unknown as { name: string } | null)?.name ?? "",
          ticket:
            (d.tickets as unknown as { reference: number; title: string } | null) ?? null,
        }))}
      />
    </div>
  );
}
