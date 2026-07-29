import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  APP_CATALOG,
  getPlanById,
  SUBSCRIPTION_PLANS,
  type EmbedWidget,
  type HubSession,
} from '@sorye/types';
import {
  API_PRESETS,
  appendLog,
  clearLogs,
  formatJson,
  loadLogs,
  runHubRequest,
  type DevkitLogEntry,
  type HttpMethod,
} from './devkit-store';
import './styles.css';

type Tab = 'overview' | 'api' | 'embed' | 'webhooks' | 'logs';

const REMOTE_PORTS: Record<string, number> = {
  dashboard: 3001,
  calendar: 3003,
  notes: 3004,
  tasks: 3005,
  relay: 3006,
  protocolio: 3007,
  canvas: 3008,
  devkit: 3009,
  messenger: 3010,
};

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [session, setSession] = useState<HubSession | null>(null);
  const [widgets, setWidgets] = useState<EmbedWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<DevkitLogEntry[]>([]);
  const [remoteHealth, setRemoteHealth] = useState<
    Record<string, 'ok' | 'down' | 'checking'>
  >({});

  const refreshLogs = useCallback(() => setLogs(loadLogs()), []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/workspace', { credentials: 'include' });
      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? 'Sign in through the Hub to use DevKit.'
            : 'Could not load workspace.',
        );
      }
      const data = (await res.json()) as HubSession;
      setSession(data);

      const wRes = await fetch('/api/embed/widgets', { credentials: 'include' });
      if (wRes.ok) {
        const wData = (await wRes.json()) as { widgets: EmbedWidget[] };
        setWidgets(wData.widgets ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
      refreshLogs();
    }
  }, [refreshLogs]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const remotes = APP_CATALOG.filter(
      (a) => a.microFrontend && a.status === 'available',
    );
    const next: Record<string, 'ok' | 'down' | 'checking'> = {};
    for (const app of remotes) {
      next[app.microFrontend!.remoteName] = 'checking';
    }
    setRemoteHealth(next);

    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        remotes.map(async (app) => {
          const name = app.microFrontend!.remoteName;
          const port = REMOTE_PORTS[name];
          const url = port
            ? `http://localhost:${port}/remoteEntry.js`
            : app.microFrontend!.remoteEntry;
          try {
            const res = await fetch(url, { method: 'GET', mode: 'cors' });
            return [name, res.ok ? 'ok' : 'down'] as const;
          } catch {
            return [name, 'down'] as const;
          }
        }),
      );
      if (cancelled) return;
      const map: Record<string, 'ok' | 'down' | 'checking'> = {};
      for (const [name, status] of results) map[name] = status;
      setRemoteHealth(map);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const plan = session
    ? getPlanById(SUBSCRIPTION_PLANS, session.workspace.subscriptionId)
    : null;

  const enabledApps = useMemo(() => {
    if (!session) return [];
    const selected = new Set(session.workspace.selectedAppIds);
    return APP_CATALOG.filter(
      (a) => selected.has(a.id) && a.status === 'available',
    );
  }, [session]);

  return (
    <div className="devkit">
      <header className="devkit-header">
        <div>
          <p className="devkit-eyebrow">Developer toolkit</p>
          <h1>DevKit</h1>
          <p>
            {session
              ? `${session.workspace.name} · explore APIs, embeds, and webhooks`
              : 'API explorer, embed lab, webhooks, and integration logs'}
          </p>
        </div>
        {plan ? (
          <span
            className="devkit-plan"
            style={{ '--plan': plan.accent } as CSSProperties}
          >
            {plan.name}
          </span>
        ) : null}
      </header>

      <nav className="devkit-tabs" aria-label="DevKit sections">
        {(
          [
            ['overview', 'Overview'],
            ['api', 'API explorer'],
            ['embed', 'Embed lab'],
            ['webhooks', 'Webhooks'],
            ['logs', 'Logs'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'active' : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {loading ? <div className="devkit-state">Loading workspace…</div> : null}
      {error ? <div className="devkit-state error">{error}</div> : null}

      {!loading && !error && session ? (
        <>
          {tab === 'overview' ? (
            <OverviewPanel
              session={session}
              widgets={widgets}
              enabledApps={enabledApps}
              remoteHealth={remoteHealth}
              onRefresh={() => void bootstrap()}
              onOpenTab={setTab}
            />
          ) : null}
          {tab === 'api' ? (
            <ApiExplorer
              onLogged={() => refreshLogs()}
            />
          ) : null}
          {tab === 'embed' ? (
            <EmbedLab
              widgets={widgets}
              enabledApps={enabledApps}
              onLogged={() => refreshLogs()}
            />
          ) : null}
          {tab === 'webhooks' ? (
            <WebhookPlayground onLogged={() => refreshLogs()} />
          ) : null}
          {tab === 'logs' ? (
            <LogsPanel
              logs={logs}
              onClear={() => {
                clearLogs();
                refreshLogs();
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function OverviewPanel({
  session,
  widgets,
  enabledApps,
  remoteHealth,
  onRefresh,
  onOpenTab,
}: {
  session: HubSession;
  widgets: EmbedWidget[];
  enabledApps: typeof APP_CATALOG;
  remoteHealth: Record<string, 'ok' | 'down' | 'checking'>;
  onRefresh: () => void;
  onOpenTab: (tab: Tab) => void;
}) {
  const remotes = APP_CATALOG.filter(
    (a) => a.microFrontend && a.status === 'available',
  );

  return (
    <div className="devkit-stack">
      <section className="devkit-hero">
        <h2>Build against your workspace</h2>
        <p>
          Probe hub APIs with your session, exercise embed bootstrap, fire test
          webhooks, and keep a local trail of every call.
        </p>
        <div className="devkit-hero-actions">
          <button type="button" className="btn-primary" onClick={() => onOpenTab('api')}>
            Open API explorer
          </button>
          <button type="button" className="btn-ghost" onClick={onRefresh}>
            Refresh session
          </button>
        </div>
      </section>

      <div className="devkit-cards">
        <article className="devkit-card">
          <h3>Session</h3>
          <dl className="devkit-dl">
            <div>
              <dt>User</dt>
              <dd>{session.user.email}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>
                {session.workspace.name}{' '}
                <em>({session.workspace.kind})</em>
              </dd>
            </div>
            <div>
              <dt>Enabled apps</dt>
              <dd>{enabledApps.length}</dd>
            </div>
            <div>
              <dt>Embed widgets</dt>
              <dd>{widgets.length}</dd>
            </div>
          </dl>
        </article>

        <article className="devkit-card">
          <h3>Quick actions</h3>
          <ul className="devkit-actions">
            <li>
              <button type="button" onClick={() => onOpenTab('embed')}>
                Test embed bootstrap →
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onOpenTab('webhooks')}>
                Send a webhook →
              </button>
            </li>
            <li>
              <a href="/">Hub Connections (create embed keys)</a>
            </li>
            <li>
              <a href="/apps/dashboard">Dashboard connect guide</a>
            </li>
          </ul>
        </article>
      </div>

      <section className="devkit-card">
        <h3>Micro-frontend remotes</h3>
        <ul className="remote-grid">
          {remotes.map((app) => {
            const name = app.microFrontend!.remoteName;
            const status = remoteHealth[name] ?? 'checking';
            return (
              <li key={app.id}>
                <span
                  className="remote-dot"
                  style={{ background: app.color }}
                  aria-hidden
                />
                <div>
                  <strong>{app.name}</strong>
                  <code>
                    :{REMOTE_PORTS[name] ?? '?'} · {name}
                  </code>
                </div>
                <span className={`health health-${status}`}>{status}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function ApiExplorer({ onLogged }: { onLogged: () => void }) {
  const [presetId, setPresetId] = useState(API_PRESETS[0]!.id);
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [path, setPath] = useState('/api/workspace');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>('');

  function applyPreset(id: string) {
    const preset = API_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setPresetId(id);
    setMethod(preset.method);
    setPath(preset.path);
    setBody(preset.body ?? '');
  }

  async function send() {
    setBusy(true);
    try {
      const res = await runHubRequest({ method, path, body: body || undefined });
      setResult(
        [
          `${res.status} · ${res.durationMs}ms`,
          '',
          res.bodyJson != null ? formatJson(res.bodyJson) : res.bodyText || '(empty)',
        ].join('\n'),
      );
      appendLog({
        kind: 'api',
        title: `${method} ${path}`,
        detail: `HTTP ${res.status} in ${res.durationMs}ms`,
        ok: res.ok,
        status: res.status,
        durationMs: res.durationMs,
      });
      onLogged();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed';
      setResult(message);
      appendLog({
        kind: 'api',
        title: `${method} ${path}`,
        detail: message,
        ok: false,
      });
      onLogged();
    } finally {
      setBusy(false);
    }
  }

  const activeNote = API_PRESETS.find((p) => p.id === presetId)?.note;

  return (
    <div className="devkit-stack">
      <section className="devkit-card">
        <h3>Presets</h3>
        <div className="preset-row">
          {API_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={presetId === p.id ? 'chip active' : 'chip'}
              onClick={() => applyPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {activeNote ? <p className="hint">{activeNote}</p> : null}
      </section>

      <section className="devkit-card">
        <h3>Request</h3>
        <div className="req-row">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as HttpMethod)}
            aria-label="HTTP method"
          >
            {(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            aria-label="Path"
            placeholder="/api/…"
          />
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void send()}
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
        {method !== 'GET' ? (
          <label className="block-label">
            Body (JSON)
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              spellCheck={false}
            />
          </label>
        ) : null}
      </section>

      <section className="devkit-card">
        <h3>Response</h3>
        <pre className="code-block">{result || 'Send a request to see the response.'}</pre>
      </section>
    </div>
  );
}

function EmbedLab({
  widgets,
  enabledApps,
  onLogged,
}: {
  widgets: EmbedWidget[];
  enabledApps: typeof APP_CATALOG;
  onLogged: () => void;
}) {
  const [key, setKey] = useState('');
  const [origin, setOrigin] = useState(
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
  );
  const [appSlug, setAppSlug] = useState(enabledApps[0]?.slug ?? 'notes');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  async function runBootstrap() {
    setBusy(true);
    try {
      const res = await fetch('/api/embed/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, origin, app: appSlug }),
      });
      const data = await res.json();
      setResult(formatJson(data));
      appendLog({
        kind: 'embed',
        title: `Bootstrap ${appSlug}`,
        detail: res.ok
          ? `Token issued for ${origin}`
          : (data.error as string) || `HTTP ${res.status}`,
        ok: res.ok,
        status: res.status,
      });
      onLogged();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bootstrap failed';
      setResult(message);
      appendLog({
        kind: 'embed',
        title: `Bootstrap ${appSlug}`,
        detail: message,
        ok: false,
      });
      onLogged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="devkit-stack">
      <section className="devkit-card">
        <h3>Your embed widgets</h3>
        {widgets.length === 0 ? (
          <p className="hint">
            No widgets yet. Create one in Hub → Connections → Embed widgets, then
            paste the key here to test bootstrap.
          </p>
        ) : (
          <ul className="widget-list">
            {widgets.map((w) => (
              <li key={w.id}>
                <strong>{w.name}</strong>
                <span>
                  {w.keyHint} · {w.allowedOrigins.join(', ')}
                </span>
                <em>
                  {w.enabledAppIds
                    .map((id) => APP_CATALOG.find((a) => a.id === id)?.slug ?? id)
                    .join(', ')}
                </em>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="devkit-card">
        <h3>Bootstrap trial</h3>
        <p className="hint">
          Same call <code>embed.js</code> makes from your product. Origin must be
          on the widget allowlist.
        </p>
        <div className="form-grid">
          <label>
            Embed API key
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk_embed_…"
              autoComplete="off"
            />
          </label>
          <label>
            Parent origin
            <input
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="https://app.example.com"
            />
          </label>
          <label>
            App slug
            <select
              value={appSlug}
              onChange={(e) => setAppSlug(e.target.value)}
            >
              {(enabledApps.length > 0
                ? enabledApps
                : APP_CATALOG.filter((a) => a.microFrontend)
              ).map((a) => (
                <option key={a.id} value={a.slug}>
                  {a.name} ({a.slug})
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !key.trim()}
          onClick={() => void runBootstrap()}
        >
          {busy ? 'Calling…' : 'POST /api/embed/bootstrap'}
        </button>
      </section>

      <section className="devkit-card">
        <h3>Result</h3>
        <pre className="code-block">
          {result || 'Run bootstrap to see token + embedUrl.'}
        </pre>
      </section>
    </div>
  );
}

function WebhookPlayground({ onLogged }: { onLogged: () => void }) {
  const [url, setUrl] = useState('https://httpbin.org/post');
  const [event, setEvent] = useState('sorye.task.updated');
  const [payload, setPayload] = useState(
    JSON.stringify(
      {
        event: 'sorye.task.updated',
        workspaceId: 'ws_demo',
        data: { taskId: 'task_1', title: 'Ship DevKit', status: 'done' },
        sentAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  async function send() {
    setBusy(true);
    const started = performance.now();
    try {
      let bodyObj: unknown = payload;
      try {
        bodyObj = JSON.parse(payload);
      } catch {
        /* keep string */
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sorye-Event': event,
          'User-Agent': 'Sorye-DevKit/1.0',
        },
        body: typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj),
      });
      const durationMs = Math.round(performance.now() - started);
      const text = await res.text();
      let pretty = text;
      try {
        pretty = formatJson(JSON.parse(text));
      } catch {
        /* raw */
      }
      setResult(`${res.status} · ${durationMs}ms\n\n${pretty}`);
      appendLog({
        kind: 'webhook',
        title: `Webhook ${event}`,
        detail: `${url} → HTTP ${res.status}`,
        ok: res.ok,
        status: res.status,
        durationMs,
      });
      onLogged();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Webhook failed';
      setResult(message);
      appendLog({
        kind: 'webhook',
        title: `Webhook ${event}`,
        detail: message,
        ok: false,
      });
      onLogged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="devkit-stack">
      <section className="devkit-card">
        <h3>Outbound webhook simulator</h3>
        <p className="hint">
          Fire a test payload at any URL (httpbin, webhook.site, your staging
          endpoint). Useful while wiring Relay or custom integrations.
        </p>
        <div className="form-grid">
          <label className="span-2">
            Destination URL
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </label>
          <label>
            Event name
            <input
              value={event}
              onChange={(e) => setEvent(e.target.value)}
            />
          </label>
        </div>
        <label className="block-label">
          JSON payload
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            rows={12}
            spellCheck={false}
          />
        </label>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !url.trim()}
          onClick={() => void send()}
        >
          {busy ? 'Sending…' : 'Send webhook'}
        </button>
      </section>

      <section className="devkit-card">
        <h3>Response</h3>
        <pre className="code-block">{result || 'No delivery yet.'}</pre>
      </section>
    </div>
  );
}

function LogsPanel({
  logs,
  onClear,
}: {
  logs: DevkitLogEntry[];
  onClear: () => void;
}) {
  return (
    <div className="devkit-stack">
      <section className="devkit-card">
        <div className="logs-head">
          <h3>Integration logs</h3>
          <button type="button" className="btn-ghost" onClick={onClear}>
            Clear
          </button>
        </div>
        {logs.length === 0 ? (
          <p className="hint">No entries yet. Calls from API, Embed, and Webhooks appear here.</p>
        ) : (
          <ul className="log-list">
            {logs.map((entry) => (
              <li key={entry.id} className={entry.ok ? 'ok' : 'bad'}>
                <div>
                  <strong>{entry.title}</strong>
                  <span>{entry.detail}</span>
                </div>
                <div className="log-meta">
                  <em>{entry.kind}</em>
                  <time>
                    {new Date(entry.at).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
