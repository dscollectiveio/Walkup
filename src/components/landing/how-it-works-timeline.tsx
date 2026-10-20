"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, HardHat, Landmark, PiggyBank, ShieldCheck } from "lucide-react";
import { TimelineArt } from "./timeline-art";

// Two offset rectangles sit behind each card, in these colours in turn.
const SHAPES: [string, string][] = [
  ["#D9A441", "#EBD3A0"],
  ["#2d4a7c", "#A3B4D2"],
  ["#2f7a5c", "#A9CEBC"],
  ["#a3432f", "#E6B4A8"],
  ["#8fa3c4", "#CBD5E8"],
];

const STEPS = [
  {
    Icon: Building2,
    title: "Set up your building",
    body: "Sign up and turn on two-step sign-in, then add your building's details and key documents, and enter your units and owners. You can import units, owners and past transactions from a spreadsheet, and invite the rest of the board with a link. Walkup sets up your fiscal year, funds and chart of accounts for you.",
  },
  {
    Icon: Landmark,
    title: "Connect your bank",
    body: "Link the association's bank through Plaid, read-only. Recent transactions arrive already sorted, with a suggested category and the reason for it.",
  },
  {
    Icon: PiggyBank,
    title: "Set dues and the budget",
    body: "Enter each unit's dues, and start the budget from last year's numbers. From here, Walkup tells you what needs you each month and who is behind.",
  },
  {
    Icon: ShieldCheck,
    title: "Add insurance and tax info",
    body: "Upload your insurance policy and add your tax details.",
    why: "Why it matters: the coverage check shows gaps before a claim does, renewal reminders stop a surprise rate increase, and your tax details let Walkup check Form 1120-H and keep every deadline in front of you.",
  },
  {
    Icon: HardHat,
    title: "Add your existing contractors",
    body: "Add the contractors you already use, with their W-9s and insurance certificates.",
    why: "Why it matters: when something breaks, you can ask them for a quote in one click, expiring paperwork gets flagged, and your 1099 list is ready in January.",
  },
];

/**
 * How it works, as a timeline. A line down the page fills in as you scroll,
 * following you in both directions; each step's card slides in from its side
 * when it comes into view and slides back out when it leaves, so the motion
 * replays on the way up as well as the way down. Each step's dot lights up
 * once the line has reached it. Without JavaScript, or with reduced motion,
 * every step simply shows.
 */
