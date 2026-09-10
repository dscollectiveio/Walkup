import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted, UnitLink, money } from "@/components/ui";
import { PaymentInstructionsForm } from "./payment-instructions-form";

export const dynamic = "force-dynamic";

function suggestedMemo(unitLabel: string): string {
  const monthYear = new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return `${unitLabel} dues ${monthYear}`;
}

export default async function DuesPage() {
  const supabase = await createClient();

  const { data: associations } = await supabase
    .from("associations")
    .select(
      "id, display_name, dues_payee_name, dues_bank_name, dues_account_number, dues_routing_number, dues_zelle_handle, dues_payment_notes",
    )
    .limit(1);
  const association = associations?.[0];
  if (!association) return <Restricted what="HOA dues" />;

  const { data: isMemberRes } = await supabase.rpc("is_member", { assoc: association.id });
  if (isMemberRes !== true) return <Restricted what="HOA dues" />;

  const [{ data: isBoardAdminRes }, { data: canReadFinancialsRes }, { data: ownedUnitIds }] =
    await Promise.all([
      supabase.rpc("has_role_in", { assoc: association.id, roles: ["board_admin"] }),
      supabase.rpc("can_read_financials", { assoc: association.id }),
      supabase.rpc("owned_unit_ids", { assoc: association.id }),
    ]);
  const isBoardAdmin = isBoardAdminRes === true;
  const canReadFinancials = canReadFinancialsRes === true;
  const myUnitIds = ownedUnitIds ?? [];

  let unitRows: { unit_id: string; label: string; balance_owed: string | number }[] = [];
  if (canReadFinancials) {
    const { data } = await supabase
      .from("unit_balances")
      .select("unit_id, label, balance_owed")
      .order("label");
    unitRows = data ?? [];
  } else if (myUnitIds.length > 0) {
    const { data } = await supabase
      .from("unit_balances")
      .select("unit_id, label, balance_owed")
      .in("unit_id", myUnitIds)
      .order("label");
    unitRows = data ?? [];
  }

  const hasPaymentInfo = Boolean(
    association.dues_payee_name ||
      association.dues_account_number ||
      association.dues_zelle_handle,
  );

  let recentActivity: {
    id: string;
    posted_on: string;
    description: string;
    amount: string | number;
    unitLabel: string | null;
  }[] = [];
  let needsReview: { id: string; posted_on: string; description: string; amount: string | number }[] =
    [];

  if (canReadFinancials) {
    const unitLabelById = new Map(unitRows.map((u) => [u.unit_id, u.label]));

    const [{ data: matched }, { data: unmatched }] = await Promise.all([
      supabase
        .from("bank_transactions")
        .select("id, posted_on, description, amount, matched_unit_id")
        .not("matched_unit_id", "is", null)
        .order("posted_on", { ascending: false })
        .limit(15),
      supabase
        .from("bank_transactions")
        .select("id, posted_on, description, amount")
        .is("matched_unit_id", null)
        .gt("amount", 0)
        .order("posted_on", { ascending: false })
        .limit(10),
    ]);

    recentActivity = (matched ?? []).map((t) => ({
      id: t.id,
      posted_on: t.posted_on,
      description: t.description,
      amount: t.amount,
      unitLabel: t.matched_unit_id ? (unitLabelById.get(t.matched_unit_id) ?? null) : null,
    }));
    needsReview = unmatched ?? [];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">HOA Dues</h1>
        <p className="mt-1 text-mute">
          Send a payment straight from your own bank — no processor, no fee for anyone.
        </p>
      </div>

      <Card
        title="How to pay"
        hint="Set this up once in your bank's bill pay (or Zelle), and it runs on its own every month."
      >
        {!hasPaymentInfo ? (
          <Empty>
            {isBoardAdmin
              ? "Add the association's payment details so owners know where to send dues."
              : "The board hasn't added payment details yet."}
          </Empty>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
            {association.dues_payee_name ? (
              <div>
                <dt className="text-[11px] text-mute">Payee name</dt>
                <dd className="figures text-ink">{association.dues_payee_name}</dd>
              </div>
            ) : null}
            {association.dues_bank_name ? (
              <div>
                <dt className="text-[11px] text-mute">Bank</dt>
                <dd className="text-ink">{association.dues_bank_name}</dd>
              </div>
            ) : null}
            {association.dues_account_number ? (
              <div>
                <dt className="text-[11px] text-mute">Account number</dt>
                <dd className="figures text-ink">{association.dues_account_number}</dd>
              </div>
            ) : null}
            {association.dues_routing_number ? (
              <div>
                <dt className="text-[11px] text-mute">Routing number</dt>
                <dd className="figures text-ink">{association.dues_routing_number}</dd>
              </div>
            ) : null}
            {association.dues_zelle_handle ? (
              <div>
                <dt className="text-[11px] text-mute">Zelle</dt>
                <dd className="text-ink">{association.dues_zelle_handle}</dd>
              </div>
            ) : null}
            {association.dues_payment_notes ? (
              <div className="sm:col-span-2">
                <dt className="text-[11px] text-mute">Notes</dt>
                <dd className="text-ink">{association.dues_payment_notes}</dd>
              </div>
            ) : null}
          </dl>
        )}
        {isBoardAdmin ? (
          <div className="mt-4">
            <PaymentInstructionsForm
              instructions={{
                dues_payee_name: association.dues_payee_name,
                dues_bank_name: association.dues_bank_name,
                dues_account_number: association.dues_account_number,
                dues_routing_number: association.dues_routing_number,
                dues_zelle_handle: association.dues_zelle_handle,
                dues_payment_notes: association.dues_payment_notes,
              }}
            />
          </div>
        ) : null}
      </Card>

      <Card
        title="What's owed"
        hint="Use this memo so an incoming payment is easy to match to the right unit."
      >
        {unitRows.length === 0 ? (
          <Empty>
            {canReadFinancials || myUnitIds.length > 0
              ? "Nothing owed right now."
              : "No unit is on file for you yet."}
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {unitRows.map((u) => (
              <li key={u.unit_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <UnitLink id={u.unit_id} label={u.label} />
                  <div className="mt-0.5 text-[11px] text-mute-soft">
                    Suggested memo: “{suggestedMemo(u.label)}”
                  </div>
                </div>
                <span className="figures text-[13px] text-ink">{money(u.balance_owed)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canReadFinancials ? (
        <Card
          title="Recent dues activity"
          hint="Incoming bank transactions already tagged to a unit — informational, from the bank feed."
        >
          {recentActivity.length === 0 ? (
            <Empty>No tagged dues payments yet.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {recentActivity.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                  <div>
                    <span className="text-ink">{t.description}</span>
                    <span className="ml-2 text-[11px] text-mute-soft">{t.posted_on}</span>
                    {t.unitLabel ? (
                      <span className="ml-2 rounded-full bg-good-tint px-2 py-0.5 text-[11px] text-good-text">
                        {t.unitLabel}
                      </span>
                    ) : null}
                  </div>
                  <span className="figures text-ink">{money(Number(t.amount))}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {canReadFinancials ? (
        <Card
          title="Needs review"
          hint="Money came in but isn't tagged to a unit yet — tag it on the bank feed so it shows up here."
        >
          {needsReview.length === 0 ? (
            <Empty>Nothing waiting on review.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {needsReview.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                  <div>
                    <span className="text-ink">{t.description}</span>
                    <span className="ml-2 text-[11px] text-mute-soft">{t.posted_on}</span>
                  </div>
                  <span className="figures text-ink">{money(Number(t.amount))}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <Link
              href="/bank-feed"
              className="text-[12px] text-mute underline-offset-2 hover:underline"
            >
              Tag transactions on the bank feed →
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
