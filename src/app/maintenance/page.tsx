import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Answer, Card, Empty, money } from "@/components/ui";
import { ReportForm } from "./report-form";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "Being worked on",
  waiting_on_contractor: "Waiting on contractor",
  resolved: "Fixed",
  closed: "Closed",
};

const PRIORITY_LABEL: Record<string, string> = {
  low: "Can wait",
  normal: "Should be looked at",
  urgent: "Needs attention now",
};

export default async function MaintenancePage() {
  const supabase = await createClient();

  const [{ data: tickets }, { data: units }] = await Promise.all([
    supabase
      .from("tickets")
      .select(
        "id, reference, title, status, priority, opened_on, estimated_cost, unit_id, units(label), vendors(name)",
      )
      .order("resolved_at", { ascending: true, nullsFirst: true })
      .order("opened_on", { ascending: false }),
    supabase.from("units").select("id, label").order("sort_order"),
  ]);

  const openTickets = (tickets ?? []).filter(
    (t) => t.status !== "resolved" && t.status !== "closed",
  );
  const doneTickets = (tickets ?? []).filter(
    (t) => t.status === "resolved" || t.status === "closed",
  );
  const urgent = openTickets.filter((t) => t.priority === "urgent");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Building problems</h1>
          <p className="mt-1 text-stone-500">
            Anything that needs fixing, and who&rsquo;s dealing with it.
          </p>
        </div>
        <ReportForm units={units ?? []} />
      </div>

      {urgent.length > 0 ? (
        <Answer
          status="bad"
          headline={`${urgent.length} problem${urgent.length === 1 ? "" : "s"} marked urgent`}
          detail={urgent.map((t) => t.title).join(" · ")}
        />
      ) : openTickets.length === 0 ? (
        <Answer
          status="good"
          headline="Nothing outstanding"
          detail="No open problems have been reported."
        />
      ) : (
        <Answer
          status="neutral"
          headline={`${openTickets.length} open problem${openTickets.length === 1 ? "" : "s"}`}
          detail="None of them urgent."
        />
      )}

      <Card title="Open">
        {openTickets.length === 0 ? (
          <Empty>Nothing open.</Empty>
        ) : (
          <ul className="divide-y divide-stone-100">
            {openTickets.map((t) => {
              const unit = t.units as unknown as { label: string } | null;
              const vendor = t.vendors as unknown as { name: string } | null;
              return (
                <li key={t.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/maintenance/${t.id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {t.title}
                      </Link>
                      <div className="mt-1 text-sm text-stone-500">
                        #{t.reference} · {unit ? unit.label : "Shared area"} ·
                        opened {t.opened_on}
                        {vendor ? ` · ${vendor.name}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {t.priority === "urgent" ? (
                        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                          {PRIORITY_LABEL[t.priority]}
                        </span>
                      ) : null}
                      <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-700">
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                      {t.estimated_cost ? (
                        <span className="tabular text-sm text-stone-500">
                          ~{money(t.estimated_cost)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {doneTickets.length > 0 ? (
        <Card title="Already dealt with">
          <ul className="divide-y divide-stone-100">
            {doneTickets.map((t) => {
              const unit = t.units as unknown as { label: string } | null;
              return (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link
                    href={`/maintenance/${t.id}`}
                    className="text-sm text-stone-600 underline-offset-2 hover:underline"
                  >
                    {t.title}
                  </Link>
                  <span className="text-xs text-stone-400">
                    #{t.reference} · {unit ? unit.label : "Shared area"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
