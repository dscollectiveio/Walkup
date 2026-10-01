import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted } from "@/components/ui";
import { PartnerForm } from "./partner-form";

export const dynamic = "force-dynamic";

/**
 * Platform admin only (DECISIONS #31). Broker partners are shared by every
 * association, which is why no board admin can manage them. Ships empty —
 * Walkup never invents a broker.
 */
export default async function PartnersPage() {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) return <Restricted what="platform settings" />;

  const { data: partners } = await supabase
    .from("insurance_partners")
    .select("id, name, contact_email, phone, states_served, active, notes")
    .order("name");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Insurance broker partners</h1>
        <p className="mt-1 text-mute">
          Brokers who receive quote requests. A board only sees active partners serving its state, and Get quotes stays
          hidden where there are none.
        </p>
      </div>
      <Card title="Partners">
        {(partners ?? []).length === 0 ? (
          <Empty>No partners yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {(partners ?? []).map((p) => (
              <li key={p.id} className="py-3">
                <PartnerForm partner={p} />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 border-t border-line pt-4">
          <PartnerForm partner={null} />
        </div>
      </Card>
    </div>
  );
}
