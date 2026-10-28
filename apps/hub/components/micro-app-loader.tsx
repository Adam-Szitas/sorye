'use client';

import { KernelSyncBoundary, useHubKernelHost } from '@/components/hub-kernel';
import { resolveRemoteEntry } from '@/lib/mf-remotes';
import { init, loadRemote, registerRemotes } from '@module-federation/runtime';
import type { AppFramework, KernelMountContext } from '@sorye/platform';
import type { MicroFrontendConfig } from '@sorye/types';
import { useEffect, useState } from 'react';

type RemoteMount = (container: HTMLElement, context?: KernelMountContext) => () => void;

let hubInitialized = false;
/** remoteName → last registered entry URL */
const registeredEntries = new Map<string, string>();

function ensureHub() {
  if (hubInitialized) return;
  init({
    name: 'hub',
    remotes: [],
    shareStrategy: 'loaded-first',
  });
  hubInitialized = true;
}

function ensureRemote(remoteName: string, entry: string) {
  ensureHub();
  if (registeredEntries.get(remoteName) === entry) return;

  registerRemotes([
    {
      name: remoteName,
      entry,
      type: 'module',
    },
  ]);
  registeredEntries.set(remoteName, entry);
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
  appId: string;
  /** Existing remotes are React. The kernel records this on the mount. */
  framework?: AppFramework;
}

export function MicroAppLoader(props: MicroAppLoaderProps) {
  const host = useHubKernelHost();
  if (!host) {
    return (
      <KernelSyncBoundary appId={props.appId}>
        <MicroAppMount {...props} />
      </KernelSyncBoundary>
    );
  }
  return <MicroAppMount {...props} />;
}

function MicroAppMount({ config, appId, framework = 'react' }: MicroAppLoaderProps) {
  const host = useHubKernelHost();
  const [mountTarget, setMountTarget] = useState<HTMLDivElement | null>(null);
  const [mountFn, setMountFn] = useState<RemoteMount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const remoteName = config.remoteName;
  const exposedModule = config.exposedModule;
  const remoteEntry = resolveRemoteEntry(config);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setMountFn(null);

      try {
        ensureRemote(remoteName, remoteEntry);
        const moduleId = `${remoteName}/${exposedModule.replace(/^\.\//, '')}`;
        const mod = await loadRemote<unknown>(moduleId);
        const resolved = resolveMount(mod);

        if (!resolved) {
          throw new Error(
            `Remote "${remoteName}" did not export a mount() function.`,
          );
        }

        if (!cancelled) {
          setMountFn(() => resolved);
        }
      } catch (err) {
        if (!cancelled) {
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
    // Primitive identity — a new `config` object with the same fields must
    // not remount a live remote.
  }, [remoteName, exposedModule, remoteEntry]);

  useEffect(() => {
    if (!mountFn || !mountTarget || !host) return;

    let unmounted = false;
    const kernel = host.clientFor({ appId, framework });
    let cleanup = () => {};
    try {
      cleanup = mountFn(mountTarget, { kernel });
    } catch (err) {
      kernel.dispose();
      if (!unmounted) {
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Failed to mount app');
      }
      return;
    }

    if (!unmounted) {
      setLoading(false);
    }

    return () => {
      unmounted = true;
      cleanup();
      kernel.dispose();
    };
  }, [mountFn, mountTarget, host, appId, framework]);

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
