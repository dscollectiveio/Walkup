import { redirect } from "next/navigation";

/**
 * Billing lives in Your account, Plan and billing. This keeps old links and
 * Stripe pages opened before the move working, including ?checkout=.
 */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  const q = checkout === "done" || checkout === "cancelled" ? `&checkout=${checkout}` : "";
  redirect(`/account?tab=billing${q}`);
}
