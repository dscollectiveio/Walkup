import { redirect } from "next/navigation";

/** Folded into Repairs & Upkeep (repairs-spec §2.3); ticket pages stay at /maintenance/[ticketId]. */
export default function MaintenancePage() {
  redirect("/repairs?view=problems");
}
