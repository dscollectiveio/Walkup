import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/signup", "/security", "/privacy", "/policies"], disallow: ["/login", "/account/", "/admin/", "/api/", "/auth/", "/onboarding", "/invite/"] }],
    sitemap: "https://walkuphoa.com/sitemap.xml",
  };
}
