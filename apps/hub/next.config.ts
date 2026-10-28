import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';

/** Hub Next config — types package is compiled via transpilePackages, not barrel-optimized. */
const nextConfig: NextConfig = {
  transpilePackages: ['@sorye/types', '@sorye/db', '@sorye/sdk', '@sorye/platform'],
  serverExternalPackages: ['imapflow', 'nodemailer', 'mailparser', 'pdfjs-dist'],
};

const sentryConfig = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
  widenClientFileUpload: false,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
};

// Without a DSN there is no telemetry destination. Avoid wrapping every route
// and generating telemetry transforms for an unconfigured SDK in local dev.
export default process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryConfig)
  : nextConfig;
