/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@hallelx/youtube-transcript', 'undici', 'unpdf'],
    outputFileTracingIncludes: {
      '/api/foundry/refresh': [
        '../agent/scripts/**/*',
        '../agent/EDITORIAL.md',
      ],
      '/api/foundry/pitch/[pitchId]/strengthen': [
        '../agent/scripts/lib/hot-sources.mjs',
        '../agent/EDITORIAL.md',
      ],
      // The article writer reads the charter and the house news style.
      '/api/foundry/pitch/[pitchId]/publish': [
        '../agent/EDITORIAL.md',
        '../agent/NEWS-STYLE.md',
      ],
    },
  },
  async redirects() {
    return [
      // The Indices lives under /indices (so it can later have its own domain); its old addresses keep working.
      { source: '/quality-of-life/:path*', destination: '/indices/quality-of-life/:path*', permanent: true },
      { source: '/sentiment/:path*', destination: '/indices/sentiment/:path*', permanent: true },
      { source: '/indices/people', destination: '/indices/population', permanent: true },
      { source: '/indices/people/:metric', destination: '/indices/economy/people/:metric', permanent: true },
      { source: '/indices/:section(growth|jobs|prices|rates|housing|public)/:path*', destination: '/indices/economy/:section/:path*', permanent: true },
      { source: '/studio', destination: '/foundry', permanent: true },
      { source: '/studio/ask', destination: '/foundry/work', permanent: true },
      { source: '/studio/brainstorm', destination: '/foundry/work', permanent: true },
      { source: '/studio/brainstorm/:id', destination: '/foundry/work/:id', permanent: true },
      { source: '/studio/:path*', destination: '/foundry/:path*', permanent: true },
      { source: '/indicators', destination: '/markets', permanent: true },
      { source: '/indicators/rba-rate-rise', destination: '/markets/rba-rate-rise', permanent: true },
      // Renamed stories keep their old links.
      { source: '/stories/sydney-negative-equity-rba-stale', destination: '/stories/dwelling-values-fall-household-debt-climbs', permanent: true },
      { source: '/evidence/sydney-negative-equity-rba-stale', destination: '/evidence/dwelling-values-fall-household-debt-climbs', permanent: true },
    ];
  },
};
export default nextConfig;
