'use client';

import type { ExternalAppConfig } from '@sorye/types';
import { useState } from 'react';

interface ExternalAppFrameProps {
  config: ExternalAppConfig;
  appName: string;
}

export function ExternalAppFrame({ config, appName }: ExternalAppFrameProps) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[var(--color-surface)]">
      {loading && !failed ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--color-surface)]/70 backdrop-blur-sm">
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)]"
            aria-hidden
          />
          <p className="text-sm text-[var(--color-text-muted)]">
            Loading {appName}…
          </p>
        </div>
      ) : null}

      {failed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm text-red-400">
            Could not load {appName} in the Hub frame.
          </p>
          <a
            href={config.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl bg-white/10 px-4 py-2 text-sm transition hover:bg-white/15"
          >
            Open in a new tab
          </a>
        </div>
      ) : (
        <iframe
          title={config.title ?? appName}
          src={config.url}
          className="h-full min-h-0 w-full flex-1 border-0 bg-white"
          allow="clipboard-read; clipboard-write; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setFailed(true);
          }}
        />
      )}
    </div>
  );
}
