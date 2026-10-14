import type { MetadataRoute } from "next";

const SITE = "https://walkuphoa.com";

/** The pages anyone can read without an account. Everything else is behind sign-in. */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/signup", "/login", "/security", "/privacy", "/policies"].map((path) => ({
    url: `${SITE}${path}`,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/signup" ? 0.8 : 0.4,
  }));
}
