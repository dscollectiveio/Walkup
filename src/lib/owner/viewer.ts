import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { BoardContact } from "./viewer-types";
import { firstNameOf } from "./viewer-names";

/**
 * Who is looking, in one round trip (owner-portal-spec 2.3). Cached per
 * request so the layout, the guard and the page share one call.
 *
 * Does not call auth.getUser(): the proxy already verified the session, and
 * viewer_context() returns nothing without a valid auth.uid() at aal2.
 */

export type ViewerRole = "board_admin" | "board_member" | "accountant" | "owner";

export type { BoardContact };

export interface Viewer {
  associationId: string;
  associationName: string;
  personId: string;
  fullName: string;
  /** First word of fullName, "there" when empty. */
  firstName: string;
  roles: ViewerRole[];
  isBoard: boolean;
  isBoardAdmin: boolean;
  canReadFinancials: boolean;
  /** Board or accountant. */
  isStaff: boolean;
  ownedUnitIds: string[];
  boardContact: BoardContact;
}

const KNOWN_ROLES: ViewerRole[] = ["board_admin", "board_member", "accountant", "owner"];

function clean(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data: associations } = await supabase
    .from("associations")
    .select("id, display_name, legal_name, board_contact_name, board_contact_email, board_contact_phone")
    .order("created_at")
    .order("id")
    .limit(1);
  const a = associations?.[0];
  if (!a) return null;

  const { data, error } = await supabase.rpc("viewer_context", { p_association_id: a.id });
  if (error) {
    console.error("[owner] viewer_context", error.code ?? "-", error.message ?? "");
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        person_id: string;
        full_name: string | null;
        roles: string[] | null;
        is_board: boolean;
        is_board_admin: boolean;
        can_read_financials: boolean;
        owned_unit_ids: string[] | null;
      }
    | undefined;
  if (!row) return null;

  const roles = (row.roles ?? []).filter((r): r is ViewerRole => (KNOWN_ROLES as string[]).includes(r));
  const fullName = (row.full_name ?? "").trim();
  return {
    associationId: a.id as string,
    associationName: clean(a.display_name) ?? clean(a.legal_name) ?? "your building",
    personId: row.person_id,
    fullName,
    firstName: firstNameOf(fullName),
    roles,
    isBoard: row.is_board === true,
    isBoardAdmin: row.is_board_admin === true,
    canReadFinancials: row.can_read_financials === true,
    isStaff: row.is_board === true || roles.includes("accountant"),
    ownedUnitIds: row.owned_unit_ids ?? [],
    boardContact: {
      name: clean(a.board_contact_name),
      email: clean(a.board_contact_email),
      phone: clean(a.board_contact_phone),
    },
  };
});
