"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Report a building problem.
 *
 * No association_id is trusted from the form: it is looked up through RLS, so
 * a crafted request cannot file a ticket into someone else's building. The
 * insert policy then re-checks that the caller may report against this unit.
 */
export async function createTicket(_prev: unknown, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priority = String(formData.get("priority") ?? "normal");
  const unitId = String(formData.get("unit_id") ?? "");

  if (title.length < 4) {
    return { error: "Give the problem a short title so it's recognisable in a list." };
  }

  const supabase = await createClient();

  const { data: associations } = await supabase.from("associations").select("id").limit(1);
  const associationId = associations?.[0]?.id;
  if (!associationId) return { error: "No association is visible to you." };

  const { data: me } = await supabase
    .from("persons")
    .select("id")
    .eq("association_id", associationId)
    .limit(1);

  const { error } = await supabase.from("tickets").insert({
    association_id: associationId,
    title,
    description: description || null,
    priority,
    unit_id: unitId === "common" || unitId === "" ? null : unitId,
    reported_by: me?.[0]?.id ?? null,
  });

  if (error) return { error: error.message };

  revalidatePath("/maintenance");
  revalidatePath("/");
  return { ok: true };
}

export async function addComment(_prev: unknown, formData: FormData) {
  const ticketId = String(formData.get("ticket_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Write something first." };

  const supabase = await createClient();
  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, association_id")
    .eq("id", ticketId)
    .limit(1);
  if (!ticket?.[0]) return { error: "That ticket isn't visible to you." };

  const { data: me } = await supabase
    .from("persons")
    .select("id")
    .eq("association_id", ticket[0].association_id)
    .limit(1);

  const { error } = await supabase.from("ticket_comments").insert({
    association_id: ticket[0].association_id,
    ticket_id: ticketId,
    person_id: me?.[0]?.id ?? null,
    body,
  });
  if (error) return { error: error.message };

  revalidatePath(`/maintenance/${ticketId}`);
  return { ok: true };
}

export async function setTicketStatus(_prev: unknown, formData: FormData) {
  const ticketId = String(formData.get("ticket_id") ?? "");
  const status = String(formData.get("status") ?? "");

  const supabase = await createClient();
  const resolved = status === "resolved" || status === "closed";

  // The schema requires resolved_at to agree with status, so both move together.
  const { error } = await supabase
    .from("tickets")
    .update({ status, resolved_at: resolved ? new Date().toISOString() : null })
    .eq("id", ticketId);

  if (error) return { error: error.message };

  revalidatePath(`/maintenance/${ticketId}`);
  revalidatePath("/maintenance");
  return { ok: true };
}
