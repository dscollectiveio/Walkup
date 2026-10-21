import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/owner/viewer";
import { loadOwnedUnits } from "@/lib/owner/load";

export const dynamic = "force-dynamic";

/**
 * "Download your details" on Your account, Privacy and data: the signed-in
 * person's own record as JSON. Everything is read through their own session,
 * so RLS limits it to what they can already see about themselves. No money,
 * no other people.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const supabase = await createClient();

  const [personRes, contactRes, claimsRes, units, prefsRes] = await Promise.all([
    supabase.from("persons").select("full_name, email, created_at").eq("id", viewer.personId).limit(1),
    // Phone and mailing address live in person_contact_details (0082); the person's own export includes them.
    supabase.from("person_contact_details").select("phone, mailing_address").eq("person_id", viewer.personId).limit(1),
    supabase.auth.getClaims(),
    loadOwnedUnits(supabase, viewer),
    supabase.rpc("my_email_preferences", { p_association_id: viewer.associationId }),
  ]);
  const person = personRes.data?.[0] ?? null;
  const contact = contactRes.data?.[0] ?? null;
  const prefs = (Array.isArray(prefsRes.data) ? prefsRes.data[0] : prefsRes.data) as Record<string, unknown> | undefined;

  const body = {
    exported_at: new Date().toISOString(),
    association: viewer.associationName,
    sign_in_email: claimsRes.data?.claims?.email ?? null,
    person: person
      ? {
          name: person.full_name,
          email: person.email,
          phone: contact?.phone ?? null,
          mailing_address: contact?.mailing_address ?? null,
          on_file_since: person.created_at,
        }
      : null,
    roles: viewer.roles,
    units_owned: units.map((u) => u.label),
    email_choices: prefs
      ? {
          dues_reminders: prefs.dues_reminders,
          statements: prefs.statements,
          announcements: prefs.announcements,
          stopped_all: prefs.unsubscribed_all,
        }
      : null,
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="walkup-my-details.json"',
      "cache-control": "no-store",
    },
  });
}
