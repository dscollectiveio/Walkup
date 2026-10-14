import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/signup", "/security", "/privacy", "/policies"], disallow: ["/login", "/account/", "/admin/", "/api/", "/auth/", "/onboarding", "/invite/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
