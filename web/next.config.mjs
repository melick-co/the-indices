/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      '/api/foundry/refresh': [
        '../agent/scripts/**/*',
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
    ];
  },
};
export default nextConfig;
