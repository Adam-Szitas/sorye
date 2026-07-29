import { useCallback, useEffect, useState } from 'react';
import type { HubSession, WorkspaceStorageInfo } from '@sorye/types';

interface DatabaseGuideProps {
  session: HubSession;
  storage: WorkspaceStorageInfo | null;
  onStorageChange: (storage: WorkspaceStorageInfo) => void;
}

const STEPS = [
  {
    title: 'Provision PostgreSQL',
    body: 'Use Neon, Supabase, RDS, or any Postgres 14+ host. You need a connection string with create-table permissions.',
  },
  {
    title: 'Apply the Sorye schema',
    body: 'From the Sorye repo, run db:push against your database so Canvas and Messenger tables exist before you connect.',
  },
  {
    title: 'Paste and test',
    body: 'Enter your postgres:// or postgresql:// URL below. We test the connection, encrypt the secret server-side, and store only host/database hints in your workspace.',
  },
  {
    title: 'Fallback stays safe',
    body: 'If you skip this step, or your database becomes unreachable, Sorye falls back to the hub default storage — the same json or postgres driver this deployment already uses.',
  },
] as const;

const APPS_ON_WORKSPACE_DB = ['Canvas', 'Messenger'] as const;

function statusLabel(storage: WorkspaceStorageInfo | null): string {
  if (!storage || storage.driver === 'default') {
    return 'Using hub default';
  }
  if (storage.status === 'connected') return 'Connected';
  if (storage.status === 'error') return 'Error — using fallback';
  return storage.status;
}

function statusClass(storage: WorkspaceStorageInfo | null): string {
  if (!storage || storage.driver === 'default') return 'db-status-default';
  if (storage.status === 'connected') return 'db-status-ok';
  return 'db-status-error';
}

