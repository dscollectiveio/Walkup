import Link from "next/link";
import { Answer } from "@/components/ui";
import type { InsuranceBanner } from "@/lib/insurance/queries";
import { btnGhost } from "./styles";

/**
 * The Overview's item 0 banners (§9.1): finished reads waiting, reads that
 * failed, owner requests, a stale owner summary, possible duplicate premium
 * bills. At most three, in that order. `extra` renders under a banner (the
 * owner request's "Mark done").
 */
export function ReadBanners({
  banners,
  extra,
}: {
  banners: InsuranceBanner[];
  extra?: Record<string, React.ReactNode>;
}) {
  if (banners.length === 0) return null;
  return (
    <div className="space-y-3">
      {banners.slice(0, 3).map((b) => (
        <Answer key={b.key} status={b.tone} headline={b.text}>
          <div className="flex flex-wrap gap-2">
            <Link href={b.href} className={btnGhost}>
              {b.action}
            </Link>
            {extra?.[b.key] ?? null}
          </div>
        </Answer>
      ))}
    </div>
  );
}
