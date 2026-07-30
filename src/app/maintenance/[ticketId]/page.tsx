import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Restricted, money } from "@/components/ui";
import { TicketControls } from "./controls";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "Being worked on",
  waiting_on_contractor: "Waiting on contractor",
  resolved: "Fixed",
  closed: "Closed",
};

export default async function TicketPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  const supabase = await createClient();

  const { data: tickets } = await supabase
    .from("tickets")
    .select(
      "id, reference, title, description, status, priority, opened_on, resolved_at, estimated_cost, unit_id, units(label), vendors(id, name, contact_name, phone, email, insured_until)",
    )
    .eq("id", ticketId)
    .limit(1);

  const ticket = tickets?.[0];
  if (!ticket) return <Restricted what="this problem" />;

  const [{ data: comments }, { data: messages }] = await Promise.all([
    supabase
      .from("ticket_comments")
      .select("id, body, created_at, persons(full_name)")
      .eq("ticket_id", ticketId)
      .order("created_at"),
    supabase
      .from("contractor_messages")
      .select("id, subject, status, to_email")
      .eq("ticket_id", ticketId),
  ]);

  const unit = ticket.units as unknown as { label: string } | null;
  const vendor = ticket.vendors as unknown as {
    id: string;
    name: string;
    contact_name: string | null;
    phone: string | null;
    email: string | null;
    insured_until: string | null;
  } | null;

  const insuranceLapsed =
    vendor?.insured_until && new Date(vendor.insured_until) < new Date();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/maintenance" className="text-sm text-stone-500 hover:underline">
          ← All problems
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{ticket.title}</h1>
        <p className="mt-1 text-stone-500">
          #{ticket.reference} · {unit ? unit.label : "Shared area"} · reported{" "}
          {ticket.opened_on} · {STATUS_LABEL[ticket.status] ?? ticket.status}
          {ticket.estimated_cost ? ` · estimated ${money(ticket.estimated_cost)}` : ""}
        </p>
      </div>

      {ticket.description ? (
        <Card title="What was reported">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{ticket.description}</p>
        </Card>
      ) : null}

      {vendor ? (
        <Card title="Who's handling it">
          <div className="text-sm">
            <div className="font-medium">{vendor.name}</div>
            <div className="mt-1 text-stone-600">
              {[vendor.contact_name, vendor.phone, vendor.email].filter(Boolean).join(" · ")}
            </div>
            {insuranceLapsed ? (
              <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                Their liability insurance expired on {vendor.insured_until}. An
                uninsured contractor working on association property becomes the
                association&rsquo;s problem — get a current certificate before
                they start.
              </p>
            ) : vendor.insured_until ? (
              <p className="mt-2 text-xs text-stone-500">
                Insured until {vendor.insured_until}
              </p>
            ) : (
              <p className="mt-2 text-xs text-amber-700">
                No insurance expiry on file for this contractor.
              </p>
            )}
          </div>
        </Card>
      ) : null}

      <Card title="Notes" hint="A record of what was decided and when, for whoever picks this up next.">
        {(comments ?? []).length === 0 ? (
          <p className="py-2 text-sm text-stone-500">No notes yet.</p>
        ) : (
          <ul className="space-y-4">
            {(comments ?? []).map((c) => {
              const person = c.persons as unknown as { full_name: string } | null;
              return (
                <li key={c.id} className="border-l-2 border-stone-200 pl-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{c.body}</p>
                  <p className="mt-1 text-xs text-stone-400">
                    {person?.full_name ?? "Someone"} ·{" "}
                    {new Date(c.created_at).toLocaleDateString()}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {(messages ?? []).length > 0 ? (
        <Card title="Contractor emails">
          <ul className="divide-y divide-stone-100 text-sm">
            {(messages ?? []).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                <Link href="/contractors" className="underline-offset-2 hover:underline">
                  {m.subject}
                </Link>
                <span className="text-xs text-stone-500">
                  {m.status === "draft" ? "draft — not sent" : m.status}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <TicketControls ticketId={ticket.id} status={ticket.status} />
    </div>
  );
}
