import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SITE_TAGLINE } from "@/lib/site-config";

/**
 * The link-preview image for every page: navy, the bare mark with the cream
 * "Walkup" lockup, and the tagline. Built once at build time. Outfit Medium
 * (OFL) is bundled in src/app/_fonts so the wordmark matches the logo files.
 */

export const alt = "Walkup: run your building's books in 15 minutes a month.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const NAVY = "#1B2A41";
const MARK = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <circle cx="24" cy="39" r="13" fill="#F5EFE3" stroke="${NAVY}" stroke-width="2"/>
  <circle cx="40" cy="39" r="13" fill="#A3432F" stroke="${NAVY}" stroke-width="2"/>
  <circle cx="32" cy="24" r="14" fill="#D9A441" stroke="${NAVY}" stroke-width="2"/>
  <circle cx="32" cy="21" r="3.6" fill="${NAVY}"/>
  <path d="M30.1 23.5H33.9L35.4 32H28.6Z" fill="${NAVY}"/>
</svg>`;

export default async function OpengraphImage() {
  const outfit = await readFile(join(process.cwd(), "src/app/_fonts/Outfit-Medium.ttf"));
  const markSize = 150;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: NAVY,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Outfit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: Math.round(markSize * 0.22) }}>
          <img src={`data:image/svg+xml;base64,${Buffer.from(MARK).toString("base64")}`} width={markSize} height={markSize} alt="" />
          <span style={{ color: "#F5EFE3", fontSize: Math.round(markSize * 0.8), letterSpacing: "-0.03em", fontWeight: 500 }}>
            Walkup
          </span>
        </div>
        <div style={{ marginTop: 44, color: "#F5EFE3", fontSize: 44, fontWeight: 500, letterSpacing: "-0.01em" }}>
          {SITE_TAGLINE}
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Outfit", data: outfit, weight: 500, style: "normal" }] },
  );
}
