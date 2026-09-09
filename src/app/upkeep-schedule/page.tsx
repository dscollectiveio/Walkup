import { Card, Empty } from "@/components/ui";

export default function UpkeepSchedulePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">
          Upkeep Schedule
        </h1>
        <p className="mt-1 text-mute">
          Recurring maintenance the building needs, on a calendar rather than
          in a ticket queue.
        </p>
      </div>

      <Card title="Coming soon">
        <Empty>This page hasn&rsquo;t been built yet.</Empty>
      </Card>
    </div>
  );
}
