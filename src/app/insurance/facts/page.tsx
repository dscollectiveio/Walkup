import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Restricted } from "@/components/ui";
import { emptyFacts, isFactKey } from "@/lib/insurance/facts";
import { factGuesses } from "@/lib/insurance/guesses";
import { adminNames, loadFacts, loadInsuranceContext } from "@/lib/insurance/queries";
import { BackLink } from "../components/page-header";
import { linkClass } from "../components/styles";
import { BuildingBasics } from "./building-basics";
import { FactsForm } from "./facts-form";
import { questionFor } from "./questions";

export const dynamic = "force-dynamic";

/** /insurance/facts (insurance-spec §9.8): what the coverage check needs to know about the building. */
export default async function FactsPage({ searchParams }: { searchParams: Promise<{ only?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const ctx = await loadInsuranceContext(supabase);
  if (!ctx || !ctx.canRead) return <Restricted what="insurance records" />;
  const assoc = ctx.association;

  const [facts, upkeep, admins] = await Promise.all([
    loadFacts(supabase, assoc.id),
    supabase.from("upkeep_tasks").select("name").eq("association_id", assoc.id).eq("is_active", true),
    ctx.isBoard && !ctx.isAdmin ? adminNames(supabase, assoc.id) : Promise.resolve(""),
  ]);
  const guesses = Object.fromEntries(
    factGuesses(facts, ((upkeep.data ?? []) as { name: string }[]).map((t) => t.name)).map((g) => [g.key, g.from]),
  );
  const only = sp.only
    ? [...new Set(sp.only.split(",").map((k) => k.trim()).filter(isFactKey).map(questionFor))]
    : null;
  const onlyMode = only !== null && only.length > 0;
  const address = [assoc.street_address, assoc.city, assoc.state_code, assoc.postal_code].filter(Boolean).join(", ");

  return (
    <div className="space-y-6">
      <BackLink href="/insurance?view=check">Coverage check</BackLink>
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">
          {onlyMode ? `${only.length} ${only.length === 1 ? "question" : "questions"} for the coverage check` : "About the building"}
        </h1>
        <p className="mt-1 text-mute">The coverage check uses these. Answer what you know; &lsquo;Not sure&rsquo; is fine.</p>
        {onlyMode ? (
          <p className="mt-2 text-[13px]">
            <Link href="/insurance/facts" className={linkClass}>
              Show all the facts
            </Link>
          </p>
        ) : null}
      </div>

      {!onlyMode ? (
        <Card navy title="From Building & Owners">
          <div className="space-y-4">
            <BuildingBasics
              canEdit={ctx.isBoard}
              initial={{
                yearBuilt: assoc.year_built,
                constructionType: assoc.construction_type,
                stories: assoc.stories,
                roofReplacedYear: assoc.roof_replaced_year,
              }}
            />
            <div className="border-t border-line pt-4 text-[13px]">
              <div className="text-[12px] font-medium text-ink">Address</div>
              <p className="mt-1 text-ink">{address || "Not recorded"}</p>
              {ctx.isAdmin ? (
                <Link href="/building" className={`${linkClass} mt-1 inline-flex min-h-[44px] items-center`}>
                  Edit in Building & Owners
                </Link>
              ) : ctx.isBoard ? (
                <p className="mt-1 text-mute">Only {admins} can change the address. Ask them to add it.</p>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <FactsForm
        facts={facts ?? emptyFacts(assoc.id)}
        only={onlyMode ? only : null}
        guesses={guesses}
        canEdit={ctx.isBoard}
        illinois={(assoc.state_code ?? "").toUpperCase() === "IL"}
      />
    </div>
  );
}
