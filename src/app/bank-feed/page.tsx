import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted, money } from "@/components/ui";
import { ConnectBankButton } from "./connect-bank-button";
import { SyncButton } from "./sync-button";
import { DisconnectButton } from "./disconnect-button";

export const dynamic = "force-dynamic";

export default async function BankFeedPage() {
  const supabase = await createClient();

  const { data: connections } = await supabase
    .from("bank_connections")
    .select("id, institution_name, status, last_synced_at")
    .order("created_at", { ascending: false });

  if (!connections) return <Restricted what="the bank feed" />;

  const active = connections.filter((c) => c.status !== "disconnected");

  const { data: transactions } =
    active.length > 0
      ? await supabase
          .from("bank_transactions")
          .select("id, posted_on, description, amount, pending")
          .order("posted_on", { ascending: false })
          .limit(200)
      : { data: [] as never[] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Bank feed</h1>
        <p className="mt-1 text-mute">
          What your bank reports, alongside the books — not part of them.
          Record payments and bills the usual way; nothing here posts
          automatically.
        </p>
      </div>

      {active.length === 0 ? (
        <Card
          title="Connect a bank account"
          hint="See your transactions here without typing them in by hand."
        >
          <p className="mb-4 text-[13px] leading-relaxed text-mute">
            Walkup uses Plaid to connect securely. Your bank password is
            never seen or stored by Walkup — only a read-only token that can
            show transactions. Nothing here can move money; bills and
            payments are still recorded the usual way.
          </p>
          <ConnectBankButton />
        </Card>
      ) : (
        <>
          {active.map((c) => (
            <Card
              key={c.id}
              title={c.institution_name}
              hint={
                c.last_synced_at
                  ? `Last synced ${new Date(c.last_synced_at).toLocaleString()}`
                  : "Not yet synced"
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <SyncButton connectionId={c.id} />
                <DisconnectButton connectionId={c.id} />
              </div>
            </Card>
          ))}

          <Card
            title="Transactions"
            hint="Read-only. Nothing here posts to the ledger."
          >
            {!transactions || transactions.length === 0 ? (
              <Empty>No transactions synced yet. Click &ldquo;Sync now&rdquo; above.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-mute">
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Description</th>
                      <th className="pb-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {transactions.map((t) => (
                      <tr key={t.id}>
                        <td className="figures py-2 text-ink">{t.posted_on}</td>
                        <td className="py-2 text-ink">
                          {t.description}
                          {t.pending ? (
                            <span className="ml-2 text-[11px] text-mute-soft">pending</span>
                          ) : null}
                        </td>
                        <td className="figures py-2 text-right text-ink">
                          {Number(t.amount) < 0 ? "−" : ""}
                          {money(Math.abs(Number(t.amount)))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
