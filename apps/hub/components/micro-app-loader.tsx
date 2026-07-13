'use client';

import { init, loadRemote } from '@module-federation/runtime';
import type { MicroFrontendConfig } from '@sorye/types';
import { useEffect, useState } from 'react';

type RemoteApp = React.ComponentType<Record<string, never>>;

let initialized = false;

function ensureInit(config: MicroFrontendConfig) {
  if (initialized) return;
  const entry =
    process.env.NEXT_PUBLIC_DASHBOARD_REMOTE ?? config.remoteEntry;

  init({
    name: 'hub',
    remotes: [
      {
        name: config.remoteName,
        entry,
      },
    ],
  });
  initialized = true;
}

interface MicroAppLoaderProps {
  config: MicroFrontendConfig;
}

export function MicroAppLoader({ config }: MicroAppLoaderProps) {
  const [App, setApp] = useState<RemoteApp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        ensureInit(config);
        const moduleId = `${config.remoteName}/${config.exposedModule.replace(/^\.\//, '')}`;
        const mod = await loadRemote<{ default?: RemoteApp } | RemoteApp>(
          moduleId,
        );
        const Resolved =
          typeof mod === 'function'
            ? mod
            : (mod as { default: RemoteApp }).default;

        if (!cancelled && Resolved) {
          setApp(() => Resolved);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load micro-frontend. Is the remote dev server running?',
          );
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [config]);

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-red-400">{error}</p>
        <p className="text-xs text-[var(--color-text-muted)]">
          Run{' '}
          <code className="text-[var(--color-accent)]">
            pnpm dev:dashboard
          </code>{' '}
          alongside the hub.
        </p>
      </div>
    );
  }

  if (!App) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" />
      </div>
    );
  }

  return <App />;
}
