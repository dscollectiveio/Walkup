import { redirect } from "next/navigation";

/**
 * Folded into Repairs & Upkeep (repairs-spec §2.3); profiles stay at
 * /contractors/[vendorId]. The old Find tab is its own page now.
 */
export default async function ContractorsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; trade?: string | string[]; status?: string }>;
}) {
  const sp = await searchParams;
  const trades = Array.isArray(sp.trade) ? sp.trade : sp.trade ? [sp.trade] : [];
  if (sp.tab === "find") {
    redirect(trades[0] ? `/repairs/find?trade=${encodeURIComponent(trades[0])}` : "/repairs/find");
  }
  const params = new URLSearchParams({ view: "contractors" });
  if (sp.q) params.set("q", sp.q);
  if (sp.status) params.set("status", sp.status);
  for (const t of trades) params.append("trade", t);
  redirect(`/repairs?${params.toString()}`);
}
