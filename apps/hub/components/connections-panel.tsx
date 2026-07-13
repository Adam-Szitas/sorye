'use client';

import type { ConnectedApp, SubscriptionPlan } from '@sorye/types';
import { canAddConnection } from '@sorye/types';
import { useState } from 'react';

interface ConnectionsPanelProps {
  connections: ConnectedApp[];
  plan: SubscriptionPlan;
  onAdd: (connection: Omit<ConnectedApp, 'id' | 'connectedAt' | 'status'>) => void;
  onRemove: (connectionId: string) => void;
  onClose: () => void;
}

export function ConnectionsPanel({
  connections,
  plan,
  onAdd,
  onRemove,
  onClose,
}: ConnectionsPanelProps) {
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const canAdd = canAddConnection(plan, connections.length);

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

  return (
    <section className="mx-auto w-full max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Connected Apps</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Link external services so your Sorye apps can read and write data
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

      <ul className="mb-8 space-y-3">
        {connections.map((conn) => (
          <li
            key={conn.id}
            className="surface flex items-center gap-4 rounded-xl p-4"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 0 1 7 0M14 11V7a2 2 0 0 1 4 0v1M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" strokeLinecap="round" />
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
            No connections yet. Add an API endpoint to bridge your tools.
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
          Connection limit reached ({plan.maxConnections}). Upgrade your plan to
          add more.
        </p>
      )}
    </section>
  );
}
