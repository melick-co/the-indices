/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      '/api/foundry/refresh': [
        '../agent/scripts/**/*',
        '../agent/EDITORIAL.md',
      ],
      '/api/foundry/pitch/[pitchId]/strengthen': [
        '../agent/scripts/lib/hot-sources.mjs',
        '../agent/EDITORIAL.md',
      ],
    },
  },
  async redirects() {
    return [
      { source: '/studio', destination: '/foundry', permanent: true },
      { source: '/studio/ask', destination: '/foundry/work', permanent: true },
      { source: '/studio/brainstorm', destination: '/foundry/work', permanent: true },
      { source: '/studio/brainstorm/:id', destination: '/foundry/work/:id', permanent: true },
      { source: '/studio/:path*', destination: '/foundry/:path*', permanent: true },
      { source: '/indicators', destination: '/markets', permanent: true },
      { source: '/indicators/rba-rate-rise', destination: '/markets/rba-rate-rise', permanent: true },
    ];
  },
};
export default nextConfig;
