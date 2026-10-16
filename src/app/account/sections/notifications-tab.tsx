import { Card } from "@/components/ui";
import { ThemeToggle } from "@/components/sidebar/theme-toggle";
import { EmailPreferencesSlot } from "@/app/owner/profile/email-preferences-slot";

/** Notifications: which emails the board may send through Walkup, and how Walkup looks on this device. */
export function NotificationsTab() {
  return (
    <>
      <EmailPreferencesSlot />
      <Card navy title="Appearance">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[14px] font-medium text-ink">Light or dark</p>
            <p className="mt-0.5 text-[13px] text-mute">Saved on this device. Each phone or computer keeps its own choice.</p>
          </div>
          <ThemeToggle />
        </div>
      </Card>
    </>
  );
}
