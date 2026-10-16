"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { completeTour } from "@/app/tour-actions";
import { setSidebarMode, useSidebarState, type SidebarMode } from "@/components/sidebar/sidebar-state";
import { tourStepsFor, type TourRole, type TourStep } from "@/lib/tour/steps";

/** Fired by "Take the tour" in the Help dialog (src/components/sidebar/top-bar.tsx). */
export const START_TOUR_EVENT = "walkup:start-tour";

const CARD_W = 320;
const GAP = 16;
const PAD = 6;

type Box = { top: number; left: number; width: number; height: number };

/**
 * The first-login tour: dims the page, cuts a spotlight around one sidebar
 * item at a time, and explains it in a small card. Starts by itself the
 * first time someone reaches the Dashboard (until they finish or skip it,
 * which is remembered on their sign-in), and again from Help any time.
 *
 * No third-party script, so the strict CSP stays as it is. On a phone the
 * nav is a hidden drawer, so every stop is a centered card instead.
 */
export function AppTour({
  role,
  autoStart,
  stateCode = null,
}: {
  role: TourRole | null;
  autoStart: boolean;
  /** The association's state: the insurance stop names Illinois law only for Illinois. */
  stateCode?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { phone } = useSidebarState();
  const allSteps = useMemo(() => (role ? tourStepsFor(role, { stateCode }) : []), [role, stateCode]);

  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const prevMode = useRef<SidebarMode | null>(null);
  const autoTried = useRef(false);
  const nextRef = useRef<HTMLButtonElement>(null);

  const open = steps !== null;
  const step = steps?.[index] ?? null;
  const last = steps ? index === steps.length - 1 : false;

  const start = useCallback(() => {
    if (allSteps.length === 0) return;
    // Open the labeled sidebar for the tour so every stop has a name next to it.
    const mode: SidebarMode = document.documentElement.dataset.sidebar === "rail" ? "rail" : "expanded";
    if (mode === "rail") {
      prevMode.current = "rail";
      setSidebarMode("expanded");
    }
    // Skip stops whose item isn't on screen for this person.
    setSteps(allSteps.filter((s) => s.target === null || document.querySelector(`[data-tour="${s.target}"]`)));
    setIndex(0);
  }, [allSteps]);

  const finish = useCallback(
    (toChecklist: boolean) => {
      setSteps(null);
      setBox(null);
      if (prevMode.current) {
        setSidebarMode(prevMode.current);
        prevMode.current = null;
      }
      void completeTour();
      if (!toChecklist) return;
      const checklist = document.getElementById("setup-guide");
      if (checklist) checklist.scrollIntoView({ behavior: "smooth", block: "start" });
      else router.push("/");
    },
    [router],
  );

  const next = useCallback(() => {
    if (!steps) return;
    if (index < steps.length - 1) setIndex(index + 1);
    else finish(role === "board_admin");
  }, [steps, index, finish, role]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // First visit to the Dashboard (an owner's Home is /owner): start once it has painted.
  const onHome = pathname === "/" || (role === "owner" && pathname === "/owner");
  useEffect(() => {
    if (!autoStart || autoTried.current || !onHome || allSteps.length === 0) return;
    autoTried.current = true;
    const t = setTimeout(start, 700);
    return () => clearTimeout(t);
  }, [autoStart, onHome, allSteps.length, start]);

  // Replay from Help.
  useEffect(() => {
    const onStart = () => start();
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => window.removeEventListener(START_TOUR_EVENT, onStart);
  }, [start]);

  // Follow the target every frame: the sidebar slides open over 320ms and the page can scroll.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const target = phone ? null : step?.target ?? null;
    const tick = () => {
      const el = target ? document.querySelector(`[data-tour="${target}"]`) : null;
      const r = el?.getBoundingClientRect();
      setBox((prev) => {
        if (!r || r.width === 0) return prev === null ? prev : null;
        if (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height) return prev;
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, step, phone]);

  // Keyboard: Esc skips, arrows move. Focus lands on the main button each step.
  useEffect(() => {
    if (!open) return;
    nextRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      } else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, next, back, finish]);

  if (!open || !step || !steps) return null;

  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const hole = box
    ? { x: box.left - PAD, y: box.top - PAD, w: box.width + PAD * 2, h: box.height + PAD * 2 }
    : null;

  // Beside the highlighted item when there's room, otherwise centered.
  let cardStyle: React.CSSProperties;
  if (hole && hole.x + hole.w + GAP + CARD_W <= vw - GAP) {
    cardStyle = { left: hole.x + hole.w + GAP, top: Math.min(Math.max(GAP, hole.y - 8), vh - 240) };
  } else if (hole) {
    cardStyle = { left: Math.min(Math.max(GAP, hole.x), vw - CARD_W - GAP), top: Math.min(hole.y + hole.h + GAP, vh - 240) };
  } else {
    cardStyle = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  }

  const isFinishForAdmin = last && role === "board_admin";

  return (
    <div className="fixed inset-0 z-[60]">
      {/* The dimmer, with a rounded hole over the current item. It swallows clicks: the tour is modal. */}
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <mask id="walkup-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {hole ? <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx={10} fill="black" /> : null}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(20, 30, 46, 0.6)" mask="url(#walkup-tour-mask)" />
      </svg>
      {hole ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-[10px] ring-2 ring-[#D9A441] transition-all duration-200 motion-reduce:transition-none"
          style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}
        />
      ) : null}

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkup-tour-title"
        aria-describedby="walkup-tour-body"
        className="absolute w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-paper text-ink shadow-2xl transition-[left,top] duration-200 motion-reduce:transition-none"
        style={cardStyle}
      >
        <div className="band bg-ink px-5 py-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ondark-mute">
            {index + 1} of {steps.length}
          </p>
          <h2 id="walkup-tour-title" className="mt-0.5 text-[16px] font-semibold text-paper">
            {step.title}
          </h2>
        </div>
        <p id="walkup-tour-body" className="px-5 pt-4 text-[14px] leading-relaxed text-mute">
          {step.body}
        </p>
        <div className="flex items-center gap-2 px-5 pb-4 pt-4">
          {!last ? (
            <button type="button" onClick={() => finish(false)} className="text-[13px] text-mute underline-offset-2 hover:text-ink hover:underline">
              Skip tour
            </button>
          ) : null}
          <div className="ml-auto flex gap-2">
            {index > 0 ? (
              <button
                type="button"
                onClick={back}
                className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-fill"
              >
                Back
              </button>
            ) : null}
            <button
              ref={nextRef}
              type="button"
              onClick={next}
              className="rounded-md bg-[#D9A441] px-3.5 py-1.5 text-[13px] font-semibold text-[#1B2A41] hover:bg-[#E4B75B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B2A41]"
            >
              {index === 0 ? "Show me around" : isFinishForAdmin ? "Go to the checklist" : last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
