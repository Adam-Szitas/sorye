'use client';

import { LanguageSelector } from './language-selector';
import { SWRConfig } from 'swr';
import { WebVitalsReporter } from '@/components/web-vitals';
import { fetchHubSession } from '@/lib/hub-session-fetcher';

// No NextAuth `SessionProvider` here: nothing reads `useSession()`. Hub state
// comes from `/api/workspace`, and the provider only added `/api/auth/session`
// requests to every page load and window focus. Sign-in and sign-out do not
// need it, and the middleware keeps the session cookie rolling.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: (url: string) =>
          url === '/api/workspace' ? fetchHubSession() : fetch(url).then((r) => r.json()),
        errorRetryCount: 2,
        shouldRetryOnError: true,
      }}
    >
      <WebVitalsReporter /><LanguageSelector />
      {children}
    </SWRConfig>
  );
}
