import "server-only";
import { revalidatePath } from "next/cache";

/**
 * After any Repairs write (repairs-spec §4.9): the Repairs page and Home
 * always, plus the page of whatever the write touched.
 */
export function revalidateRepairs(opts?: { ticketId?: string; vendorId?: string; taskId?: string }): void {
  revalidatePath("/repairs");
  revalidatePath("/");
  if (opts?.ticketId) revalidatePath(`/maintenance/${opts.ticketId}`);
  if (opts?.vendorId) revalidatePath(`/contractors/${opts.vendorId}`);
  if (opts?.taskId) revalidatePath(`/repairs/upkeep/${opts.taskId}`);
}
