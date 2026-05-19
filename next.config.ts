import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep dynamic RSC payloads in the router cache for 30s so back-nav from
    // a list to /lists is instant. Dexie + Realtime reconcile any drift.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
