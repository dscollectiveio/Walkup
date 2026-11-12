import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-config";

const SITE = SITE_URL;

/** The pages anyone can read without an account. Everything else is behind sign-in. */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/features", "/form-1120-h", "/signup", "/login", "/security", "/privacy", "/terms", "/policies"].map((path) => ({
    url: `${SITE}${path}`,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/signup" ? 0.8 : path === "/features" || path === "/form-1120-h" ? 0.7 : 0.4,
  }));
}
