'use client';

import { useI18n } from '@sorye/platform/react';
import { API_KEY_APPS, API_KEY_MAX_PER_WORKSPACE, type ApiKeyCreated, type ApiKeyScope, type ApiKeySummary } from '@sorye/types';
import { useCallback, useEffect, useId, useState } from 'react';

const APP_NAME: Record<(typeof API_KEY_APPS)[number], string> = { tasks: 'Tasks', notes: 'Notes', calendar: 'Calendar', forms: 'Forms' };
const INPUT =
  'mt-1 w-full min-h-11 rounded-lg border border-white/12 bg-black/25 px-3 py-2 text-base outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]';
const GHOST = 'min-h-11 rounded-lg px-3 text-sm text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)] disabled:opacity-40';
const PRIMARY = 'min-h-11 rounded-lg bg-[var(--color-accent)] px-4 text-sm font-medium text-black disabled:opacity-40';

type Load = 'loading' | 'ready' | 'owner_required' | 'error';

/**
 * Setup screen for Rodrigo's public API: create, list and revoke workspace keys.
 * After a key exists the caller talks to Rodrigo directly; Hub is not in that path.
 */
export function ApiKeysPanel() {
  const { t, locale } = useI18n();
  const uid = useId();
  const [load, setLoad] = useState<Load>('loading');
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/backend/api-keys', { credentials: 'include', cache: 'no-store' });
      const data = (await response.json().catch(() => ({}))) as { keys?: ApiKeySummary[]; apiBaseUrl?: string | null; error?: { code?: string } };
      if (response.status === 403 && data.error?.code === 'owner_required') { setLoad('owner_required'); return; }
      if (!response.ok || !Array.isArray(data.keys)) { setLoad('error'); return; }
      setKeys(data.keys);
      setApiBaseUrl(data.apiBaseUrl ?? null);
      setLoad('ready');
    } catch {
      setLoad('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function toggle(scope: ApiKeyScope) {
    setScopes((current) => (current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]));
  }

  async function create() {
    if (busy) return;
    setError(null);
    if (scopes.length === 0) { setError(t('apikeys.chooseScope')); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/backend/api-keys', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes }),
      });
      const data = (await response.json().catch(() => ({}))) as { key?: ApiKeyCreated; error?: { code?: string } };
      if (response.ok && data.key) {
        setCreated(data.key);
        setCopied(false);
        setName('');
        setScopes([]);
        await refresh();
      } else {
        setError(data.error?.code === 'api_key_limit_reached' ? t('apikeys.limitReached', { max: API_KEY_MAX_PER_WORKSPACE }) : t('apikeys.createFailed'));
      }
    } catch {
      setError(t('apikeys.createFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(keyId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/backend/api-keys/${encodeURIComponent(keyId)}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) setError(t('apikeys.revokeFailed'));
      setConfirmId(null);
      await refresh();
    } catch {
      setError(t('apikeys.revokeFailed'));
    } finally {
      setBusy(false);
    }
  }

  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });

  if (load !== 'ready') {
    const text = load === 'loading' ? t('apikeys.loading') : load === 'owner_required' ? t('apikeys.ownerOnly') : t('apikeys.loadFailed');
    return <p className="text-sm text-[var(--color-text-muted)]" role={load === 'error' ? 'alert' : 'status'}>{text}</p>;
  }

  const base = apiBaseUrl ?? 'https://<api-address>';
  return (
    <div className="space-y-8" lang={locale}>
      <p className="text-sm text-[var(--color-text-muted)]">{t('apikeys.intro')}</p>

      <div className="rounded-xl border border-white/10 p-4 text-sm">
        <p className="font-medium">{t('apikeys.baseUrl')}</p>
        {apiBaseUrl ? <code className="mt-1 block break-all">{apiBaseUrl}/api/v1</code> : <p className="mt-1 text-amber-300">{t('apikeys.baseUrlMissing')}</p>}
        <p className="mt-3 font-medium">{t('apikeys.example')}</p>
        <pre className="mt-1 overflow-x-auto rounded-lg bg-black/40 p-3 text-xs"><code>{`curl -s ${base}/api/v1/me \\\n  -H "Authorization: Bearer $SORYE_KEY"`}</code></pre>
      </div>

      {created ? (
        <div className="rounded-xl border border-emerald-400/40 bg-emerald-400/5 p-4" role="alert">
          <p className="font-medium">{t('apikeys.createdTitle')}</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('apikeys.createdHint')}</p>
          <code className="mt-3 block break-all rounded-lg bg-black/40 p-3 text-xs">{created.token}</code>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button" className={PRIMARY}
              onClick={() => { void navigator.clipboard?.writeText(created.token).then(() => setCopied(true)).catch(() => undefined); }}
            >
              {copied ? t('apikeys.copied') : t('apikeys.copy')}
            </button>
            <button type="button" className={GHOST} onClick={() => setCreated(null)}>{t('apikeys.done')}</button>
          </div>
        </div>
      ) : null}

      <ul className="flex flex-col gap-3">
        {keys.length === 0 ? <li className="text-sm text-[var(--color-text-muted)]">{t('apikeys.none')}</li> : null}
        {keys.map((key) => (
          <li key={key.keyId} className={`rounded-xl border border-white/10 p-3 text-sm ${key.revokedAt ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto min-w-0 font-medium"><span className="break-words">{key.name}</span> <code className="text-xs text-[var(--color-text-muted)]">rk_live_{key.keyId}_…</code></p>
              {!key.revokedAt && confirmId !== key.keyId ? (
                <button type="button" className={`${GHOST} text-red-300`} disabled={busy} onClick={() => setConfirmId(key.keyId)}>{t('apikeys.revoke')}</button>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{key.scopes.join(' · ')}</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {t('apikeys.created', { when: when(key.createdAt) })}
              {' · '}
              {key.revokedAt ? t('apikeys.revoked', { when: when(key.revokedAt) }) : key.lastUsedAt ? t('apikeys.lastUsed', { when: when(key.lastUsedAt) }) : t('apikeys.neverUsed')}
            </p>
            {confirmId === key.keyId ? (
              <div className="mt-2 rounded-lg border border-red-400/30 p-3" role="alert">
                <p>{t('apikeys.revokeConfirm', { name: key.name })}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" className={`${GHOST} text-red-300`} disabled={busy} onClick={() => void revoke(key.keyId)}>{t('apikeys.revokeYes')}</button>
                  <button type="button" className={GHOST} autoFocus onClick={() => setConfirmId(null)}>{t('cancel')}</button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <form className="rounded-xl border border-white/10 p-4" onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <h3 className="font-medium">{t('apikeys.newKey')}</h3>
        <label className="mt-3 block text-sm font-medium" htmlFor={`${uid}-name`}>{t('apikeys.name')}</label>
        <input id={`${uid}-name`} className={INPUT} type="text" required maxLength={80} autoComplete="off" placeholder={t('apikeys.namePlaceholder')} value={name} onChange={(event) => setName(event.target.value)} />
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">{t('apikeys.scopes')}</legend>
          <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {API_KEY_APPS.map((app) => (
              <div key={app} className="flex flex-wrap items-center gap-x-4">
                <span className="w-20 text-sm">{APP_NAME[app]}</span>
                {(['read', 'write'] as const).map((access) => {
                  const scope: ApiKeyScope = `${app}:${access}`;
                  return (
                    <label key={scope} className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox" className="size-5" checked={scopes.includes(scope)} onChange={() => toggle(scope)}
                        aria-label={`${APP_NAME[app]}: ${t(access === 'read' ? 'apikeys.read' : 'apikeys.write')}`}
                      />
                      <span aria-hidden="true">{t(access === 'read' ? 'apikeys.read' : 'apikeys.write')}</span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </fieldset>
        {error ? <p className="mt-3 text-sm text-red-300" role="alert">{error}</p> : null}
        <button type="submit" className={`${PRIMARY} mt-4`} disabled={busy}>{busy ? t('apikeys.creating') : t('apikeys.create')}</button>
      </form>
    </div>
  );
}