export function DatabaseGuide({
  session,
  storage,
  onStorageChange,
}: DatabaseGuideProps) {
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | 'reset' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hubDefault = storage?.hubDefaultDriver ?? 'json';

  const refreshStorage = useCallback(async () => {
    const res = await fetch('/api/workspace/storage', { credentials: 'include' });
    if (!res.ok) return;
    const data = (await res.json()) as { storage: WorkspaceStorageInfo };
    onStorageChange(data.storage);
  }, [onStorageChange]);

  useEffect(() => {
    if (!storage) void refreshStorage();
  }, [storage, refreshStorage]);

  async function testConnection() {
    if (!databaseUrl.trim()) {
      setError('Enter a connection string first.');
      return;
    }
    setBusy('test');
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/workspace/storage', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', databaseUrl }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Connection test failed.');
        return;
      }
      setMessage('Connection successful. Save to use this database for the workspace.');
    } catch {
      setError('Could not reach the Hub API.');
    } finally {
      setBusy(null);
    }
  }

  async function saveConnection() {
    if (!databaseUrl.trim()) {
      setError('Enter a connection string first.');
      return;
    }
    setBusy('save');
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/workspace/storage', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseUrl }),
      });
      const data = (await res.json()) as {
        storage?: WorkspaceStorageInfo;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? 'Could not save database URL.');
        return;
      }
      if (data.storage) onStorageChange(data.storage);
      setDatabaseUrl('');
      setMessage('Workspace database saved. Canvas and Messenger will use it.');
    } catch {
      setError('Could not reach the Hub API.');
    } finally {
      setBusy(null);
    }
  }

  async function resetToDefault() {
    setBusy('reset');
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/workspace/storage', {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await res.json()) as { storage?: WorkspaceStorageInfo };
      if (!res.ok) {
        setError('Could not reset storage.');
        return;
      }
      if (data.storage) onStorageChange(data.storage);
      setDatabaseUrl('');
      setMessage('Reset to hub default storage.');
    } catch {
      setError('Could not reach the Hub API.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="embed-guide db-guide" aria-labelledby="db-guide-title">
      <div className="embed-guide-hero">
        <p className="embed-guide-eyebrow">Your data, your database</p>
        <h2 id="db-guide-title">Workspace database</h2>
        <p>
          Point <strong>{session.workspace.name}</strong> at your own PostgreSQL
          for team apps that sync through the Hub. Leave unset to keep the hub
          default ({hubDefault === 'postgres' ? 'PostgreSQL' : 'local JSON'}).
        </p>
      </div>

      <div className={`db-status-banner ${statusClass(storage)}`}>
        <div>
          <strong>{statusLabel(storage)}</strong>
          {storage?.driver === 'postgres' && storage.hostHint ? (
            <span>
              {storage.hostHint}
              {storage.databaseHint ? ` / ${storage.databaseHint}` : ''}
            </span>
          ) : (
            <span>
              Hub default: {hubDefault === 'postgres' ? 'PostgreSQL' : 'JSON file store'}
            </span>
          )}
        </div>
        {storage?.lastError ? (
          <p className="db-status-error-text">{storage.lastError}</p>
        ) : null}
      </div>

      <ol className="embed-steps">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="embed-step-num" aria-hidden>
              {index + 1}
            </span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="embed-guide-grid">
        <article className="embed-card">
          <h3>Apps on workspace DB</h3>
          <ul className="embed-app-list">
            {APPS_ON_WORKSPACE_DB.map((name) => (
              <li key={name}>
                <span className="embed-app db-app-row">
                  <span className="embed-app-dot" style={{ background: '#38bdf8' }} />
                  {name}
                </span>
              </li>
            ))}
          </ul>
          <p className="embed-muted embed-card-foot">
            Notes, Tasks, and Calendar still use browser storage on each device.
          </p>
        </article>

        <article className="embed-card">
          <h3>Schema command</h3>
          <p className="embed-muted">
            Run once against your database before saving the URL:
          </p>
          <pre className="db-cli">
            <code>{`DATABASE_URL="postgres://..." pnpm db:push`}</code>
          </pre>
          <p className="embed-muted embed-card-foot">
            Creates <code>canvas_boards</code>, <code>messenger_channels</code>,{' '}
            <code>messenger_messages</code>, and related tables.
          </p>
        </article>
      </div>

      <article className="embed-snippet-card db-form-card">
        <h3>Connection string</h3>
        <p className="embed-muted">
          Never shared back to the browser after save. Only encrypted on the
          server using <code>AUTH_SECRET</code>.
        </p>
        <label className="db-field">
          <span>PostgreSQL URL</span>
          <input
            type="password"
            name="databaseUrl"
            autoComplete="off"
            placeholder="postgresql://user:pass@host:5432/mydb"
            value={databaseUrl}
            onChange={(e) => setDatabaseUrl(e.target.value)}
            disabled={busy !== null}
          />
        </label>
        <div className="db-actions">
          <button
            type="button"
            className="embed-copy"
            onClick={() => void testConnection()}
            disabled={busy !== null}
          >
            {busy === 'test' ? 'Testing…' : 'Test connection'}
          </button>
          <button
            type="button"
            className="embed-copy db-save"
            onClick={() => void saveConnection()}
            disabled={busy !== null}
          >
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
          {storage?.driver === 'postgres' ? (
            <button
              type="button"
              className="db-reset"
              onClick={() => void resetToDefault()}
              disabled={busy !== null}
            >
              {busy === 'reset' ? 'Resetting…' : 'Use hub default'}
            </button>
          ) : null}
        </div>
        {message ? <p className="db-message">{message}</p> : null}
        {error ? <p className="db-error">{error}</p> : null}
      </article>

      <aside className="embed-notes">
        <h3>How fallback works</h3>
        <ul>
          <li>
            <strong>No URL configured</strong> — Canvas and Messenger read/write
            via the hub&apos;s {hubDefault} store
          </li>
          <li>
            <strong>URL saved</strong> — those apps use your Postgres; hub
            metadata (users, billing, embed keys) stays on the hub database
          </li>
          <li>
            <strong>Connection errors</strong> — requests fall back to the hub
            default automatically and the status shows an error here
          </li>
        </ul>
      </aside>
    </section>
  );
}
