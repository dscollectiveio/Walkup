"use server";

import { revalidatePath } from "next/cache";
import { createClient, getUser } from "@/lib/supabase/server";
import { getViewer } from "@/lib/owner/viewer";
import { isUuid } from "@/lib/repairs/server";

/**
 * "Invite to sign in" for a person the board already entered (owner-portal-spec
 * 5.3, migration 0054). The invite points at that person, so redeeming it
 * attaches the login to the same record, with their unit and history, instead
 * of creating a second, empty person.
 */
export async function createOwnerInvite(
  personId: string,
): Promise<{ ok: true; token: string; email: string | null; fullName: string } | { error: string }> {
  const viewer = await getViewer();
  if (!viewer || !viewer.isBoard) return { error: "Only the board can send invites." };
  if (!isUuid(personId)) return { error: "Couldn't find that person." };

  const supabase = await createClient();
  const user = await getUser();
  if (!user) return { error: "Please sign in again." };

  const { data: people } = await supabase
    .from("persons")
    .select("id, full_name, email, auth_user_id")
    .eq("id", personId)
    .eq("association_id", viewer.associationId)
    .limit(1);
  const person = people?.[0] as { id: string; full_name: string; email: string | null; auth_user_id: string | null } | undefined;
  if (!person) return { error: "Couldn't find that person." };
  if (person.auth_user_id) return { error: "That person already has a login." };

  const { data, error } = await supabase
    .from("invites")
    .insert({
      association_id: viewer.associationId,
      role: "owner",
      person_id: person.id,
      email: person.email,
      created_by: user.id,
    })
    .select("token")
    .limit(1);
  if (error || !data?.[0]) {
    return { error: error?.code === "42501" ? "Only the board can send invites." : "Couldn't create the invite. Try again." };
  }
  revalidatePath("/building");
  return { ok: true, token: (data[0] as { token: string }).token, email: person.email, fullName: person.full_name };
}
