"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Re-checks every few seconds while the Document Hub reads the file. */
export function Waiting({ manualHref }: { manualHref: string }) {
  const router = useRouter();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => {
      setSeconds((s) => s + 3);
      router.refresh();
    }, 3000);
    return () => clearInterval(tick);
  }, [router]);

  return (
    <div className="rounded-xl border border-line bg-paper px-5 py-6 text-[13px]" role="status" aria-live="polite">
      <p className="font-medium text-ink">Reading your policy…</p>
      <p className="mt-1 text-mute">This usually takes under a minute. The page updates on its own.</p>
      {seconds >= 90 ? (
        <p className="mt-3 text-mute">
          Taking longer than usual.{" "}
          <a href={manualHref} className="font-medium text-ink underline underline-offset-2">
            Enter the details by hand instead
          </a>
          .
        </p>
      ) : null}
    </div>
  );
}
