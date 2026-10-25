import * as Sentry from '@sentry/browser';
import { Component, type ErrorInfo, type ReactNode } from 'react';

const SENSITIVE_KEY = /authorization|cookie|password|secret|token|api[-_]?key|body|content|payload|message|file|attachment|email/i;
const SENSITIVE_QUERY =
  /(?:auth|authorization|cookie|code|email|key|password|secret|token|signature|sig|file|body|content)/i;
const viteEnv = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;

function scrubUrl(value: string): string {
  try {
    const url = new URL(value, window.location.origin);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY.test(key)) url.searchParams.set(key, '[Filtered]');
    }
    url.hash = '';
    return url.toString();
  } catch {
    return '[Filtered URL]';
  }
}

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 2048 ? '[Filtered long value]' : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrub(item, depth + 1));
  if (typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .map(([key, item]) => [
        key,
        key === 'url' || key === 'request_url' ? scrubUrl(String(item)) : scrub(item, depth + 1),
      ]),
  );
}

function parseSampleRate(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export function initSoryeTelemetry(appName: string): boolean {
  const dsn = viteEnv?.VITE_SENTRY_DSN;
  if (!dsn || typeof window === 'undefined' || Sentry.getClient()) return Boolean(Sentry.getClient());

  Sentry.init({
    dsn,
    environment: viteEnv?.VITE_SENTRY_ENVIRONMENT || 'development',
    release: viteEnv?.VITE_SENTRY_RELEASE || undefined,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.httpClientIntegration({ failedRequestStatusCodes: [[400, 599]] }),
    ],
    tracesSampleRate: parseSampleRate(viteEnv?.VITE_SENTRY_TRACES_SAMPLE_RATE, 0.05),
    sendDefaultPii: false,
    initialScope: { tags: { app: appName, platform: 'sorye-remote' } },
    beforeSend(event) {
      const cleaned = scrub(event) as Sentry.ErrorEvent;
      if (cleaned.request) {
        delete cleaned.request.data;
        delete cleaned.request.cookies;
        delete cleaned.request.headers;
      }
      return cleaned;
    },
    beforeSendTransaction(event) {
      return scrub(event) as typeof event;
    },
  });
  return true;
}

export function captureRemoteException(error: unknown, appName: string): void {
  Sentry.withScope((scope) => {
    scope.setTag('app', appName);
    Sentry.captureException(error);
  });
}

export class TelemetryErrorBoundary extends Component<
  { appName: string; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    captureRemoteException(error, this.props.appName);
    void info;
  }

  render(): ReactNode {
    return this.state.hasError ? (
      <div role="alert">This app encountered an error. Reload the app to try again.</div>
    ) : (
      this.props.children
    );
  }
}

export function mountWithTelemetry(
  container: HTMLElement,
  appName: string,
  render: () => ReactNode,
  createRoot: (container: HTMLElement) => { render(node: ReactNode): void; unmount(): void },
): () => void {
  initSoryeTelemetry(appName);
  const root = createRoot(container);
  root.render(<TelemetryErrorBoundary appName={appName}>{render()}</TelemetryErrorBoundary>);
  return () => root.unmount();
}
