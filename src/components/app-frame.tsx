"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isBare, isBarePath } from "@/lib/bare-paths";

const BareContext = createContext<((bare: boolean) => void) | null>(null);

/**
 * Rendered by every sign-in style page (via AuthShell). It tells the frame
 * "this page draws itself", whatever the address bar says, because a server
 * redirect can leave the address at "/" for a moment while the page on screen
 * is still the two-step code page.
 */
export function BareMarker() {
  const setBare = useContext(BareContext);
  useLayoutEffect(() => {
    setBare?.(true);
    return () => setBare?.(false);
  }, [setBare]);
  return null;
}

/**
 * Decides, in the browser, whether a page gets the app's frame (sidebar, top
 * bar, column, footer) or draws itself.
 *
 * It must not be decided on the server from the request path. Sign-in, the
 * password reset and the two-step pages finish with a server redirect, and the
 * layout is rendered for that same request, whose path is still the page the
 * form was on, so a person who had just signed in got the page with no sidebar,
 * no top bar and no margins until they refreshed. The browser knows the page it
 * is really on, and the page itself can say it is bare (BareMarker). The server
 * sends the frame's parts; this picks them.
 *
 * The page content keeps one place in the tree whichever way it goes, so
 * switching never remounts it: only class names and the optional parts change.
 * Coming from a sign-in page into the app also refreshes once, so the frame's
 * parts (whether anyone is signed in, who, the counts) are read for the person
 * signed in now, even if the browser still held a layout from before.
 */
export function AppFrame({
  signedIn,
  sidebar,
  tour,
  topBar,
  footer,
  children,
}: {
  signedIn: boolean;
  sidebar: React.ReactNode;
  tour: React.ReactNode;
  topBar: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [marked, setMarked] = useState(false);
  const bare = marked || isBare(pathname, signedIn);

  // Leaving a sign-in style page for the app: ask the server again. The frame's
  // parts were sent for the page we were on (signed out, say), and a layout the
  // browser kept from then would never learn the person is signed in now.
  const onSignInPage = marked || isBarePath(pathname);
  const wasOnSignInPage = useRef(onSignInPage);
  useEffect(() => {
    if (wasOnSignInPage.current && !onSignInPage) router.refresh();
    wasOnSignInPage.current = onSignInPage;
  }, [onSignInPage, router]);

  return (
    <BareContext.Provider value={setMarked}>
      {!bare && signedIn ? sidebar : null}
      {!bare && signedIn ? tour : null}
      <div className={bare ? "contents" : signedIn ? "app-shell min-h-screen" : "min-h-screen"}>
        {!bare && signedIn ? topBar : null}
        <main className={bare ? "contents" : "mx-auto max-w-[1100px] px-6 py-8 min-[900px]:px-8"}>{children}</main>
        {!bare ? footer : null}
      </div>
    </BareContext.Provider>
  );
}
