import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep a visited page in the browser's router cache for 30 seconds, so
    // switching back to it (or back and forth between two tabs of the app)
    // is instant instead of a fresh server render. Every server action that
    // changes data calls revalidatePath, which clears this cache, so a save
    // is never hidden behind a stale page.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
