import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Answer, Card, Empty, Restricted } from "@/components/ui";
import { googleKey } from "@/lib/google/places";
import { TRADES, tradeLabel } from "@/lib/contractors/trades";
import { DraftPanel } from "./draft-panel";
import { FindPanel } from "./find-panel";
import { AddVendorButton } from "./vendor-form";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  preferred: { label: "Preferred", className: "border-good-line bg-good-tint text-good-text" },
  okay: { label: "Okay", className: "border-line bg-fill text-mute" },
  do_not_use: { label: "Do not use", className: "border-bad-line bg-bad-tint text-bad-text" },
};

export default async function ContractorsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; trade?: string | string[]; status?: string }>;
}) {
  const sp = await searchParams;
  const searchEnabled = googleKey() !== null;
  const tab = sp.tab === "find" && searchEnabled ? "find" : "list";
  const tradeFilter = new Set((Array.isArray(sp.trade) ? sp.trade : sp.trade ? [sp.trade] : []).filter(Boolean));
  const statusFilter = sp.status && sp.status in STATUS_BADGE ? sp.status : null;

  const supabase = await createClient();
  const [
    { data: vendors },
    { data: drafts },
    { data: openTickets },
    { data: associations },
    { data: ticketUse },
    { data: expenseUse },
  ] = await Promise.all([
    supabase
      .from("vendors")
      .select(
        "id, name, trades, phone, email, status, board_rating, google_rating, google_review_count, insured_until, w9_on_file, is_1099_exempt, last_used_on",
      )
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
    supabase.from("tickets").select("assigned_vendor_id, opened_on").not("assigned_vendor_id", "is", null),
    supabase.from("expenses").select("vendor_id, paid_on").not("vendor_id", "is", null),
  ]);

  if (!vendors) return <Restricted what="contractors" />;

  const associationId = associations?.[0]?.id;
  const { data: isBoardRes } = associationId
    ? await supabase.rpc("is_board", { assoc: associationId })
    : { data: false };
  const isBoard = isBoardRes === true;

  const lastUsed = new Map<string, string>();
  const bump = (id: string | null, date: string | null) => {
    if (!id || !date) return;
    if (!lastUsed.has(id) || date > lastUsed.get(id)!) lastUsed.set(id, date);
  };
  for (const t of ticketUse ?? []) bump(t.assigned_vendor_id, t.opened_on);
  for (const e of expenseUse ?? []) bump(e.vendor_id, e.paid_on);
  for (const v of vendors) bump(v.id, v.last_used_on);

  const statusRank: Record<string, number> = { preferred: 0, okay: 1, do_not_use: 2 };
  const shown = vendors
    .filter((v) => tradeFilter.size === 0 || (v.trades ?? []).some((t: string) => tradeFilter.has(t)))
    .filter((v) => !statusFilter || v.status === statusFilter)
    .sort(
      (a, b) =>
        (statusRank[a.status] ?? 1) - (statusRank[b.status] ?? 1) ||
        (lastUsed.get(b.id) ?? "").localeCompare(lastUsed.get(a.id) ?? "") ||
        a.name.localeCompare(b.name),
    );

  const today = new Date().toISOString().slice(0, 10);
  const lapsed = vendors.filter((v) => v.status !== "do_not_use" && v.insured_until && v.insured_until < today);
  const missingW9 = vendors.filter((v) => !v.w9_on_file && !v.is_1099_exempt);
  const initialTrade = Array.isArray(sp.trade) ? sp.trade[0] : (sp.trade ?? null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Contractors</h1>
        <p className="mt-1 text-mute">Who you call, their paperwork, and how they&rsquo;ve done.</p>
      </div>

      {searchEnabled && isBoard ? (
        <nav aria-label="Contractors" className="inline-flex rounded-full border border-line bg-paper p-0.5">
          {[
            { key: "list", label: "Your contractors", href: "/contractors" },
            { key: "find", label: "Find a contractor", href: "/contractors?tab=find" },
          ].map((t) => (
            <Link
              key={t.key}
              href={t.href}
              aria-current={tab === t.key ? "page" : undefined}
              className={`inline-flex min-h-[40px] items-center rounded-full px-4 text-[13px] font-medium ${
                tab === t.key ? "bg-ink text-paper" : "text-mute hover:text-ink"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {tab === "find" ? (
        <Card title="Find a contractor" hint="Searches Google for businesses within about 10 miles of the building.">
          <FindPanel initialTrade={initialTrade} />
        </Card>
      ) : (
        <>
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
            {isBoard && vendors.length > 0 ? (
              <div className="mb-4">
                <AddVendorButton />
              </div>
            ) : null}

            {vendors.length === 0 ? (
              <div className="space-y-3 py-4">
                <p className="text-[13px] text-mute">
                  No contractors saved yet. Add one you already use{searchEnabled && isBoard ? ", or find one nearby" : ""}.
                </p>
                {isBoard ? (
                  <div className="flex flex-wrap gap-2">
                    <AddVendorButton />
                    {searchEnabled ? (
                      <Link
                        href="/contractors?tab=find"
                        className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill"
                      >
                        Find a contractor
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
                  <fieldset>
                    <legend className="text-[12px] font-medium text-ink">Kind of work</legend>
                    <div className="mt-1 flex max-w-2xl flex-wrap gap-1.5">
                      {TRADES.map((t) => (
                        <label
                          key={t.slug}
                          className="inline-flex min-h-[32px] cursor-pointer items-center rounded-full border border-line-strong px-2.5 text-[11px] text-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper"
                        >
                          <input type="checkbox" name="trade" value={t.slug} defaultChecked={tradeFilter.has(t.slug)} className="sr-only" />
                          {t.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div>
                    <label htmlFor="status-filter" className="block text-[12px] font-medium text-ink">Status</label>
                    <select
                      id="status-filter"
                      name="status"
                      defaultValue={statusFilter ?? ""}
                      className="mt-1 min-h-[40px] rounded-lg border border-line-strong bg-paper px-3 text-[13px] text-ink"
                    >
                      <option value="">Any</option>
                      <option value="preferred">Preferred</option>
                      <option value="okay">Okay</option>
                      <option value="do_not_use">Do not use</option>
                    </select>
                  </div>
                  <button type="submit" className="min-h-[40px] rounded-md border border-line-strong px-4 text-[13px] text-ink hover:bg-fill">
                    Filter
                  </button>
                  {tradeFilter.size > 0 || statusFilter ? (
                    <Link href="/contractors" className="py-2.5 text-[12px] text-mute underline underline-offset-2">Clear</Link>
                  ) : null}
                </form>

                {shown.length === 0 ? (
                  <Empty>No contractors match this filter.</Empty>
                ) : (
                  <ul className="divide-y divide-line">
                    {shown.map((v) => {
                      const badge = STATUS_BADGE[v.status] ?? STATUS_BADGE.okay;
                      const used = lastUsed.get(v.id);
                      return (
                        <li key={v.id}>
                          <Link href={`/contractors/${v.id}`} className="-mx-2 flex flex-wrap items-start justify-between gap-3 rounded-lg px-2 py-3 hover:bg-fill">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-ink">{v.name}</span>
                                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${badge.className}`}>{badge.label}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {(v.trades ?? []).map((t: string) => (
                                  <span key={t} className="rounded-full bg-fill px-2 py-0.5 text-[11px] text-mute">
                                    {tradeLabel(t)}
                                  </span>
                                ))}
                              </div>
                              <div className="mt-1 text-[12px] text-mute">
                                {[v.phone, v.email].filter(Boolean).join(" · ") || "No phone or email"}
                              </div>
                            </div>
                            <div className="shrink-0 text-right text-[12px] text-mute">
                              {v.board_rating ? <div>Your rating {"★".repeat(v.board_rating)}</div> : null}
                              {v.google_rating !== null ? (
                                <div>
                                  Google rating {Number(v.google_rating).toFixed(1)}
                                  {v.google_review_count !== null ? ` (${v.google_review_count})` : ""}
                                </div>
                              ) : null}
                              <div className="text-mute-soft">{used ? `Last used ${used}` : "Not used yet"}</div>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
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
              ticket: (d.tickets as unknown as { reference: number; title: string } | null) ?? null,
            }))}
          />
        </>
      )}
    </div>
  );
}
