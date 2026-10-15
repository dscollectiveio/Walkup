import type { ConsoleMessage, Page } from "@playwright/test";

export const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
} as const;

/**
 * Known dev-server noise that is NOT an app defect. Kept narrow on purpose:
 *  - HMR websocket: Next dev's /_next/webpack-hmr connection drops/retries
 *    when the dev server restarts or the tab navigates quickly.
 *  - "Failed to load resource ... 404/ERR_ABORTED" for /_next/static chunks:
 *    stale chunk URLs requested right after a dev restart (other engineers
 *    are editing src/ concurrently). Only /_next/ URLs are tolerated; a failed
 *    resource anywhere else (or any 5xx) still fails the test.
 *  - React DevTools download hint (info-level, harmless).
 */
const KNOWN_NOISE: RegExp[] = [
  /webpack-hmr/i,
  /WebSocket connection to .* failed/i,
  /\[HMR\]/i,
  /Download the React DevTools/i,
];

export function isKnownNoise(msg: ConsoleMessage): boolean {
  const text = msg.text();
  if (KNOWN_NOISE.some((r) => r.test(text))) return true;
  if (/Failed to load resource/i.test(text) && /\/_next\//.test(msg.location().url ?? "")) return true;
  return false;
}

export interface Collected {
  errors: string[];
  csp: string[];
}

/** Attach before navigation. Collects console errors (minus noise) and CSP violations. */
export function collectConsole(page: Page): Collected {
  const c: Collected = { errors: [], csp: [] };
  page.on("console", (m) => {
    const text = m.text();
    if (/Content Security Policy|violates the following|Refused to (load|execute|apply|connect)/i.test(text)) {
      c.csp.push(text.slice(0, 300));
      return;
    }
    if (m.type() === "error" && !isKnownNoise(m)) c.errors.push(`${text.slice(0, 300)} @ ${m.location().url}`);
  });
  page.on("pageerror", (e) => c.errors.push(`pageerror: ${e.message.slice(0, 300)}`));
  return c;
}

export async function overflowInfo(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const offenders: string[] = [];
    if (de.scrollWidth > window.innerWidth) {
      for (const el of Array.from(document.body.querySelectorAll("*")).slice(0, 4000)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > window.innerWidth + 1) {
          const e = el as HTMLElement;
          offenders.push(`${el.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}.${String(e.className).split(" ").slice(0, 3).join(".")} right=${Math.round(r.right)}`);
          if (offenders.length >= 5) break;
        }
      }
    }
    return { scrollWidth: de.scrollWidth, innerWidth: window.innerWidth, offenders };
  });
}
