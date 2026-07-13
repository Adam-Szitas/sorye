import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@sorye/types', '@sorye/db', '@sorye/sdk'],
  experimental: {
    optimizePackageImports: ['@sorye/types'],
  },
};

export default nextConfig;
