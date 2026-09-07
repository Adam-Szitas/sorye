import type { NextConfig } from 'next';

/** Hub Next config — types package is compiled via transpilePackages, not barrel-optimized. */
const nextConfig: NextConfig = {
  transpilePackages: ['@sorye/types', '@sorye/db', '@sorye/sdk'],
};

export default nextConfig;
