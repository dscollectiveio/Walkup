import { Card, Empty } from "@/components/ui";

export default function RepairsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Repairs</h1>
        <p className="mt-1 text-mute">
          A place to track repair work on the building, separate from open
          problem reports.
        </p>
      </div>

      <Card title="Coming soon">
        <Empty>This page hasn&rsquo;t been built yet.</Empty>
      </Card>
    </div>
  );
}