export function HowItWorksTimeline() {
  const wrap = useRef<HTMLOListElement>(null);
  const dots = useRef<(HTMLSpanElement | null)[]>([]);
  const [inView, setInView] = useState<boolean[]>(() => STEPS.map(() => true));
  const [reached, setReached] = useState<boolean[]>(() => STEPS.map(() => true));
  const [progress, setProgress] = useState(1);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const items = wrap.current ? Array.from(wrap.current.querySelectorAll<HTMLElement>("[data-step]")) : [];
    const io = new IntersectionObserver(
      (entries) => {
        setInView((prev) => {
          const next = [...prev];
          for (const e of entries) next[Number((e.target as HTMLElement).dataset.step)] = e.isIntersecting;
          return next;
        });
      },
      { rootMargin: "-12% 0px -22% 0px", threshold: 0.12 },
    );
    items.forEach((el) => io.observe(el));

    let frame = 0;
    const update = () => {
      frame = 0;
      const el = wrap.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const mid = window.innerHeight * 0.55;
      setProgress(Math.min(1, Math.max(0, (mid - rect.top) / rect.height)));
      setReached(dots.current.map((d) => (d ? d.getBoundingClientRect().top + 24 < mid : false)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    // Switch from "everything shown" (server, no JavaScript) to the animated
    // state on the next frame, not inside the effect body.
    const start = requestAnimationFrame(() => {
      setAnimate(true);
      setInView(STEPS.map(() => false));
      setReached(STEPS.map(() => false));
      setProgress(0);
      items.forEach((el) => {
        io.unobserve(el);
        io.observe(el);
      });
      update();
    });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(start);
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <ol ref={wrap} className="relative mt-10 space-y-10 pb-6 md:space-y-16">
      {/* The line: a faint track, and a gold fill that grows with your scroll. */}
      <span aria-hidden="true" className="absolute bottom-0 left-[22px] top-0 w-0.5 rounded bg-line md:left-1/2 md:-translate-x-1/2" />
      <span
        aria-hidden="true"
        className="absolute left-[22px] top-0 w-0.5 origin-top rounded bg-brass md:left-1/2 md:-translate-x-1/2"
        style={{ height: `${progress * 100}%`, transition: animate ? "height 120ms linear" : undefined }}
      />

      {STEPS.map(({ Icon, title, body, why }, i) => {
        const left = i % 2 === 0;
        const shown = inView[i];
        const lit = reached[i];
        return (
          <li key={title} data-step={i} className="relative pl-14 md:grid md:grid-cols-2 md:gap-14 md:pl-0">
            {/* The dot on the line */}
            <span
              ref={(el) => void (dots.current[i] = el)}
              aria-hidden="true"
              className={`absolute left-0 top-1 flex h-11 w-11 items-center justify-center rounded-full border-2 transition-all duration-500 ease-out md:left-1/2 md:-translate-x-1/2 ${
                lit
                  ? "scale-100 border-brass bg-brass text-on-brass shadow-[0_0_0_6px_rgba(217,164,65,0.22)]"
                  : "scale-90 border-line-strong bg-paper text-mute"
              }`}
            >
              <Icon size={20} strokeWidth={1.8} />
            </span>

            {/* The card, with two offset rectangles behind it. Everything slides in from the card's side
                (the rectangles a beat later, so they trail it) and back out when it leaves the screen. */}
            <div className={`relative md:row-start-1 ${left ? "md:col-start-1 md:mr-6" : "md:col-start-2 md:ml-6"}`}>
              {[1, 0].map((n) => (
                <span
                  key={n}
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-0 rounded-xl ${
                    n === 0
                      ? left
                        ? "translate-x-[10px] translate-y-[10px] md:translate-x-[14px] md:translate-y-[14px]"
                        : "translate-x-[10px] translate-y-[10px] md:-translate-x-[14px] md:translate-y-[14px]"
                      : left
                        ? "translate-x-[20px] translate-y-[20px] md:translate-x-[28px] md:translate-y-[28px]"
                        : "translate-x-[20px] translate-y-[20px] md:-translate-x-[28px] md:translate-y-[28px]"
                  }`}
                  style={{
                    background: SHAPES[i][n],
                    opacity: animate ? (shown ? 1 : 0) : 1,
                    ...(animate
                      ? {
                          transform: shown ? "none" : `translateX(${left ? "-90px" : "90px"}) rotate(${left ? -3 : 3}deg) scale(0.92)`,
                          transition: `opacity 700ms ${120 + n * 110}ms cubic-bezier(0.22,1,0.36,1), transform 900ms ${120 + n * 110}ms cubic-bezier(0.22,1,0.36,1)`,
                        }
                      : {}),
                  }}
                />
              ))}
              <div
                className="relative rounded-xl border border-line bg-paper p-4 shadow-[0_10px_30px_-18px_rgba(27,42,65,0.35)] will-change-transform sm:p-5"
                style={
                  animate
                    ? {
                        opacity: shown ? 1 : 0,
                        transform: shown ? "translateX(0) scale(1)" : `translateX(${left ? "-56px" : "56px"}) scale(0.94)`,
                        transition: "opacity 700ms cubic-bezier(0.22,1,0.36,1), transform 800ms cubic-bezier(0.22,1,0.36,1)",
                      }
                    : undefined
                }
              >
                <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-eyebrow">Step {i + 1}</p>
                <h3 className="mt-0.5 text-[17px] font-bold text-ink">{title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-mute">{body}</p>
                {why ? (
                  <p className="mt-2.5 rounded-lg bg-brass/10 px-3 py-2 text-[13px] leading-relaxed text-ink">{why}</p>
                ) : null}
              </div>
            </div>
            {/* The picture on the other side of the line, sliding in from the centre with its card. */}
            <div
              className={`hidden items-center justify-center md:row-start-1 md:flex ${left ? "md:col-start-2 md:pl-6" : "md:col-start-1 md:pr-6"} ${shown || !animate ? "tl-run" : ""}`}
              style={
                animate
                  ? {
                      opacity: shown ? 1 : 0,
                      transform: shown ? "none" : `translateX(${left ? "60px" : "-60px"}) scale(0.9)`,
                      transition: "opacity 800ms 200ms cubic-bezier(0.22,1,0.36,1), transform 900ms 200ms cubic-bezier(0.22,1,0.36,1)",
                    }
                  : undefined
              }
            >
              <TimelineArt index={i} />
            </div>
            {/* A faint dividing line to the next step. */}
            {i < STEPS.length - 1 ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-5 left-0 right-0 h-px bg-gradient-to-r from-transparent via-line-strong/60 to-transparent md:-bottom-8"
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
