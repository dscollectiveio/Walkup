// The access activity feed: one plain sentence per audit row about roles, invites, board positions and
// ownership. Pure, so it is tested without a database.

export interface AuditRow {
  id: number;
  table_name: string;
  action: "insert" | "update" | "delete";
  actor_user_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  occurred_at: string;
}

export const ACCESS_TABLES = ["role_grants", "invites", "board_positions", "unit_owners"] as const;

const ROLE_WORDS: Record<string, string> = {
  board_admin: "board admin",
  board_member: "board member",
  accountant: "accountant",
  owner: "owner",
  property_manager: "property manager",
  attorney: "attorney",
  observer: "observer",
};

const POSITION_WORDS: Record<string, string> = {
  president: "President",
  vice_president: "Vice President",
  secretary: "Secretary",
  treasurer: "Treasurer",
  director: "Director",
};

const withArticle = (w: string) => `${/^[aeiou]/i.test(w) ? "an" : "a"} ${w}`;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** One sentence for the row, or null for a change that is not worth showing. */
export function describeAccessEvent(
  row: AuditRow,
  names: { person: (personId: string) => string; actor: (userId: string | null) => string },
): string | null {
  const a = row.after_data;
  const b = row.before_data;
  const who = names.actor(row.actor_user_id);
  const personOf = (d: Record<string, unknown> | null) => (str(d?.person_id) ? names.person(str(d?.person_id) as string) : "someone");
  const roleOf = (d: Record<string, unknown> | null) => ROLE_WORDS[str(d?.role) ?? ""] ?? (str(d?.role) ?? "a role");

  switch (row.table_name) {
    case "role_grants": {
      if (row.action === "insert") return `${who} gave ${personOf(a)} the ${roleOf(a)} role`;
      if (row.action === "update" && a && b) {
        if (!b.revoked_at && a.revoked_at) return `${who} ended ${personOf(a)}'s ${roleOf(a)} access`;
        if (b.revoked_at && !a.revoked_at) return `${who} restored ${personOf(a)}'s ${roleOf(a)} access`;
        if (b.expires_on !== a.expires_on) {
          return a.expires_on ? `${who} set ${personOf(a)}'s ${roleOf(a)} access to end on ${a.expires_on as string}` : `${who} removed the end date on ${personOf(a)}'s ${roleOf(a)} access`;
        }
      }
      return null;
    }
    case "invites": {
      const email = str(a?.email) ?? str(b?.email);
      const target = email ?? "a link";
      if (row.action === "insert") return `${who} created ${withArticle(roleOf(a))} invite for ${target}`;
      if (row.action === "delete") return `${who} revoked the ${roleOf(b)} invite for ${target}`;
      if (row.action === "update" && !b?.redeemed_at && a?.redeemed_at) return `${email ?? "Someone"} joined as ${roleOf(a)}`;
      return null;
    }
    case "board_positions": {
      const pos = POSITION_WORDS[str(a?.position) ?? str(b?.position) ?? ""] ?? "an office";
      if (row.action === "insert") return `${who} made ${personOf(a)} ${pos}`;
      if (row.action === "update" && !b?.ended_at && a?.ended_at) return `${personOf(a)} stepped down as ${pos}`;
      if (row.action === "update" && b?.term_end !== a?.term_end) return `${who} set ${personOf(a)}'s term as ${pos} to end ${(str(a?.term_end) ?? "never")}`;
      return null;
    }
    case "unit_owners": {
      if (row.action === "insert") return `${who} recorded ${personOf(a)} as an owner`;
      if (row.action === "update" && !b?.effective_to && a?.effective_to) return `${personOf(a)}'s ownership was ended as of ${a.effective_to as string}`;
      return null;
    }
    default:
      return null;
  }
}
