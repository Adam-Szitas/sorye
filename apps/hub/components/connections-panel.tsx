'use client';

import {
  APP_CATALOG,
  type ConnectedApp,
  type EmbedWidget,
  type EmbedWidgetCreated,
  type SubscriptionPlan,
} from '@sorye/types';
import { canAddConnection } from '@sorye/types';
import { useCallback, useEffect, useState } from 'react';

interface ConnectionsPanelProps {
  connections: ConnectedApp[];
  selectedAppIds: string[];
  plan: SubscriptionPlan;
  onAdd: (connection: Omit<ConnectedApp, 'id' | 'connectedAt' | 'status'>) => void;
  onRemove: (connectionId: string) => void;
  onClose: () => void;
}

type Tab = 'outbound' | 'embed';

export function ConnectionsPanel({
  connections,
  selectedAppIds,
  plan,
  onAdd,
  onRemove,
  onClose,
}: ConnectionsPanelProps) {
  const [tab, setTab] = useState<Tab>('embed');
  const [hubOrigin, setHubOrigin] = useState('');
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const canAdd = canAddConnection(plan, connections.length);

  const [widgets, setWidgets] = useState<EmbedWidget[]>([]);
  const [widgetsLoading, setWidgetsLoading] = useState(true);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<EmbedWidgetCreated | null>(null);

  const [embedName, setEmbedName] = useState('');
  const [embedOrigins, setEmbedOrigins] = useState('http://localhost:5173');
  const [embedAppIds, setEmbedAppIds] = useState<string[]>(selectedAppIds);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setHubOrigin(window.location.origin);
  }, []);

  const loadWidgets = useCallback(async () => {
    setWidgetsLoading(true);
    setWidgetError(null);
    try {
      const res = await fetch('/api/embed/widgets');
      if (!res.ok) throw new Error('Failed to load embed widgets');
      const data = (await res.json()) as { widgets: EmbedWidget[] };
      setWidgets(data.widgets);
    } catch (err) {
      setWidgetError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setWidgetsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWidgets();
  }, [loadWidgets]);

  useEffect(() => {
    setEmbedAppIds((prev) => {
      const next = prev.filter((id) => selectedAppIds.includes(id));
      return next.length > 0 ? next : [...selectedAppIds];
    });
  }, [selectedAppIds]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !endpoint.trim() || !apiKey.trim()) return;

    onAdd({
      name: name.trim(),
      endpoint: endpoint.trim(),
      apiKeyHint: `••••${apiKey.slice(-4)}`,
      scopes: ['read', 'write'],
    });

    setName('');
    setEndpoint('');
    setApiKey('');
  }

  async function handleCreateEmbed(e: React.FormEvent) {
    e.preventDefault();
    if (!embedName.trim() || embedAppIds.length === 0) return;
    setCreating(true);
    setWidgetError(null);
    try {
      const origins = embedOrigins
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch('/api/embed/widgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: embedName.trim(),
          allowedOrigins: origins,
          enabledAppIds: embedAppIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Create failed');
      setCreatedKey(data.widget as EmbedWidgetCreated);
      setEmbedName('');
      await loadWidgets();
    } catch (err) {
      setWidgetError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!window.confirm('Revoke this embed key? Existing iframes will stop working.')) {
      return;
    }
    const res = await fetch(`/api/embed/widgets?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.ok) await loadWidgets();
  }

  const availableApps = APP_CATALOG.filter(
    (a) =>
      a.status === 'available' &&
      a.microFrontend &&
      selectedAppIds.includes(a.id),
  );

  const snippetApp = availableApps[0]?.slug ?? 'notes';

  return (
    <section className="mx-auto w-full max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Connections</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Embed Sorye apps in your product, or link outbound APIs
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-sm text-[var(--color-text-muted)] transition hover:bg-white/10"
        >
          Done
        </button>
      </div>

      <div className="mb-6 flex gap-2">
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm ${
            tab === 'embed' ? 'bg-white/15 text-white' : 'text-[var(--color-text-muted)] hover:bg-white/10'
          }`}
          onClick={() => setTab('embed')}
        >
          Embed widgets
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm ${
            tab === 'outbound' ? 'bg-white/15 text-white' : 'text-[var(--color-text-muted)] hover:bg-white/10'
          }`}
          onClick={() => setTab('outbound')}
        >
          Outbound APIs
        </button>
      </div>

      {tab === 'embed' ? (
        <div className="space-y-8">
          <p className="text-sm text-[var(--color-text-muted)]">
            Create an embed key for your own app. Only apps enabled in your hub
            App Library can be hosted. Whitelist your site origin so the iframe
            only works there.
          </p>

          {widgetError ? (
            <p className="text-sm text-red-400">{widgetError}</p>
          ) : null}

          {createdKey ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
              <p className="font-medium text-emerald-300">
                Save this key — it won&apos;t be shown again
              </p>
              <code className="mt-2 block break-all rounded-lg bg-black/30 p-3 text-xs text-emerald-100">
                {createdKey.apiKey}
              </code>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-black/40 p-3 text-[11px] leading-relaxed text-slate-300">{`<!-- In your app -->
<script src="${hubOrigin}/embed.js"></script>
<div id="sorye-app" style="height:640px"></div>
<script>
  SoryeEmbed.mount('#sorye-app', {
    app: '${snippetApp}',
    key: '${createdKey.apiKey}'
  });
</script>`}</pre>
              <button
                type="button"
                className="mt-3 text-xs text-emerald-300 underline"
                onClick={() => setCreatedKey(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          <ul className="space-y-3">
            {widgetsLoading ? (
              <li className="text-sm text-[var(--color-text-muted)]">Loading…</li>
            ) : null}
            {widgets.map((w) => (
              <li
                key={w.id}
                className="surface flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{w.name}</div>
                  <p className="truncate text-xs text-[var(--color-text-muted)]">
                    key {w.keyHint} · {w.allowedOrigins.join(', ')}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    Apps:{' '}
                    {w.enabledAppIds
                      .map(
                        (id) =>
                          APP_CATALOG.find((a) => a.id === id)?.name ?? id,
                      )
                      .join(', ')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRevoke(w.id)}
                  className="rounded-lg px-3 py-1.5 text-xs text-red-400 transition hover:bg-red-500/10"
                >
                  Revoke
                </button>
              </li>
            ))}
            {!widgetsLoading && widgets.length === 0 ? (
              <li className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-[var(--color-text-muted)]">
                No embed widgets yet. Create one to iframe your enabled Sorye
                apps.
              </li>
            ) : null}
          </ul>

          {availableApps.length === 0 ? (
            <p className="text-sm text-amber-400">
              Enable at least one app in the App Library before creating an
              embed widget.
            </p>
          ) : (
            <form
              onSubmit={(e) => void handleCreateEmbed(e)}
              className="surface rounded-2xl p-6"
            >
              <h3 className="mb-4 font-medium">New embed widget</h3>
              <div className="grid gap-4">
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--color-text-muted)]">
                    Name
                  </span>
                  <input
                    value={embedName}
                    onChange={(e) => setEmbedName(e.target.value)}
                    placeholder="My product"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--color-text-muted)]">
                    Allowed origins (comma or newline separated)
                  </span>
                  <textarea
                    value={embedOrigins}
                    onChange={(e) => setEmbedOrigins(e.target.value)}
                    rows={2}
                    placeholder="https://app.example.com"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
                <fieldset>
                  <legend className="mb-2 text-xs text-[var(--color-text-muted)]">
                    Apps this key may embed (from your hub whitelist)
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {availableApps.map((app) => {
                      const on = embedAppIds.includes(app.id);
                      return (
                        <button
                          key={app.id}
                          type="button"
                          onClick={() =>
                            setEmbedAppIds((ids) =>
                              on
                                ? ids.filter((id) => id !== app.id)
                                : [...ids, app.id],
                            )
                          }
                          className={`rounded-full px-3 py-1 text-xs ${
                            on
                              ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                              : 'bg-white/5 text-[var(--color-text-muted)]'
                          }`}
                        >
                          {app.name}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </div>
              <button
                type="submit"
                disabled={creating}
                className="mt-4 rounded-xl px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
                style={{ background: plan.accent }}
              >
                {creating ? 'Creating…' : 'Create embed key'}
              </button>
            </form>
          )}
        </div>
      ) : (
        <>
          <ul className="mb-8 space-y-3">
            {connections.map((conn) => (
              <li
                key={conn.id}
                className="surface flex items-center gap-4 rounded-xl p-4"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      d="M10 13a5 5 0 0 1 7 0M14 11V7a2 2 0 0 1 4 0v1M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{conn.name}</span>
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] uppercase text-emerald-400">
                      {conn.status}
                    </span>
                  </div>
                  <p className="truncate text-xs text-[var(--color-text-muted)]">
                    {conn.endpoint} · key {conn.apiKeyHint}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(conn.id)}
                  className="rounded-lg px-3 py-1.5 text-xs text-red-400 transition hover:bg-red-500/10"
                >
                  Remove
                </button>
              </li>
            ))}

            {connections.length === 0 && (
              <li className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-[var(--color-text-muted)]">
                No outbound connections yet. Add an API endpoint to bridge your
                tools.
              </li>
            )}
          </ul>

          {canAdd ? (
            <form onSubmit={handleSubmit} className="surface rounded-2xl p-6">
              <h3 className="mb-4 font-medium">Add connection</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--color-text-muted)]">
                    App name
                  </span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My CRM"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--color-text-muted)]">
                    API endpoint
                  </span>
                  <input
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs text-[var(--color-text-muted)]">
                    API key
                  </span>
                  <input
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    type="password"
                    placeholder="sk-..."
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
              </div>
              <button
                type="submit"
                className="mt-4 rounded-xl px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
                style={{ background: plan.accent }}
              >
                Connect app
              </button>
            </form>
          ) : (
            <p className="text-center text-sm text-amber-400">
              Connection limit reached ({plan.maxConnections}). Upgrade your
              plan to add more.
            </p>
          )}
        </>
      )}
    </section>
  );
}
