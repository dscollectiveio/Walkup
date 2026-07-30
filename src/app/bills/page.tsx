import { createClient } from "@/lib/supabase/server";
import { Answer, Card, Empty, Restricted, money } from "@/components/ui";

export const dynamic = "force-dynamic";

const FREQUENCY: Record<string, string> = {
  monthly: "every month",
  quarterly: "every 3 months",
  semiannual: "twice a year",
  annual: "once a year",
};

export default async function BillsPage() {
  const supabase = await createClient();

  const { data: bills } = await supabase
    .from("upcoming_bills")
    .select(
      "id, name, frequency, typical_amount, next_due_on, autopay_arranged, autopay_note, vendor_name, days_until_due",
    )
    .order("next_due_on", { nullsFirst: false });

  if (!bills) return <Restricted what="the bills list" />;

  const manual = bills.filter((b) => !b.autopay_arranged);
  const dueSoon = manual.filter(
    (b) => b.days_until_due !== null && b.days_until_due <= 14,
  );
  const monthlyTotal = bills
    .filter((b) => b.frequency === "monthly")
    .reduce((s, b) => s + Number(b.typical_amount ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Regular bills</h1>
        <p className="mt-1 text-stone-500">
          What the building pays out, how often, and which ones are on autopay.
        </p>
      </div>

      {dueSoon.length > 0 ? (
        <Answer
          status="attention"
          headline={`${dueSoon.length} bill${dueSoon.length === 1 ? "" : "s"} you have to pay by hand soon`}
          detail={dueSoon
            .map((b) => `${b.name} — due ${b.next_due_on}`)
            .join(" · ")}
        />
      ) : (
        <Answer
          status="good"
          headline="Nothing needs paying by hand in the next two weeks"
          detail={`${bills.filter((b) => b.autopay_arranged).length} of ${bills.length} bills are on autopay with the provider.`}
        />
      )}

      <Card
        title="What Walkup does and doesn't do here"
        hint="Worth being clear about, because most bill software works differently."
      >
        <p className="text-sm leading-relaxed text-stone-600">
          Walkup keeps track of what&rsquo;s due and reminds you. It{" "}
          <strong>does not hold your bank details and never pays anything</strong>.
          Autopay is set up directly with the utility or your bank, and recorded
          here so the next board knows what&rsquo;s already arranged and
          doesn&rsquo;t double-pay.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">
          For a building this size that&rsquo;s the safer arrangement: no
          software holding the association&rsquo;s banking credentials, and no
          single point of failure if a volunteer&rsquo;s account is
          compromised.
        </p>
      </Card>

      <Card title="Every regular bill" hint={`Roughly ${money(monthlyTotal)} a month in recurring costs.`}>
        {bills.length === 0 ? (
          <Empty>No regular bills recorded yet.</Empty>
        ) : (
          <ul className="divide-y divide-stone-100">
            {bills.map((b) => (
              <li key={b.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="font-medium">{b.name}</div>
                  <div className="mt-1 text-sm text-stone-500">
                    {[b.vendor_name, FREQUENCY[b.frequency] ?? b.frequency]
                      .filter(Boolean)
                      .join(" · ")}
                    {b.next_due_on ? ` · next due ${b.next_due_on}` : ""}
                  </div>
                  {b.autopay_note ? (
                    <div className="mt-1 text-xs text-stone-400">{b.autopay_note}</div>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <div className="tabular font-medium">
                    {b.typical_amount ? money(b.typical_amount) : "—"}
                  </div>
                  {b.autopay_arranged ? (
                    <span className="mt-1 inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-700">
                      autopay with provider
                    </span>
                  ) : (
                    <span className="mt-1 inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-xs text-amber-800">
                      you pay this one
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
