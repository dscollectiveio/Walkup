import Link from "next/link";
import { Mark } from "@/components/mark";

/**
 * The frame every step between "Get started" and the Dashboard shares:
 * sign up, check your email, sign in, set up two-step sign-in, enter a code,
 * create your building. A navy brand panel on the left (hidden on phones,
 * where a compact navy header takes its place) and the form on a card to the
 * right, with a progress strip for the three first-run steps.
 *
 * The root layout renders these routes without the app chrome (see
 * BARE_PATHS in src/app/layout.tsx). Brand navy is a fixed colour here, not
 * the `ink` token, which flips in dark mode.
 */

export const FIRST_RUN_STEPS = ["Create your account", "Secure it", "Set up your building"] as const;

export const authInput =
  "mt-1.5 w-full rounded-lg border border-line-strong bg-paper px-3.5 py-2.5 text-[15px] text-ink placeholder:text-mute-soft focus:border-[#14213d] focus:outline-none focus:ring-2 focus:ring-[#c08a3e]/40";
export const authLabel = "block text-[13px] font-semibold text-ink";
export const authButton =
  "inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-[#14213d] px-4 text-[15px] font-semibold text-white transition-colors hover:bg-[#1e2e52] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c08a3e] disabled:opacity-60";
export const authError = "rounded-lg border border-bad-line bg-bad-tint px-3.5 py-2.5 text-[13px] text-bad-text";

const POINTS = [
  "Read-only bank access — Walkup never moves money",
  "Nothing is sent on your behalf without you",
  "Two-step sign-in protects every account",
  "Free during early access",
];

function Brand() {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 text-white" aria-label="Walkup home">
      <Mark variant="dark" size={30} />
      <span className="text-[17px] font-semibold tracking-tight">Walkup</span>
    </Link>
  );
}

function Steps({ current }: { current: number }) {
  return (
    <ol className="mb-8 flex items-center gap-2" aria-label="Setup progress">
      {FIRST_RUN_STEPS.map((label, i) => {
        const state = i < current ? "done" : i === current ? "now" : "later";
        return (
          <li key={label} className="flex min-w-0 flex-1 flex-col gap-1.5" aria-current={state === "now" ? "step" : undefined}>
            <span
              className={`h-1.5 rounded-full ${
                state === "later" ? "bg-line" : "bg-[#c08a3e]"
              }`}
            />
            <span className={`truncate text-[11px] font-medium ${state === "later" ? "text-mute-soft" : "text-ink"}`}>
              {i + 1}. {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function AuthShell({
  title,
  subtitle,
  step,
  children,
  footer,
  aside,
}: {
  title: string;
  subtitle?: React.ReactNode;
  /** 0–2 for the first-run steps; omit on sign-in pages. */
  step?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Replaces the default brand-panel copy. */
  aside?: { heading: string; body: string };
}) {
  return (
    <div className="min-h-screen bg-bone lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Brand panel (desktop) */}
      <aside className="relative hidden overflow-hidden bg-[#14213d] px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between">
        <Brand />
        <div className="max-w-md">
          <h2 className="text-[34px] font-bold leading-[1.1] tracking-tight">
            {aside?.heading ?? "Your building's books, dues and taxes — in one calm place."}
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-white/75">
            {aside?.body ??
              "Built for self-managed Illinois condo associations of 2 to 20 units, and the volunteers who keep them running."}
          </p>
          <ul className="mt-8 space-y-3 text-[14px] text-white/85">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-3">
                <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-[3px] h-4 w-4 shrink-0 text-[#c08a3e]">
                  <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[12px] text-white/50">
          <Link href="/privacy" className="hover:text-white">Privacy</Link>
          <span className="mx-2">·</span>
          <Link href="/security" className="hover:text-white">Security</Link>
          <span className="mx-2">·</span>
          <a href="mailto:doug.smart6@gmail.com" className="hover:text-white">Help</a>
        </p>
        {/* the stair motif, large and quiet */}
        <svg viewBox="0 0 32 32" aria-hidden="true" className="pointer-events-none absolute -bottom-16 -right-16 h-80 w-80 text-white/[0.04]">
          <path d="M5 27V21.5H11.5V16H18V10.5H27V27Z" fill="currentColor" />
        </svg>
      </aside>

      {/* Compact header (phones and tablets) */}
      <header className="bg-[#14213d] px-6 py-4 lg:hidden">
        <Brand />
      </header>

      {/* Form */}
      <main className="flex items-start justify-center px-5 py-10 sm:px-8 lg:items-center lg:py-16">
        <div className="w-full max-w-[440px]">
          {step !== undefined ? <Steps current={step} /> : null}
          <div className="rounded-2xl border border-line bg-paper p-7 shadow-[0_1px_2px_rgba(20,33,61,0.04),0_12px_32px_-12px_rgba(20,33,61,0.18)] sm:p-9">
            <h1 className="text-[24px] font-bold leading-tight tracking-tight text-ink">{title}</h1>
            {subtitle ? <div className="mt-2 text-[14px] leading-relaxed text-mute">{subtitle}</div> : null}
            <div className="mt-7">{children}</div>
          </div>
          {footer ? <div className="mt-6 text-center text-[14px] text-mute">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
