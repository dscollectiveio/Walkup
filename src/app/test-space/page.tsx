import { Answer, Card, Provisional, Stat, money } from "@/components/ui";
import { FundChart } from "./fund-chart";
import { SitePlan } from "./site-plan";

// Everything on this page is made-up sample data for trying layouts.
export default function TestSpacePage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Test Space</h1>
      <Card title="Where we stand" hint="Sample numbers, not your books" navy>
        <div className="flex flex-col gap-5 p-5">
          <Answer status="good" headline="Dues are covering the bills" detail="Money in has stayed ahead of money out for the first six months." />
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Cash on hand" value={money(18420)} note="Both funds" />
            <Stat label="Owed to the building" value={money(600)} note="One unit behind" tone="bad" />
            <Stat label="Saved for big repairs" value={money(9150)} tone="good" />
          </div>
          <FundChart />
          <Provisional />
        </div>
      </Card>
      <Card title="Who owes what" hint="Sample building, four units" navy>
        <div className="p-5">
          <SitePlan />
        </div>
      </Card>
    </div>
  );
}
