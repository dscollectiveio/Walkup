"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Compose an email to a contractor about a problem.
 *
 * Walkup writes the draft. A person reads it and sends it. There is no
 * automatic send, and the database enforces that: contractor_messages refuses
 * a row marked 'sent' without an approver.
 *
 * That is a deliberate limit rather than a missing feature. An association
 * that accidentally emails a contractor something that reads like an
 * authorisation to start work has a real problem, and the volunteer doing this
 * at 10pm is exactly who would not notice.
 */
export async function draftMessage(_prev: unknown, formData: FormData) {
  const vendorId = String(formData.get("vendor_id") ?? "");
  const ticketId = String(formData.get("ticket_id") ?? "");
  if (!vendorId) return { error: "Pick a contractor." };

  const supabase = await createClient();

  const { data: vendors } = await supabase
    .from("vendors")
    .select("id, association_id, name, contact_name, email")
    .eq("id", vendorId)
    .limit(1);
  const vendor = vendors?.[0];
  if (!vendor) return { error: "That contractor isn't visible to you." };

  const { data: associations } = await supabase
    .from("associations")
    .select("id, display_name")
    .eq("id", vendor.association_id)
    .limit(1);
  const association = associations?.[0];

  let ticket: { reference: number; title: string; description: string | null } | null = null;
  if (ticketId) {
    const { data } = await supabase
      .from("tickets")
      .select("reference, title, description")
      .eq("id", ticketId)
      .limit(1);
    ticket = data?.[0] ?? null;
  }

  const greeting = vendor.contact_name
    ? `Hi ${vendor.contact_name.split(" ")[0]},`
    : `Hello,`;

  const subject = ticket
    ? `${ticket.title} — ${association?.display_name ?? "our building"}`
    : `Enquiry — ${association?.display_name ?? "our building"}`;

  const body = ticket
    ? `${greeting}

We have a problem at ${association?.display_name ?? "our building"} we'd like you to look at.

${ticket.title}${ticket.description ? `\n\n${ticket.description}` : ""}

Could you let us know when you might be able to come out, and roughly what you'd expect it to cost? Please check with us before doing anything beyond that estimate.

Thanks,
The Board
${association?.display_name ?? ""}`
    : `${greeting}

We'd like to ask about some work at ${association?.display_name ?? "our building"}.

[Describe what you need here.]

Could you let us know your availability and an estimate?

Thanks,
The Board
${association?.display_name ?? ""}`;

  const { error } = await supabase.from("contractor_messages").insert({
    association_id: vendor.association_id,
    vendor_id: vendor.id,
    ticket_id: ticketId || null,
    subject,
    body,
    to_email: vendor.email,
    status: "draft",
  });

  if (error) return { error: error.message };

  revalidatePath("/contractors");
  return { ok: true };
}

export async function updateDraft(_prev: unknown, formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase
    .from("contractor_messages")
    .update({ subject, body })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/contractors");
  return { ok: true };
}

export async function discardDraft(_prev: unknown, formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase
    .from("contractor_messages")
    .update({ status: "cancelled" })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/contractors");
  return { ok: true };
}
