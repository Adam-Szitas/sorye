import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface Status {
  settings: { provider: 'ollama' | 'vllm'; baseUrl: string; model: string; contextLength: number; maxOutputTokens: number; minFreeVramMiB: number; paused: boolean };
  gpu: null | { name: string; usedMiB: number; totalMiB: number; freeMiB: number; temperatureC: number };
  processes: null | Array<{ pid: number; processName: string; usedMiB: number }>;
  engine: { available: boolean; detail?: string; loadedModels?: unknown[] };
  events: Array<{ id: string; at: string; type: string; status?: string; durationMs?: number; gpuFreeMiB?: number; detail?: string }>;
}

export function LlmControl() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/admin/llm', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Could not load LLM status.');
    setData(body);
  }, []);
  useEffect(() => { void refresh().catch((e) => setError(e.message)); const id = window.setInterval(() => void refresh().catch((e) => setError(e.message)), 5000); return () => window.clearInterval(id); }, [refresh]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const form = new FormData(event.currentTarget);
    const payload = {
      provider: form.get('provider'), baseUrl: form.get('baseUrl'), model: form.get('model'),
      contextLength: Number(form.get('contextLength')), maxOutputTokens: Number(form.get('maxOutputTokens')),
      minFreeVramMiB: Number(form.get('minFreeVramMiB')),
    };
    try {
      const response = await fetch('/api/admin/llm', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not save settings.');
      setMessage('LLM settings saved.'); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save settings.'); }
    finally { setBusy(false); }
  }
  async function action(action: 'pause' | 'resume' | 'stop') {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/admin/llm/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'LLM action failed.');
      setMessage(body.detail); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'LLM action failed.'); }
    finally { setBusy(false); }
  }
  if (!data) return <section className="panel"><h2>LLM &amp; GPU</h2><p role="status">{error || 'Loading runtime status…'}</p></section>;
  const s = data.settings;
  return <div className="llm-control">
    <section className="panel"><h2>LLM engine settings</h2>
      <form className="llm-settings-form" onSubmit={save}>
        <label>Provider<select name="provider" defaultValue={s.provider}><option value="ollama">Ollama</option><option value="vllm">vLLM</option></select></label>
        <label>Provider URL<input name="baseUrl" type="url" required maxLength={240} defaultValue={s.baseUrl} placeholder="http://127.0.0.1:8000" /></label>
        <label>Model<input name="model" required maxLength={80} defaultValue={s.model} /></label>
        <label>Context tokens<input name="contextLength" type="number" min={2048} max={8192} step={512} defaultValue={s.contextLength} /></label>
        <label>Maximum output tokens<input name="maxOutputTokens" type="number" min={128} max={1800} step={64} defaultValue={s.maxOutputTokens} /></label>
        <label>Minimum free GPU VRAM (MiB)<input name="minFreeVramMiB" type="number" min={512} max={8192} step={256} defaultValue={s.minFreeVramMiB} /><small>This is an admission reserve, not a hard VRAM allocation cap.</small></label>
        <div className="llm-actions"><button className="dashboard-link-btn" disabled={busy}>Save settings</button><button type="button" className="dashboard-link-btn" disabled={busy || s.paused} onClick={() => void action('pause')}>Pause requests</button><button type="button" className="dashboard-link-btn" disabled={busy || s.paused} onClick={() => void action('stop')}>Pause and unload model</button><button type="button" className="dashboard-link-btn" disabled={busy || !s.paused} onClick={() => void action('resume')}>Resume requests</button></div>
      </form><p role="status">{message || (s.paused ? 'Inference paused' : 'Inference enabled')}</p>{error && <p className="db-error" role="alert">{error}</p>}
    </section>
    <section className="panel"><h2>Live runtime</h2><div className="llm-runtime-grid">
      <article><strong>GPU</strong><span>{data.gpu ? `${data.gpu.name} · ${data.gpu.freeMiB} MiB free / ${data.gpu.totalMiB} MiB · ${data.gpu.temperatureC}°C` : 'nvidia-smi telemetry unavailable'}</span></article>
      <article><strong>Engine</strong><span>{data.engine.available ? `Available · ${data.engine.loadedModels?.length ?? 0} model(s) reported` : data.engine.detail}</span></article>
      <article><strong>GPU compute processes</strong><span>{data.processes === null ? 'Process list unavailable' : data.processes.length ? data.processes.map((p) => `${p.processName} (${p.pid}, ${p.usedMiB} MiB)`).join(' · ') : 'None reported'}</span></article>
    </div><p className="panel-hint">The audit log records request timing, sizes, status, and GPU checks. Prompt text and document contents are never logged. Log entries are held in memory and clear when Hub restarts. Stop pauses new requests and unloads the configured Ollama model; it cannot terminate unrelated GPU processes. vLLM remains loaded until its service operator stops it.</p></section>
    <section className="panel"><h2>LLM activity log</h2><div className="llm-log-wrap"><table><thead><tr><th>Time</th><th>Event</th><th>Status</th><th>Duration</th><th>GPU free</th><th>Detail</th></tr></thead><tbody>{data.events.map((event) => <tr key={event.id}><td>{new Date(event.at).toLocaleTimeString()}</td><td>{event.type}</td><td>{event.status ?? '—'}</td><td>{event.durationMs == null ? '—' : `${event.durationMs} ms`}</td><td>{event.gpuFreeMiB == null ? '—' : `${event.gpuFreeMiB} MiB`}</td><td>{event.detail ?? '—'}</td></tr>)}</tbody></table></div></section>
  </div>;
}
