import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Which pages to refresh after a document is linked or unlinked. Split from
 * link-targets.ts so that list stays importable from client components.
 */
export function revalidateLinked(targetTable: string, targetId: string) {
  revalidatePath("/documents");
  if (targetTable === "units") revalidatePath("/building");
  if (targetTable === "tickets") revalidatePath(`/maintenance/${targetId}`);
  if (targetTable === "vendors") revalidatePath(`/contractors/${targetId}`);
  // Policies, quotes and claims all show on pages under /insurance.
  if (targetTable === "insurance_policies" || targetTable === "insurance_quotes" || targetTable === "insurance_claims") {
    revalidatePath("/insurance", "layout");
  }
  if (targetTable === "tax_forms") revalidatePath(`/tax/forms/${targetId}`);
}
