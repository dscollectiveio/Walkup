import { redirect } from "next/navigation";

/** Bills live inside Repairs & Upkeep now (repairs-spec §2.3). */
export default function BillsPage() {
  redirect("/repairs?view=bills");
}
