import { APP_CATALOG } from '@sorye/types';
import { resolveRemoteEntry } from '@/lib/mf-remotes';
import { getAdminEmails } from '@/lib/env';
import { isAuthDevBypass } from '@/lib/auth-dev-bypass';
import { getRodrigoCapabilities, getRodrigoTopology, type RodrigoContext } from '@/lib/rodrigo/service-client';
import { platformWatcherStatus, rodrigoConfigured } from '@/lib/platform-config/watcher';
import { hostConfig } from './hosts';

export type IntegrationStatus = 'configured' | 'not_configured' | 'invalid';

export interface IntegrationRow {
  id: string;
  label: string;
  status: IntegrationStatus;
  /** Who changes it and how. */
  managedBy: 'deployment' | 'console' | 'workspace' | 'user';
  /** Non-secret detail such as a hostname or driver name. */
  detail: string | null;
}

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function originOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return 'invalid URL';
  }
}

export function integrationRows(): IntegrationRow[] {
  const fileDriver = process.env.FILE_STORE_DRIVER ?? 'local';
  const rows: IntegrationRow[] = [
    { id: 'google-oauth', label: 'Google sign-in', status: present('AUTH_GOOGLE_ID') && present('AUTH_GOOGLE_SECRET') ? 'configured' : 'not_configured', managedBy: 'deployment', detail: null },
    { id: 'hub-store', label: 'Hub database', status: process.env.STORE_DRIVER === 'postgres' ? (present('DATABASE_URL') ? 'configured' : 'invalid') : 'configured', managedBy: 'deployment', detail: process.env.STORE_DRIVER === 'postgres' ? 'postgres' : 'json (local only)' },
    { id: 'rodrigo', label: 'Rodrigo backend', status: rodrigoConfigured() ? 'configured' : 'not_configured', managedBy: 'deployment', detail: rodrigoConfigured() ? `${originOf(process.env.RODRIGO_BASE_URL)} · key ${process.env.RODRIGO_KEY_ID}` : null },
    { id: 'file-store', label: 'Drive object storage', status: fileDriver === 's3' ? (present('FILE_S3_BUCKET') ? 'configured' : 'invalid') : fileDriver === 'local' ? 'configured' : 'invalid', managedBy: 'deployment', detail: fileDriver === 's3' ? `s3 · ${process.env.FILE_S3_REGION ?? 'default region'}${process.env.FILE_S3_ENDPOINT ? ` · ${originOf(process.env.FILE_S3_ENDPOINT)}` : ''}${process.env.FILE_S3_PATH_STYLE === 'true' ? ' · path-style' : ''}` : fileDriver },
    { id: 'storage-secret', label: 'Workspace cloud-storage credential key', status: (process.env.STORAGE_SECRET_KEY?.trim().length ?? 0) >= 32 ? 'configured' : 'not_configured', managedBy: 'deployment', detail: null },
    { id: 'mail-secret', label: 'Mail credential key', status: present('MAIL_SECRET_KEY') ? ((process.env.MAIL_SECRET_KEY?.trim().length ?? 0) >= 16 ? 'configured' : 'invalid') : 'configured', managedBy: 'deployment', detail: present('MAIL_SECRET_KEY') ? null : 'derived from AUTH_SECRET' },
    { id: 'protocolio', label: 'Protocolio renderer', status: present('PROTOCOLIO_API_URL') ? 'configured' : 'not_configured', managedBy: 'deployment', detail: present('PROTOCOLIO_API_URL') ? `${originOf(process.env.PROTOCOLIO_API_URL)} · service token ${present('PROTOCOLIO_SERVICE_TOKEN') ? 'set' : 'missing'}` : null },
    { id: 'sentry-server', label: 'Server telemetry', status: present('SENTRY_DSN') ? 'configured' : 'not_configured', managedBy: 'deployment', detail: present('SENTRY_DSN') ? `${process.env.SENTRY_ENVIRONMENT ?? 'environment unset'} · sample ${process.env.SENTRY_TRACES_SAMPLE_RATE ?? 'default'}` : null },
    { id: 'sentry-browser', label: 'Browser telemetry', status: present('NEXT_PUBLIC_SENTRY_DSN') ? 'configured' : 'not_configured', managedBy: 'deployment', detail: present('NEXT_PUBLIC_SENTRY_DSN') ? `${process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'environment unset'} (build input)` : 'build input' },
    { id: 'stripe', label: 'Card payments', status: 'not_configured', managedBy: 'deployment', detail: 'No payment provider is connected. /pricing and /billing exist; plan actions send people to sales (BILLING_SIMULATOR for local testing).' },
  ];
  return rows;
}

export function deliveryRows() {
  return APP_CATALOG.map((app) => {
    if (app.microFrontend) {
      return {
        appId: app.id,
        name: app.name,
        kind: 'micro-frontend' as const,
        remoteName: app.microFrontend.remoteName,
        source: originOf(resolveRemoteEntry(app.microFrontend)),
        applies: 'Hub rebuild (NEXT_PUBLIC_*_REMOTE is a build input)',
      };
    }
    if (app.external) {
      return { appId: app.id, name: app.name, kind: 'external' as const, remoteName: null, source: originOf(app.external.url), applies: 'Code change (catalog URL)' };
    }
    return { appId: app.id, name: app.name, kind: 'hub-native' as const, remoteName: null, source: null, applies: 'Hub release' };
  });
}

export function accessPolicy() {
  const config = hostConfig();
  return {
    publicHost: config.publicHost,
    adminHost: config.adminHost,
    adminEmailCount: getAdminEmails().size,
    productionAdminFailsClosed: config.production && getAdminEmails().size === 0,
    devBypass: isAuthDevBypass(),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE ?? null,
  };
}

const CACHE_MS = 10_000;
type BackendView = Record<string, unknown>;
const KEY = Symbol.for('sorye.admin.backend.status');
const holder = globalThis as typeof globalThis & { [KEY]?: { at: number; value: Promise<BackendView> } };

/** Coalesced Rodrigo capability/topology probe; failure is a status, not an error. */
export function backendStatus(context: RodrigoContext): Promise<BackendView> {
  const cached = holder[KEY];
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = (async (): Promise<BackendView> => {
    if (!rodrigoConfigured()) return { status: 'not_configured' };
    const started = Date.now();
    const [capabilities, topology] = await Promise.allSettled([getRodrigoCapabilities(context), getRodrigoTopology(context)]);
    return {
      status: capabilities.status === 'fulfilled' ? 'up' : 'unavailable',
      latencyMs: Date.now() - started,
      capabilities: capabilities.status === 'fulfilled' ? capabilities.value : null,
      topology: topology.status === 'fulfilled' ? topology.value : null,
      watcher: platformWatcherStatus(),
    };
  })();
  holder[KEY] = { at: Date.now(), value };
  return value;
}
