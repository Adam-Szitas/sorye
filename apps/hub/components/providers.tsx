'use client';

import { SWRConfig } from 'swr';
import { SessionProvider } from 'next-auth/react';
import { WebVitalsReporter } from '@/components/web-vitals';
import { fetchHubSession } from '@/lib/hub-session-fetcher';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SWRConfig
        value={{
          fetcher: (url: string) =>
            url === '/api/workspace' ? fetchHubSession() : fetch(url).then((r) => r.json()),
          errorRetryCount: 2,
          shouldRetryOnError: true,
        }}
      >
        <WebVitalsReporter />
        {children}
      </SWRConfig>
    </SessionProvider>
  );
}
