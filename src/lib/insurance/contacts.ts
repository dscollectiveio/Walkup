import "server-only";
import type { Supabase } from "./queries";
import { agentFromValues } from "./save-input";

/**
 * The agent named on a policy or quote becomes a contact (insurance-spec §8.2
 * step 6, §8.3): matched on the identity index (name and email, any case)
 * first, inserted with source 'policy' otherwise. Returns the contact id, or
 * null when no agent field is filled. A failed insert is logged, not fatal:
 * the policy saves without the link.
 */
export async function upsertAgentContact(
  supabase: Supabase,
  associationId: string,
  parsed: Record<string, string | null>,
): Promise<string | null> {
  const agent = agentFromValues(parsed);
  if (!agent) return null;
  const escape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  const find = async () => {
    let q = supabase
      .from("insurance_contacts")
      .select("id")
      .eq("association_id", associationId)
      .is("archived_at", null)
      .ilike("name", escape(agent.name));
    q = agent.email ? q.ilike("email", escape(agent.email)) : q.is("email", null);
    const { data } = await q.limit(1);
    return ((data ?? [])[0] as { id: string } | undefined)?.id ?? null;
  };
  const existing = await find();
  if (existing) return existing;
  const { data, error } = await supabase
    .from("insurance_contacts")
    .insert({
      association_id: associationId,
      kind: agent.kind,
      name: agent.name,
      person_name: agent.personName,
      email: agent.email,
      phone: agent.phone,
      source: "policy",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return find();
    console.error("agent contact insert failed", error.code);
    return null;
  }
  return (data as { id: string }).id;
}
