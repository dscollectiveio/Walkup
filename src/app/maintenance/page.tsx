import { redirect } from "next/navigation";

/** Folded into Repairs & Upkeep; ticket detail pages stay at /maintenance/[ticketId]. */
export default function MaintenancePage() {
  redirect("/repairs");
}
