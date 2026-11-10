'use client';

import { useEffect, useRef, useState } from 'react';
import { SHARED_AI_LIMITS, type SharedAiConfigV1 } from '@sorye/types';
import type { SharedAiView } from '@/lib/admin/shared-ai';
import { AdminTable, Badge, LoadNotice, PageHeader, type Tone } from './ui';
import { adminSend, formatWhen, useAdminJson } from './use-admin-json';

const CONFIG_URL = '/api/admin/console/config/shared-ai';
const L = SHARED_AI_LIMITS;

type Telemetry = {
  settings: SharedAiConfigV1;
  source: { source: string; platformRevision: number };
  gpu: { name: string; usedMiB: number; totalMiB: number; freeMiB: number; temperatureC: number } | null;
  processes: { pid: number; processName: string; usedMiB: number }[] | null;
  engine: { available: boolean; detail?: string; loadedModels?: unknown[] };
  events: { id: string; at: string; type: string; status?: string; model?: string; durationMs?: number; detail?: string }[];
};

type Notice = { tone: Tone; text: string } | null;
type Conflict = { latestRevision: number; latest: SharedAiConfigV1 | null } | null;

const PROPAGATION_TONE: Record<string, Tone> = { applied: 'ok', pending: 'warn', failed: 'bad', unknown: 'info' };
const FIELDS: (keyof SharedAiConfigV1)[] = ['provider', 'baseUrl', 'model', 'contextLength', 'maxOutputTokens', 'minFreeVramMiB', 'gpuIndex', 'paused'];

function sameValue(a: SharedAiConfigV1 | null, b: SharedAiConfigV1 | null): boolean {
  if (!a || !b) return a === b;
  return FIELDS.every((field) => a[field] === b[field]);
}

function errorText(status: number, body: { error?: string; detail?: string } | null): string {
  const code = body?.error ?? (status === 0 ? 'network' : `http_${status}`);
  switch (code) {
    case 'invalid_config': return `The configuration was refused: ${body?.detail ?? 'invalid value'}.`;
    case 'invalid_rollback': return 'That revision cannot be restored (it must be an earlier revision).';
    case 'revision_not_found': return 'That revision does not exist.';
    case 'rate_limited': return 'Too many administrative changes in a minute. Wait and retry.';
    case 'config_store_not_configured': return 'Rodrigo is not configured for this Hub, so shared configuration cannot be stored.';
    case 'platform_provider_unavailable': return 'Rodrigo has no PostgreSQL platform store configured.';
    case 'config_store_unavailable':
    case 'network': return 'Rodrigo did not answer. The outcome is unknown: retry the same change (it is idempotent) or reload to see the current revision.';
    default: return `The change failed (${code}).`;
  }
}

