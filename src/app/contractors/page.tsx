import { createClient } from "@/lib/supabase/server";
import { Answer, Card, Empty, Restricted } from "@/components/ui";
import { DraftPanel } from "./draft-panel";
import { AddVendorForm } from "./add-vendor-form";
import { VendorRow } from "./vendor-row";

export const dynamic = "force-dynamic";

export default async function ContractorsPage() {
  const supabase = await createClient();

  const [{ data: vendors }, { data: drafts }, { data: openTickets }, { data: associations }] = await Promise.all([
    supabase
      .from("vendors")
      .select(
        "id, name, trade, contact_name, phone, email, entity_type, is_preferred, insured_until, license_number, w9_on_file, w9_received_on, tin_last4, is_1099_exempt",
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
    supabase.from("associations").select("id").limit(1),
  ]);

  if (!vendors) return <Restricted what="contractors" />;

  const associationId = associations?.[0]?.id;
  const { data: isBoardRes } = associationId
    ? await supabase.rpc("is_board", { assoc: associationId })
    : { data: false };
  const isBoard = isBoardRes === true;

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const lapsed = vendors.filter(
    (v) => v.insured_until && new Date(v.insured_until) < today,
  );
  const missingW9 = vendors.filter((v) => !v.w9_on_file && !v.is_1099_exempt);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-black tracking-tight text-ink">Contractors</h1>
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
        {isBoard ? (
          <div className="mb-4">
            <AddVendorForm />
          </div>
        ) : null}
        {vendors.length === 0 ? (
          <Empty>
            {isBoard
              ? "Nobody saved yet — start with whoever you already pay: plumber, snow, cleaning."
              : "Nobody saved yet."}
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {vendors.map((v) => (
              <VendorRow key={v.id} vendor={v} canEdit={isBoard} todayIso={todayIso} />
            ))}
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
