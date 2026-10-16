"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A landing-page section whose content fades and rises in the first time it
 * scrolls into view. The section's own background stays put (only its direct
 * children animate), so navy and white bands don't flicker.
 *
 * Without JavaScript, or for anyone who asks for reduced motion, everything is
 * simply visible. The server renders it visible too: content that starts
 * above or inside the first screen is never hidden, so there is no flash of
 * empty page. Only sections still below the fold when the page loads are
 * hidden, then revealed as they near the viewport.
 */
export type Tone = "blue" | "taupe" | "white";

/** `tone` picks the band colour (globals.css .land-*). The bands rotate blue, taupe, white down the page. */
export function Reveal({ id, tone, className = "", children }: { id?: string; tone: Tone; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<"visible" | "pending" | "shown">("visible");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined") return;
    // Already on screen when the page loads (or a link jumped past it): leave it alone.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    setState("pending");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState("shown");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section ref={ref} id={id} className={`land-${tone} ${className}`.trim()} data-reveal={state}>
      {children}
    </section>
  );
}