export function SharedAiConsole() {
  const config = useAdminJson<SharedAiView>(CONFIG_URL, 15_000);
  const telemetry = useAdminJson<Telemetry>('/api/admin/llm', 10_000);
  const [draft, setDraft] = useState<SharedAiConfigV1 | null>(null);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [conflict, setConflict] = useState<Conflict>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState('');
  /** One change ID per intended change, reused on retry so an unknown outcome is never applied twice. */
  const changeId = useRef<string | null>(null);
  const pendingChange = useRef<string | null>(null);

  const view = config.state.kind === 'ready' ? config.state.data : null;
  const storeReady = view?.store === 'ready';
  const current = view?.value ?? view?.hubEffective ?? null;
  const dirty = Boolean(draft && current && !sameValue(draft, current));

  useEffect(() => {
    if (!view || dirty || conflict) return;
    setDraft(view.value ?? view.hubEffective);
    setBaseRevision(view.revision);
  }, [view, dirty, conflict]);

  const update = <K extends keyof SharedAiConfigV1>(key: K, value: SharedAiConfigV1[K]) => {
    changeId.current = null;
    setDraft((previous) => previous ? { ...previous, [key]: value } : previous);
  };

  async function commit(value: SharedAiConfigV1, expectedRevision: number, label: string, idRef: { current: string | null }) {
    idRef.current ??= crypto.randomUUID();
    setBusy(true);
    setNotice(null);
    const result = await adminSend<{ status: string; revision: number; hubAppliedRevision: number; auditId: string }>(CONFIG_URL, 'PUT', {
      changeId: idRef.current, expectedRevision, value, ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
    setBusy(false);
    if (result.status === 200 && result.body) {
      idRef.current = null;
      setConflict(null);
      setReason('');
      const applied = result.body.hubAppliedRevision === result.body.revision ? 'Hub has applied it' : 'Hub has not applied it yet';
      setNotice({ tone: 'ok', text: `${label}: revision ${result.body.revision} ${result.body.status === 'duplicate' ? 'was already committed (retry recognised)' : 'committed'}. ${applied}; the OCR worker applies it within one poll interval.` });
      await config.reload();
      return;
    }
    if (result.status === 409 && result.body?.error === 'revision_conflict') {
      const latest = await fetch(CONFIG_URL, { credentials: 'same-origin', cache: 'no-store' }).then((res) => res.json() as Promise<SharedAiView>).catch(() => null);
      idRef.current = null;
      setConflict({ latestRevision: latest?.revision ?? -1, latest: latest?.value ?? null });
      setNotice({ tone: 'warn', text: `${label} was not saved: another administrator changed the configuration first. Review the latest values below.` });
      return;
    }
    if (result.status === 409 && result.body?.error === 'idempotency_key_reused') {
      idRef.current = null;
      setNotice({ tone: 'warn', text: 'That change ID was already used for a different change. Submit again to send it as a new change.' });
      return;
    }
    if (result.status !== 503 && result.status !== 0) idRef.current = null;
    setNotice({ tone: result.status === 503 || result.status === 0 ? 'warn' : 'bad', text: errorText(result.status, result.body) });
  }

  async function rollback(event: React.FormEvent) {
    event.preventDefault();
    if (!view) return;
    const target = Number(rollbackTarget);
    pendingChange.current ??= crypto.randomUUID();
    setBusy(true);
    setNotice(null);
    const result = await adminSend<{ revision: number; status: string }>(`${CONFIG_URL}/rollback`, 'POST', {
      changeId: pendingChange.current, expectedRevision: view.revision, targetRevision: target,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
    setBusy(false);
    if (result.status === 200 && result.body) {
      pendingChange.current = null;
      setRollbackTarget('');
      setNotice({ tone: 'ok', text: `Restored the values of revision ${target} as new revision ${result.body.revision}. History is unchanged.` });
      setDraft(null);
      await config.reload();
      return;
    }
    if (result.status !== 503 && result.status !== 0) pendingChange.current = null;
    setNotice({ tone: result.status === 409 ? 'warn' : 'bad', text: result.status === 409 ? 'The configuration changed while you were choosing a revision. Reload and pick again.' : errorText(result.status, result.body) });
  }

  async function stop() {
    setBusy(true);
    setNotice(null);
    const result = await adminSend<{ unloaded: boolean; detail?: string; auditOutcomeRecorded: boolean }>('/api/admin/llm/action', 'POST', { action: 'stop' });
    setBusy(false);
    setConfirmStop(false);
    if (result.status === 200 && result.body) {
      setNotice({ tone: result.body.unloaded ? 'ok' : 'warn', text: `${result.body.unloaded ? 'Stopped Hub requests and unloaded the model.' : `Stop ran but the model was not unloaded${result.body.detail ? `: ${result.body.detail}` : '.'}`}${result.body.auditOutcomeRecorded ? '' : ' The outcome could not be recorded in the audit log.'}` });
      void telemetry.reload();
      return;
    }
    const code = result.body?.error;
    setNotice({ tone: 'bad', text: code === 'pause_first' ? 'Pause shared AI first and wait until Hub shows it as applied.' : code === 'audit_unavailable' ? 'The audit log is unavailable, so nothing was stopped.' : errorText(result.status, result.body) });
  }

  const pauseRef = useRef<string | null>(null);
  const togglePause = () => {
    if (!view?.value) return;
    void commit({ ...view.value, paused: !view.value.paused }, view.revision, view.value.paused ? 'Resume' : 'Pause', pauseRef);
  };

  const hubPaused = view?.hubEffective.paused === true;

  return (
    <div className="admin-page">
      <PageHeader
        title="AI and workers"
        intro="One shared AI engine serves the Hub and the separate OCR worker. Changes are stored in Rodrigo as numbered revisions; each consumer reports which revision it has applied."
      />
      <LoadNotice state={config.state} what="the shared AI configuration" />
      {notice ? <p role={notice.tone === 'ok' ? 'status' : 'alert'} className="admin-alert" data-tone={notice.tone === 'ok' ? undefined : notice.tone}>{notice.text}</p> : null}

      {view ? (
        <section className="admin-section" aria-labelledby="ai-state-title">
          <h2 id="ai-state-title">Current state</h2>
          <dl className="admin-cards">
            <div className="admin-card"><dt>Stored revision</dt><dd>{storeReady ? (view.revision || 'none yet') : <Badge tone="warn">{view.store.replace('_', ' ')}</Badge>}</dd></div>
            <div className="admin-card"><dt>Last change</dt><dd>{formatWhen(view.updatedAt)}{view.updatedBy ? ` · ${view.updatedBy}` : ''}</dd></div>
            <div className="admin-card"><dt>This Hub enforces</dt><dd>{view.hubSource === 'platform' || view.hubSource === 'platform-cache' ? `revision ${view.hubAppliedRevision}${view.hubSource === 'platform-cache' ? ' (from cache)' : ''}` : view.hubSource === 'legacy-file' ? 'legacy file (no revision)' : 'environment defaults'}</dd></div>
            <div className="admin-card"><dt>New AI requests</dt><dd>{hubPaused ? <Badge tone="warn">Paused</Badge> : <Badge tone="ok">Accepted</Badge>}</dd></div>
          </dl>
          {!storeReady ? (
            <p className="admin-alert" data-tone="warn">
              Editing is unavailable: {view.store === 'not_configured' ? 'this Hub has no Rodrigo connection (RODRIGO_BASE_URL and signing key).' : view.store === 'provider_unavailable' ? 'Rodrigo has no PostgreSQL platform store.' : 'Rodrigo is not answering.'} The values below are what this Hub enforces now.
            </p>
          ) : null}
          <AdminTable
            caption="Propagation by consumer"
            rows={view.consumers}
            rowKey={(row) => `${row.consumer}-${row.instanceId ?? 'none'}`}
            empty={storeReady ? 'No consumer has reported yet.' : 'Propagation is unknown while the store is unavailable.'}
            columns={[
              { header: 'Consumer', cell: (row) => row.consumer },
              { header: 'Instance', cell: (row) => row.instanceId ?? '—' },
              { header: 'Applied revision', cell: (row) => row.appliedRevision ?? '—' },
              { header: 'State', cell: (row) => <Badge tone={PROPAGATION_TONE[row.propagation]}>{row.propagation}{row.code ? ` · ${row.code}` : ''}</Badge> },
              { header: 'Reported', cell: (row) => formatWhen(row.reportedAt) },
            ]}
          />
          <p className="admin-hint">Unknown means the consumer has not reported in the last three minutes or is not running. Consumers poll every 15 seconds by default.</p>
        </section>
      ) : null}

      {view && draft ? (
        <section className="admin-section" aria-labelledby="ai-runtime-title">
          <h2 id="ai-runtime-title">Pause and stop</h2>
          <p className="admin-muted">
            Pause is part of the configuration: each consumer refuses new AI requests once it applies the revision. Requests already running finish.
            Stop is immediate and only affects this Hub process: it aborts Hub requests and unloads the model. It does not cancel OCR worker jobs in progress.
          </p>
          <div className="admin-actions">
            <button type="button" className="admin-button" disabled={!storeReady || !view.value || busy} onClick={togglePause}>
              {view.value?.paused ? 'Resume new requests' : 'Pause new requests'}
            </button>
            {confirmStop ? (
              <>
                <button type="button" className="admin-button" data-variant="danger" disabled={busy} onClick={() => { void stop(); }}>Confirm stop and unload</button>
                <button type="button" className="admin-button" onClick={() => setConfirmStop(false)}>Cancel</button>
              </>
            ) : (
              <button type="button" className="admin-button" data-variant="danger" disabled={!hubPaused || busy} onClick={() => setConfirmStop(true)}>Stop and unload</button>
            )}
          </div>
          {!hubPaused ? <p className="admin-hint">Stop becomes available after this Hub has applied a paused revision.</p> : null}
        </section>
      ) : null}

      {view && draft ? (
        <section className="admin-section" aria-labelledby="ai-edit-title">
          <h2 id="ai-edit-title">Engine configuration</h2>
          {conflict ? (
            <div role="alert" className="admin-alert" data-tone="warn">
              <p>Revision {conflict.latestRevision} was saved by someone else after you started editing revision {baseRevision}.</p>
              {conflict.latest ? (
                <ul>
                  {FIELDS.filter((field) => conflict.latest && conflict.latest[field] !== draft[field]).map((field) => (
                    <li key={field}>{field}: theirs <strong>{String(conflict.latest?.[field])}</strong>, yours <strong>{String(draft[field])}</strong></li>
                  ))}
                </ul>
              ) : null}
              <div className="admin-actions">
                <button type="button" className="admin-button" onClick={() => { setConflict(null); setDraft(conflict.latest); setBaseRevision(conflict.latestRevision); changeId.current = null; }}>Discard mine, use theirs</button>
                <button type="button" className="admin-button" onClick={() => { setBaseRevision(conflict.latestRevision); setConflict(null); changeId.current = null; }}>Keep mine on top of theirs</button>
              </div>
            </div>
          ) : null}
          <form
            className="admin-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (draft && baseRevision !== null) void commit(draft, baseRevision, 'Configuration', changeId);
            }}
          >
            <fieldset disabled={!storeReady || busy || Boolean(conflict)}>
              <legend>Shared engine (based on revision {baseRevision ?? '—'})</legend>
              <div className="admin-grid-2">
                <div className="admin-field">
                  <label htmlFor="ai-provider">Provider</label>
                  <select id="ai-provider" value={draft.provider} onChange={(event) => update('provider', event.target.value as SharedAiConfigV1['provider'])}>
                    <option value="ollama">Ollama</option>
                    <option value="vllm">vLLM (OpenAI-compatible)</option>
                  </select>
                </div>
                <div className="admin-field">
                  <label htmlFor="ai-url">Provider URL</label>
                  <input id="ai-url" type="url" inputMode="url" maxLength={L.baseUrlMax} value={draft.baseUrl} aria-describedby="ai-url-hint" onChange={(event) => update('baseUrl', event.target.value)} />
                  <span id="ai-url-hint" className="admin-hint">Allowed hosts only (local engine names); no credentials, query or fragment. Empty disables server AI.</span>
                </div>
                <div className="admin-field">
                  <label htmlFor="ai-model">Model</label>
                  <input id="ai-model" maxLength={L.modelMax} pattern="[A-Za-z0-9][A-Za-z0-9._:/\-]*" value={draft.model} autoComplete="off" spellCheck={false} onChange={(event) => update('model', event.target.value)} />
                </div>
                <div className="admin-field">
                  <label htmlFor="ai-context">Context length (tokens)</label>
                  <input id="ai-context" type="number" required min={L.contextLength[0]} max={L.contextLength[1]} step={1} value={draft.contextLength} onChange={(event) => update('contextLength', Number(event.target.value))} />
                </div>
                <div className="admin-field">
                  <label htmlFor="ai-output">Maximum output tokens</label>
                  <input id="ai-output" type="number" required min={L.maxOutputTokens[0]} max={L.maxOutputTokens[1]} step={1} value={draft.maxOutputTokens} onChange={(event) => update('maxOutputTokens', Number(event.target.value))} />
                </div>
                <div className="admin-field">
                  <label htmlFor="ai-vram">Minimum free GPU memory (MiB)</label>
                  <input id="ai-vram" type="number" required min={L.minFreeVramMiB[0]} max={L.minFreeVramMiB[1]} step={1} value={draft.minFreeVramMiB} onChange={(event) => update('minFreeVramMiB', Number(event.target.value))} />
                </div>
                <div className="admin-field">
                  <label htmlFor="ai-gpu">GPU index</label>
                  <input id="ai-gpu" type="number" required min={L.gpuIndex[0]} max={L.gpuIndex[1]} step={1} value={draft.gpuIndex} onChange={(event) => update('gpuIndex', Number(event.target.value))} />
                </div>
              </div>
              <div className="admin-field">
                <label htmlFor="ai-reason">Reason (recorded in history)</label>
                <input id="ai-reason" maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} />
              </div>
            </fieldset>
            <div className="admin-actions">
              <button type="submit" className="admin-button" data-variant="primary" disabled={!storeReady || busy || !dirty || Boolean(conflict)}>
                {busy ? 'Saving' : changeId.current ? 'Retry the same change' : 'Save as new revision'}
              </button>
              <button type="button" className="admin-button" disabled={busy || !dirty} onClick={() => { changeId.current = null; setConflict(null); setDraft(current); setBaseRevision(view.revision); }}>Discard edits</button>
            </div>
          </form>
        </section>
      ) : null}

      {view && storeReady && view.revision > 1 ? (
        <section className="admin-section" aria-labelledby="ai-rollback-title">
          <h2 id="ai-rollback-title">Restore an earlier revision</h2>
          <p className="admin-muted">Restoring writes the older values as a new revision. Earlier revisions and their history stay intact. Revision values are listed under Configuration history.</p>
          <form className="admin-form" onSubmit={(event) => { void rollback(event); }}>
            <div className="admin-actions">
              <div className="admin-field">
                <label htmlFor="ai-rollback">Revision to restore</label>
                <input id="ai-rollback" type="number" required min={1} max={view.revision - 1} step={1} value={rollbackTarget} onChange={(event) => { pendingChange.current = null; setRollbackTarget(event.target.value); }} />
              </div>
              <button type="submit" className="admin-button" disabled={busy}>Restore as revision {view.revision + 1}</button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="admin-section admin-defer" aria-labelledby="ai-telemetry-title">
        <h2 id="ai-telemetry-title">This Hub&apos;s engine telemetry</h2>
        <LoadNotice state={telemetry.state} what="engine telemetry" />
        {telemetry.state.kind === 'ready' ? (() => {
          const data = telemetry.state.data;
          return (
            <>
              <dl className="admin-cards">
                <div className="admin-card"><dt>Engine</dt><dd>{data.engine.available ? <Badge tone="ok">Reachable</Badge> : <Badge tone="warn">{data.engine.detail ?? 'Unavailable'}</Badge>}</dd></div>
                <div className="admin-card"><dt>Loaded models</dt><dd>{data.engine.loadedModels?.length ?? 0}</dd></div>
                <div className="admin-card"><dt>GPU</dt><dd>{data.gpu?.name ?? 'No GPU telemetry'}</dd></div>
                <div className="admin-card"><dt>GPU memory free</dt><dd>{data.gpu ? `${data.gpu.freeMiB} of ${data.gpu.totalMiB} MiB` : '—'}</dd></div>
              </dl>
              <AdminTable
                caption="Recent engine activity (no prompts or document text)"
                rows={data.events.slice(0, 30)}
                rowKey={(row) => row.id}
                empty="No activity recorded in this process."
                columns={[
                  { header: 'When', cell: (row) => formatWhen(row.at) },
                  { header: 'Event', cell: (row) => row.type.replace(/_/g, ' ') },
                  { header: 'Status', cell: (row) => row.status ?? '—' },
                  { header: 'Model', cell: (row) => row.model ?? '—' },
                  { header: 'Duration', cell: (row) => row.durationMs !== undefined ? `${row.durationMs} ms` : '—' },
                  { header: 'Detail', cell: (row) => row.detail ?? '—' },
                ]}
              />
            </>
          );
        })() : null}
      </section>
    </div>
  );
}
