import { redirect } from "next/navigation";

/** Folded into Repairs & Upkeep. */
export default function UpkeepSchedulePage() {
  redirect("/repairs?view=upkeep");
}
