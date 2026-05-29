import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep dynamic RSC payloads in the router cache for 30s so back-nav from
    // a list to /lists is instant. Dexie + Realtime reconcile any drift.
    staleTimes: { dynamic: 30 },
    // Raise the server-action body cap (default 1MB) so spoken-list audio
    // clips (extractItemsFromAudio) upload; opus is tiny, headroom is for the
    // WAV fallback if Gemini ever rejects webm/opus.
    serverActions: { bodySizeLimit: '5mb' },
  },
};

export default nextConfig;
