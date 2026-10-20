import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Collections now lives inside the HOA Dues units card; old links and bookmarks land there. */
export default async function CollectionsPage({ searchParams }: { searchParams: Promise<{ select?: string }> }) {
  const { select } = await searchParams;
  redirect(`/dues${select ? `?select=${encodeURIComponent(select)}` : ""}#collections`);
}
