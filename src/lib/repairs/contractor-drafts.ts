import "server-only";
import type { Draft, DraftContext } from "./drafts";
import type { Supabase } from "./server";

/**
 * Loading what a contractor email draft needs, and storing one (repairs-spec
 * §4.5, §10.7). Every draft is a template filled from structured facts; the
 * board edits it and sends it from their own mail app (brief decision 8).
 */

export type DraftKind = "general" | "job" | "quote_request" | "w9_request" | "coi_request" | "paperwork_request";

export interface AssociationForDrafts {
  id: string;
  displayName: string;
  legalName: string;
  address: string | null;
}

/** "2158 N Damen Ave, Chicago, IL 60647", or null without a street address. */
export function associationAddress(a: {
  street_address?: string | null; city?: string | null; state_code?: string | null; postal_code?: string | null;
}): string | null {
  const street = a.street_address?.trim();
  if (!street) return null;
  const cityState = [a.city?.trim(), [a.state_code?.trim(), a.postal_code?.trim()].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return cityState ? `${street}, ${cityState}` : street;
}

/** The association's names and address, and the signed-in sender's name and phone. */
export async function loadDraftBasics(
  supabase: Supabase,
  associationId: string,
): Promise<Omit<DraftContext, "contractor"> | null> {
  const [{ data: assoc }, { data: auth }] = await Promise.all([
    supabase
      .from("associations")
      .select("id, display_name, legal_name, street_address, city, state_code, postal_code")
      .eq("id", associationId)
      .limit(1),
    supabase.auth.getUser(),
  ]);
  const a = assoc?.[0];
  if (!a) return null;
  let sender: DraftContext["sender"] = { name: null, phone: null };
  const userId = auth?.user?.id;
  if (userId) {
    const { data: me } = await supabase
      .from("persons")
      .select("id, full_name")
      .eq("association_id", associationId)
      .eq("auth_user_id", userId)
      .limit(1);
    if (me?.[0]) {
      // The caller's own phone, from person_contact_details (0082).
      const { data: contact } = await supabase.from("person_contact_details").select("phone").eq("person_id", me[0].id).limit(1);
      sender = { name: me[0].full_name ?? null, phone: (contact?.[0]?.phone as string | null | undefined) ?? null };
    }
  }
  const displayName = (a.display_name as string | null)?.trim() || (a.legal_name as string | null)?.trim() || "our building";
  return {
    association: {
      displayName,
      legalName: (a.legal_name as string | null)?.trim() || displayName,
      address: associationAddress(a),
    },
    sender,
  };
}

/** The official W-9 link from the tax link registry (the Taxes tab uses the same rows), or null. */
export async function w9Link(supabase: Supabase): Promise<string | null> {
  const { data } = await supabase
    .from("tax_form_links")
    .select("url, kind, sort_order")
    .eq("form_code", "irs_w9")
    .eq("active", true)
    .in("kind", ["form", "about"])
    .order("sort_order", { ascending: true })
    .limit(10);
  const rows = (data ?? []) as { url: string; kind: string }[];
  return (rows.find((r) => r.kind === "form") ?? rows[0])?.url ?? null;
}

export interface StoredDraft {
  messageId: string;
  to: string[];
  subject: string;
  body: string;
  existing: boolean;
}

/**
 * Insert a draft; when an open draft for the same contractor, problem and
 * kind already exists (contractor_messages_one_draft, 23505), return that one
 * instead, so two quick clicks give one draft.
 */
export async function insertContractorDraft(
  supabase: Supabase,
  row: { associationId: string; vendorId: string; ticketId: string | null; kind: DraftKind; toEmail: string | null; draft: Draft },
): Promise<StoredDraft | { error: { code?: string; message?: string } }> {
  const toEmail = row.toEmail?.trim() || null;
  const { data, error } = await supabase
    .from("contractor_messages")
    .insert({
      association_id: row.associationId,
      vendor_id: row.vendorId,
      ticket_id: row.ticketId,
      kind: row.kind,
      subject: row.draft.subject.slice(0, 200),
      body: row.draft.body.slice(0, 10_000),
      to_email: toEmail,
      status: "draft",
    })
    .select("id");
  if (!error && data?.[0]) {
    return { messageId: data[0].id as string, to: toEmail ? [toEmail] : [], subject: row.draft.subject, body: row.draft.body, existing: false };
  }
  if (error?.code === "23505") {
    let q = supabase
      .from("contractor_messages")
      .select("id, subject, body, to_email")
      .eq("vendor_id", row.vendorId)
      .eq("kind", row.kind)
      .eq("status", "draft");
    q = row.ticketId ? q.eq("ticket_id", row.ticketId) : q.is("ticket_id", null);
    const { data: found } = await q.limit(1);
    const m = found?.[0];
    if (m) {
      return {
        messageId: m.id as string,
        to: m.to_email ? [m.to_email as string] : [],
        subject: m.subject as string,
        body: m.body as string,
        existing: true,
      };
    }
  }
  return { error: error ?? { message: "no row returned" } };
}
