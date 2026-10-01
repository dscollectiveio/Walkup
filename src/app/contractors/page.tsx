import { redirect } from "next/navigation";

/** Folded into Repairs & Upkeep; contractor profiles stay at /contractors/[vendorId]. */
export default async function ContractorsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; trade?: string | string[]; status?: string }>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams({ view: "contractors" });
  if (sp.tab) params.set("tab", sp.tab);
  if (sp.status) params.set("status", sp.status);
  for (const t of Array.isArray(sp.trade) ? sp.trade : sp.trade ? [sp.trade] : []) params.append("trade", t);
  redirect(`/repairs?${params.toString()}`);
}
