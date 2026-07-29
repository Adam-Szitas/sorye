'use client';

import { resolveRemoteEntry } from '@/lib/mf-remotes';
import { init, loadRemote, registerRemotes } from '@module-federation/runtime';
import type { MicroFrontendConfig } from '@sorye/types';
import { useEffect, useRef, useState } from 'react';

type RemoteMount = (container: HTMLElement) => () => void;

let hubInitialized = false;
const registeredRemotes = new Set<string>();

function ensureHub() {
  if (hubInitialized) return;
  init({
    name: 'hub',
    remotes: [],
    shareStrategy: 'loaded-first',
  });
  hubInitialized = true;
}

function ensureRemote(config: MicroFrontendConfig) {
  ensureHub();
  if (registeredRemotes.has(config.remoteName)) return;

  registerRemotes([
    {
      name: config.remoteName,
      entry: resolveRemoteEntry(config),
      type: 'module',
    },
  ]);
  registeredRemotes.add(config.remoteName);
}

function resolveMount(mod: unknown): RemoteMount | null {
  if (!mod) return null;
  if (typeof mod === 'function') return mod as RemoteMount;
  if (typeof mod === 'object') {
    const record = mod as { mount?: RemoteMount; default?: RemoteMount };
    if (typeof record.mount === 'function') return record.mount;
    if (typeof record.default === 'function') return record.default;
  }
  return null;
}

interface MicroAppLoaderProps {
  config: MicroFrontendConfig;
}

export function MicroAppLoader({ config }: MicroAppLoaderProps) {
  const [mountTarget, setMountTarget] = useState<HTMLDivElement | null>(null);
  const [mountFn, setMountFn] = useState<RemoteMount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const configKey = useRef('');

  useEffect(() => {
    let cancelled = false;
    const key = `${config.remoteName}:${config.exposedModule}:${resolveRemoteEntry(config)}`;
    configKey.current = key;

    async function load() {
      setLoading(true);
      setError(null);
      setMountFn(null);

      try {
        ensureRemote(config);
        const moduleId = `${config.remoteName}/${config.exposedModule.replace(/^\.\//, '')}`;
        const mod = await loadRemote<unknown>(moduleId);
        const resolved = resolveMount(mod);

        if (!resolved) {
          throw new Error(
            `Remote "${config.remoteName}" did not export a mount() function.`,
          );
        }

        if (!cancelled && configKey.current === key) {
          setMountFn(() => resolved);
        }
      } catch (err) {
        if (!cancelled && configKey.current === key) {
          setLoading(false);
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

  useEffect(() => {
    if (!mountFn || !mountTarget) return;

    let unmounted = false;
    const cleanup = mountFn(mountTarget);

    if (!unmounted) {
      setLoading(false);
    }

    return () => {
      unmounted = true;
      cleanup();
    };
  }, [mountFn, mountTarget]);

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-red-400">{error}</p>
        <p className="text-xs text-[var(--color-text-muted)]">
          Start the remote dev server for{' '}
          <code className="text-[var(--color-accent)]">{config.remoteName}</code>{' '}
          (e.g. run <code className="text-[var(--color-accent)]">pnpm dev</code>{' '}
          or <code className="text-[var(--color-accent)]">pnpm dev:{config.remoteName}</code>
          ).
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {loading ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--color-surface)]/70 backdrop-blur-sm">
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)]"
            aria-hidden
          />
          <p className="text-sm text-[var(--color-text-muted)]">Loading app…</p>
        </div>
      ) : null}
      <div ref={setMountTarget} className="flex min-h-0 flex-1 flex-col" />
    </div>
  );
}
