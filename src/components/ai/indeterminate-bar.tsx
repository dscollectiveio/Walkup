/**
 * The thin sliding bar the contractor search shows while it works, for any wait
 * whose length is unknown (a search, a file being read). Same look as
 * PollWhileRunning's. The live region says what is running; the bar itself is
 * decoration, and holds still under reduced motion.
 */
export function IndeterminateBar({ label }: { label: string }) {
  return (
    <div className="space-y-2">
      <style href="walkup-poll-indeterminate" precedence="default">{`
@keyframes walkup-indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
.walkup-indeterminate { animation: walkup-indeterminate 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .walkup-indeterminate { animation: none; } }
`}</style>
      <div role="status" aria-live="polite" className="text-[13px] font-medium text-ink">
        {label}…
      </div>
      <div className="h-1 overflow-hidden rounded bg-fill" aria-hidden="true">
        <div className="walkup-indeterminate h-full w-1/3 rounded bg-ink-mid" />
      </div>
    </div>
  );
}
