import { Inter_Tight, Source_Serif_4 } from "next/font/google";

// Interface face. Three weights only — nothing at 700 or 800.
// See WALKUP_BRAND.md section 7.
export const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter-tight",
  display: "swap",
});

// Figures face, for currency and tabular amounts only.
export const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-source-serif",
  display: "swap",
});
