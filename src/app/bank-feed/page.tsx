import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted, Stat, money } from "@/components/ui";
import { ConnectBankButton } from "./connect-bank-button";
import { SyncButton } from "./sync-button";
import { DisconnectButton } from "./disconnect-button";

export const dynamic = "force-dynamic";

type Range = "this_month" | "last_30" | "all";

function rangeStart(range: Range): string | null {
  const now = new Date();
  if (range === "this_month") {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }
  if (range === "last_30") {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

export default async function BankFeedPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; range?: string }>;
}) {
  const { q, range: rangeParam } = await searchParams;
  const range: Range =
    rangeParam === "this_month" || rangeParam === "last_30" ? rangeParam : "all";

  const supabase = await createClient();

  const { data: connections } = await supabase
    .from("bank_connections")
    .select("id, institution_name, status, last_synced_at")
    .order("created_at", { ascending: false });

  if (!connections) return <Restricted what="the bank feed" />;

  const active = connections.filter((c) => c.status !== "disconnected");

  let transactionsQuery = supabase
    .from("bank_transactions")
    .select("id, posted_on, description, amount, pending, raw_category")
    .order("posted_on", { ascending: false })
    .limit(200);

  if (q) transactionsQuery = transactionsQuery.ilike("description", `%${q}%`);
  const start = rangeStart(range);
  if (start) transactionsQuery = transactionsQuery.gte("posted_on", start);

  const { data: transactions } =
    active.length > 0 ? await transactionsQuery : { data: [] as never[] };

  const moneyIn = (transactions ?? [])
    .filter((t) => Number(t.amount) > 0)
    .reduce((s, t) => s + Number(t.amount), 0);
  const moneyOut = (transactions ?? [])
    .filter((t) => Number(t.amount) < 0)
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

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

          <div className="grid gap-4 sm:grid-cols-2">
            <Stat label="Money in" value={money(moneyIn)} note="In the filtered range below" />
            <Stat label="Money out" value={money(moneyOut)} note="In the filtered range below" />
          </div>

          <Card
            title="Transactions"
            hint="Read-only. Nothing here posts to the ledger."
          >
            <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
              <div className="flex-1 min-w-[10rem]">
                <label htmlFor="q" className="block text-[12px] font-medium text-ink">
                  Search
                </label>
                <input
                  id="q"
                  name="q"
                  type="text"
                  defaultValue={q ?? ""}
                  placeholder="Description contains…"
                  className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
                />
              </div>
              <div>
                <label htmlFor="range" className="block text-[12px] font-medium text-ink">
                  Range
                </label>
                <select
                  id="range"
                  name="range"
                  defaultValue={range}
                  className="mt-1 rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
                >
                  <option value="all">All synced</option>
                  <option value="this_month">This month</option>
                  <option value="last_30">Last 30 days</option>
                </select>
              </div>
              <button
                type="submit"
                className="rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill"
              >
                Filter
              </button>
            </form>

            {!transactions || transactions.length === 0 ? (
              <Empty>
                {q || range !== "all"
                  ? "No transactions match this filter."
                  : "No transactions synced yet. Click “Sync now” above."}
              </Empty>
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
                          {t.raw_category ? (
                            <span className="ml-2 rounded-full bg-neutral-tint px-2 py-0.5 text-[11px] text-neutral-text">
                              {t.raw_category}
                            </span>
                          ) : null}
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
