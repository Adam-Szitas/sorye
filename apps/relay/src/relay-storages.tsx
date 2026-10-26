import { useCallback, useEffect, useState } from 'react';
import type { CloudStorageConnection, CloudStorageProvider } from '@sorye/types';
import { broadcastRelayUpdated } from './relay-storage';

interface StorageSnapshot {
  storages: CloudStorageConnection[];
  canManage: boolean;
  available: boolean;
}

const emptyForm = {
  provider: 'aws-s3' as CloudStorageProvider,
  name: '', bucket: '', region: 'us-east-1', accountId: '',
  accessKeyId: '', secretAccessKey: '',
};

export function RelayStorages() {
  const [snapshot, setSnapshot] = useState<StorageSnapshot | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; accessKeyId: string; secretAccessKey: string } | null>(null);
  const [rotating, setRotating] = useState<string | null>(null);
  const [rotation, setRotation] = useState({ accessKeyId: '', secretAccessKey: '' });

  const refresh = useCallback(async () => {
    const response = await fetch('/api/relay/storages', { credentials: 'include', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load connected storage.');
    setSnapshot(data as StorageSnapshot);
  }, []);

  useEffect(() => {
    void refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load connected storage.'));
  }, [refresh]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch('/api/relay/storages', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not connect storage.');
      setForm(emptyForm); setShowForm(false); setNotice('Storage connected. It is now available as a folder in Drive.');
      broadcastRelayUpdated();
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not connect storage.'); }
    finally { setBusy(false); }
  }

  async function reveal(id: string) {
    setError(null); setRevealed(null);
    try {
      const response = await fetch(`/api/relay/storages/${encodeURIComponent(id)}/secret`, { credentials: 'include', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not reveal credentials.');
      setRevealed({ id, ...data });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not reveal credentials.'); }
  }

  async function remove(storage: CloudStorageConnection) {
    if (!window.confirm(`Remove the “${storage.name}” connection? Cloud files will remain in the provider bucket.`)) return;
    setBusy(true); setError(null); setRevealed(null);
    try {
      const response = await fetch(`/api/relay/storages/${encodeURIComponent(storage.id)}`, { method: 'DELETE', credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not remove storage.');
      setNotice('Storage connection removed. Files in the provider bucket were not deleted.');
      broadcastRelayUpdated();
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not remove storage.'); }
    finally { setBusy(false); }
  }

  async function rotate(id: string) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/relay/storages/${encodeURIComponent(id)}`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rotation),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not rotate credentials.');
      setRotation({ accessKeyId: '', secretAccessKey: '' }); setRotating(null); setRevealed(null);
      setNotice('Credentials updated after the new key was verified.');
      broadcastRelayUpdated();
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not rotate credentials.'); }
    finally { setBusy(false); }
  }

  if (!snapshot) return <section className="relay-panel"><h2>Connected storage</h2><p className="relay-panel-hint">Loading connected folders…</p></section>;

  return (
    <section className="relay-panel">
      <div className="storage-heading">
        <div><h2>Connected storage</h2><p className="relay-panel-hint">Cloud folders are private to this workspace and appear in Drive.</p></div>
        {snapshot.canManage ? <button type="button" className="btn-primary btn-sm" disabled={!snapshot.available} title={!snapshot.available ? 'The Hub host must set STORAGE_SECRET_KEY first.' : undefined} onClick={() => { setShowForm((value) => !value); setError(null); }}>＋ Connect storage</button> : null}
      </div>
      {snapshot.canManage && !snapshot.available ? <p className="storage-message">Cloud storage needs one-time Hub setup. Ask your deployment admin to add STORAGE_SECRET_KEY to the host's secret manager.</p> : null}
      {error ? <p className="storage-message error" role="alert">{error}</p> : null}
      {notice ? <p className="storage-message" role="status">{notice}</p> : null}
      {snapshot.storages.length ? <ul className="storage-list">{snapshot.storages.map((storage) => (
        <li key={storage.id} className="storage-card">
          <div className="storage-card-top"><div><strong>{storage.name}</strong><p>{storage.provider === 'aws-s3' ? 'Amazon S3' : 'Cloudflare R2'} · {storage.bucket}{storage.region !== 'auto' ? ` · ${storage.region}` : ''}</p></div><span className="storage-connected">Connected</span></div>
          {snapshot.canManage ? <div className="storage-actions">
            <button type="button" className="btn-ghost btn-sm" onClick={() => void reveal(storage.id)}>Show credentials</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setRotating(rotating === storage.id ? null : storage.id); setRotation({ accessKeyId: '', secretAccessKey: '' }); }}>Replace credentials</button>
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void remove(storage)}>Remove</button>
          </div> : <p className="field-hint">Access key ending in {storage.accessKeyHint}</p>}
          {rotating === storage.id ? <form className="storage-form" onSubmit={(event) => { event.preventDefault(); void rotate(storage.id); }}>
            <label className="field">New access key ID<input autoComplete="off" required value={rotation.accessKeyId} onChange={(event) => setRotation({ ...rotation, accessKeyId: event.target.value })} /></label>
            <label className="field">New secret access key<input type="password" autoComplete="new-password" required value={rotation.secretAccessKey} onChange={(event) => setRotation({ ...rotation, secretAccessKey: event.target.value })} /></label>
            <button className="btn-primary btn-sm" disabled={busy}>Verify and replace</button>
          </form> : null}
          {revealed?.id === storage.id ? <div className="storage-secret" role="status">
            <p>Credentials are visible only in this admin view. Close the view when finished.</p>
            <label className="field">Access key ID<code>{revealed.accessKeyId}</code></label>
            <label className="field">Secret access key<code>{revealed.secretAccessKey}</code></label>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setRevealed(null)}>Hide credentials</button>
          </div> : null}
        </li>
      ))}</ul> : <p className="storage-empty">No cloud storage is connected yet.</p>}

      {showForm ? <form className="storage-form storage-connect-form" onSubmit={(event) => void submit(event)}>
        <h3>Connect a cloud folder</h3>
        <p className="relay-panel-hint">Credentials are sent to Hub over your signed-in session and encrypted before they are saved. They are never put in browser storage.</p>
        <label className="field">Provider<select value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value as CloudStorageProvider })}><option value="aws-s3">Amazon S3</option><option value="cloudflare-r2">Cloudflare R2</option></select></label>
        <label className="field">Folder name<input required maxLength={60} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Company archive" /></label>
        <label className="field">Bucket name<input required maxLength={63} autoComplete="off" value={form.bucket} onChange={(event) => setForm({ ...form, bucket: event.target.value })} /></label>
        {form.provider === 'aws-s3' ? <label className="field">AWS region<input required value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })} placeholder="eu-central-1" /></label> : <label className="field">Cloudflare account ID<input required maxLength={32} autoComplete="off" value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })} /></label>}
        <label className="field">Access key ID<input required autoComplete="off" value={form.accessKeyId} onChange={(event) => setForm({ ...form, accessKeyId: event.target.value })} /></label>
        <label className="field">Secret access key<input type="password" required autoComplete="new-password" value={form.secretAccessKey} onChange={(event) => setForm({ ...form, secretAccessKey: event.target.value })} /></label>
        <p className="field-hint">Use a dedicated key limited to this bucket. Grant only list, read, and upload permission (s3:ListBucket, s3:GetObject, s3:PutObject). Do not use your personal cloud root credentials.</p>
        <div className="storage-actions"><button type="button" className="btn-ghost btn-sm" onClick={() => { setShowForm(false); setForm(emptyForm); }}>Cancel</button><button type="submit" className="btn-primary btn-sm" disabled={busy}>{busy ? 'Checking…' : 'Verify and connect'}</button></div>
      </form> : null}
    </section>
  );
}
