import {
  DEFAULT_USER_GPU_PREFERENCE,
  GPU_PREFERENCE_STORAGE_KEY,
  WEBGPU_MODEL_CATALOG,
  type HostGpuDescriptor,
  type LlmExecutionTarget,
  type UserGpuPreference,
  type WebGpuDeviceDescriptor,
  type WebGpuPowerPreference,
} from '@sorye/types';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface Status {
  settings: {
    provider: 'ollama' | 'vllm';
    baseUrl: string;
    model: string;
    contextLength: number;
    maxOutputTokens: number;
    minFreeVramMiB: number;
    gpuIndex?: number;
    paused: boolean;
  };
  gpu: null | {
    index?: number;
    name: string;
    usedMiB: number;
    totalMiB: number;
    freeMiB: number;
    temperatureC: number;
  };
  gpus?: HostGpuDescriptor[];
  processes: null | Array<{ pid: number; processName: string; usedMiB: number }>;
  engine: { available: boolean; detail?: string; loadedModels?: unknown[] };
  events: Array<{
    id: string;
    at: string;
    type: string;
    status?: string;
    durationMs?: number;
    gpuFreeMiB?: number;
    detail?: string;
  }>;
}

interface NavigatorWithWebGpu {
  gpu?: {
    requestAdapter(options?: { powerPreference?: WebGpuPowerPreference }): Promise<{
      info?: { vendor?: string; architecture?: string; device?: string; description?: string };
      limits?: { maxBufferSize?: number; maxStorageBufferBindingSize?: number };
      features?: { has(name: string): boolean };
      requestAdapterInfo?: () => Promise<{
        vendor?: string;
        architecture?: string;
        device?: string;
        description?: string;
      }>;
    } | null>;
  };
}

async function detectBrowserWebGpu(
  powerPreference: WebGpuPowerPreference,
): Promise<WebGpuDeviceDescriptor> {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as
    | NavigatorWithWebGpu
    | undefined;
  if (!nav?.gpu?.requestAdapter) {
    return {
      available: false,
      vendor: 'Unavailable',
      architecture: '',
      device: '',
      description: 'WebGPU API is not enabled in this browser.',
      powerPreference,
      maxBufferSize: 0,
      maxStorageBufferBindingSize: 0,
      supportsShaderF16: false,
    };
  }
  try {
    const adapter = await nav.gpu.requestAdapter({ powerPreference });
    if (!adapter) {
      return {
        available: false,
        vendor: 'No adapter',
        architecture: '',
        device: '',
        description: 'No WebGPU adapter returned by browser.',
        powerPreference,
        maxBufferSize: 0,
        maxStorageBufferBindingSize: 0,
        supportsShaderF16: false,
      };
    }
    const info: {
      vendor?: string;
      architecture?: string;
      device?: string;
      description?: string;
    } =
      adapter.info ??
      (typeof adapter.requestAdapterInfo === 'function'
        ? await adapter.requestAdapterInfo().catch(() => ({}))
        : {});
    return {
      available: true,
      vendor: info?.vendor || 'GPU Adapter',
      architecture: info?.architecture || '',
      device: info?.device || '',
      description:
        info?.description ||
        [info?.vendor, info?.device, info?.architecture].filter(Boolean).join(' · ') ||
        `WebGPU (${powerPreference})`,
      powerPreference,
      maxBufferSize: Number(adapter.limits?.maxBufferSize ?? 268_435_456),
      maxStorageBufferBindingSize: Number(adapter.limits?.maxStorageBufferBindingSize ?? 134_217_728),
      supportsShaderF16: Boolean(adapter.features?.has?.('shader-f16')),
    };
  } catch (err) {
    return {
      available: false,
      vendor: 'Error',
      architecture: '',
      device: '',
      description: err instanceof Error ? err.message : 'WebGPU probe failed.',
      powerPreference,
      maxBufferSize: 0,
      maxStorageBufferBindingSize: 0,
      supportsShaderF16: false,
    };
  }
}

export function LlmControl() {
  const [data, setData] = useState<Status | null>(null);
  const [userPref, setUserPref] = useState<UserGpuPreference>(DEFAULT_USER_GPU_PREFERENCE);
  const [userHostGpus, setUserHostGpus] = useState<HostGpuDescriptor[]>([]);
  const [webGpu, setWebGpu] = useState<WebGpuDeviceDescriptor | null>(null);
  const [prefMessage, setPrefMessage] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshUserPref = useCallback(async () => {
    try {
      const res = await fetch('/api/llm/preferences', { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as {
        preference?: UserGpuPreference;
        hostGpus?: HostGpuDescriptor[];
      };
      if (body.hostGpus) setUserHostGpus(body.hostGpus);
      if (body.preference) {
        setUserPref(body.preference);
        try {
          window.localStorage.setItem(
            GPU_PREFERENCE_STORAGE_KEY,
            JSON.stringify(body.preference),
          );
        } catch {
          // Ignore storage errors.
        }
        const probed = await detectBrowserWebGpu(body.preference.webGpuPowerPreference);
        setWebGpu(probed);
      }
    } catch {
      // Ignore user preference fetch error.
    }
  }, []);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/admin/llm', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Could not load LLM status.');
    setData(body);
  }, []);

  useEffect(() => {
    void refreshUserPref();
    void detectBrowserWebGpu(DEFAULT_USER_GPU_PREFERENCE.webGpuPowerPreference).then(setWebGpu);
    void refresh().catch((e) => setError(e.message));
    const id = window.setInterval(() => void refresh().catch((e) => setError(e.message)), 5000);
    return () => window.clearInterval(id);
  }, [refresh, refreshUserPref]);

  async function saveUserGpuSelection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setPrefMessage('');
    const form = new FormData(event.currentTarget);
    const next: UserGpuPreference = {
      target: (form.get('target') === 'client-webgpu' ? 'client-webgpu' : 'hub-server') as LlmExecutionTarget,
      webGpuPowerPreference: (form.get('webGpuPowerPreference') === 'low-power'
        ? 'low-power'
        : 'high-performance') as WebGpuPowerPreference,
      webGpuModelId: String(form.get('webGpuModelId') || DEFAULT_USER_GPU_PREFERENCE.webGpuModelId),
      hostGpuIndex: Number(form.get('hostGpuIndex') ?? 0),
    };
    try {
      const res = await fetch('/api/llm/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const body = (await res.json()) as { preference?: UserGpuPreference; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not save GPU preference.');
      const saved = body.preference ?? next;
      setUserPref(saved);
      try {
        window.localStorage.setItem(GPU_PREFERENCE_STORAGE_KEY, JSON.stringify(saved));
        window.dispatchEvent(new CustomEvent('sorye:gpu-preference-changed', { detail: saved }));
      } catch {
        // Ignore storage errors.
      }
      setWebGpu(await detectBrowserWebGpu(saved.webGpuPowerPreference));
      setPrefMessage(
        saved.target === 'client-webgpu'
          ? `Saved: Using your Browser WebGPU (${saved.webGpuModelId}).`
          : `Saved: Using Hub Server GPU #${saved.hostGpuIndex}.`,
      );
    } catch (e) {
      setPrefMessage(e instanceof Error ? e.message : 'Could not save GPU preference.');
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const form = new FormData(event.currentTarget);
    const payload = {
      provider: form.get('provider'),
      baseUrl: form.get('baseUrl'),
      model: form.get('model'),
      contextLength: Number(form.get('contextLength')),
      maxOutputTokens: Number(form.get('maxOutputTokens')),
      minFreeVramMiB: Number(form.get('minFreeVramMiB')),
      gpuIndex: Number(form.get('gpuIndex') ?? 0),
    };
    try {
      const response = await fetch('/api/admin/llm', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not save settings.');
      setMessage('LLM settings saved.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save settings.');
    } finally {
      setBusy(false);
    }
  }

  async function action(act: 'pause' | 'resume' | 'stop') {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/llm/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: act }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'LLM action failed.');
      setMessage(body.detail);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'LLM action failed.');
    } finally {
      setBusy(false);
    }
  }

  const hostGpus = data?.gpus?.length ? data.gpus : userHostGpus;

  return (
    <div className="llm-control">
      <section className="panel" aria-label="My GPU and WebGPU runtime">
        <h2>My GPU (WebGPU &amp; Host Selection)</h2>
        <p className="panel-hint">
          Choose whether OCR and the Sorye MCP Assistant run on your own browser GPU via the WebGPU API or on the Hub Server GPU.
        </p>
        <div className="llm-runtime-grid">
          <article>
            <strong>Browser WebGPU adapter</strong>
            <span>
              {webGpu?.available
                ? `${webGpu.description} · max buffer ${Math.round(webGpu.maxBufferSize / (1024 * 1024))} MiB · shader-f16: ${webGpu.supportsShaderF16 ? 'yes' : 'no'}`
                : (webGpu?.description ?? 'Checking navigator.gpu…')}
            </span>
          </article>
          <article>
            <strong>Active execution target</strong>
            <span>
              {userPref.target === 'client-webgpu'
                ? `My GPU (WebGPU · ${userPref.webGpuModelId})`
                : `Hub Server GPU #${userPref.hostGpuIndex}`}
            </span>
          </article>
        </div>
        <form className="llm-settings-form" onSubmit={saveUserGpuSelection}>
          <label>
            Execution GPU target
            <select name="target" value={userPref.target} onChange={(e) => setUserPref((p) => ({ ...p, target: e.target.value as LlmExecutionTarget }))}>
              <option value="hub-server">Hub Server GPU (Qwen3-8B)</option>
              <option value="client-webgpu">My GPU (Browser WebGPU API)</option>
            </select>
          </label>
          <label>
            WebGPU adapter power profile
            <select
              name="webGpuPowerPreference"
              value={userPref.webGpuPowerPreference}
              onChange={(e) =>
                setUserPref((p) => ({
                  ...p,
                  webGpuPowerPreference: e.target.value as WebGpuPowerPreference,
                }))
              }
            >
              <option value="high-performance">High-performance (Discrete GPU)</option>
              <option value="low-power">Low-power (Integrated GPU)</option>
            </select>
          </label>
          <label>
            WebGPU model
            <select
              name="webGpuModelId"
              value={userPref.webGpuModelId}
              onChange={(e) => setUserPref((p) => ({ ...p, webGpuModelId: e.target.value }))}
            >
              {WEBGPU_MODEL_CATALOG.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Preferred Host GPU index
            <select
              name="hostGpuIndex"
              value={userPref.hostGpuIndex}
              onChange={(e) => setUserPref((p) => ({ ...p, hostGpuIndex: Number(e.target.value) }))}
            >
              {hostGpus.length > 0 ? (
                hostGpus.map((g) => (
                  <option key={g.index} value={g.index}>
                    GPU #{g.index} · {g.name} ({g.freeMiB} MiB free / {g.totalMiB} MiB)
                  </option>
                ))
              ) : (
                <option value={0}>GPU #0 (Default host GPU)</option>
              )}
            </select>
          </label>
          <div className="llm-actions">
            <button className="dashboard-link-btn" disabled={busy}>
              Save my GPU choice
            </button>
          </div>
        </form>
        {prefMessage ? <p role="status">{prefMessage}</p> : null}
      </section>

      {!data ? (
        <section className="panel">
          <h2>Server LLM engine settings</h2>
          <p role="status">{error || 'Loading runtime status…'}</p>
        </section>
      ) : (
        <>
          <section className="panel">
            <h2>Server LLM engine settings</h2>
            <form className="llm-settings-form" onSubmit={save}>
              <label>
                Provider
                <select name="provider" defaultValue={data.settings.provider}>
                  <option value="ollama">Ollama</option>
                  <option value="vllm">vLLM</option>
                </select>
              </label>
              <label>
                Provider URL
                <input
                  name="baseUrl"
                  type="url"
                  required
                  maxLength={240}
                  defaultValue={data.settings.baseUrl}
                  placeholder="http://127.0.0.1:8000"
                />
              </label>
              <label>
                Model
                <input
                  name="model"
                  required
                  maxLength={80}
                  defaultValue={data.settings.model}
                />
              </label>
              <label>
                Host GPU device
                <select name="gpuIndex" defaultValue={data.settings.gpuIndex ?? 0}>
                  {hostGpus.length > 0 ? (
                    hostGpus.map((g) => (
                      <option key={g.index} value={g.index}>
                        GPU #{g.index} · {g.name}
                      </option>
                    ))
                  ) : (
                    <option value={0}>GPU #0</option>
                  )}
                </select>
              </label>
              <label>
                Context tokens
                <input
                  name="contextLength"
                  type="number"
                  min={2048}
                  max={8192}
                  step={512}
                  defaultValue={data.settings.contextLength}
                />
              </label>
              <label>
                Maximum output tokens
                <input
                  name="maxOutputTokens"
                  type="number"
                  min={128}
                  max={1800}
                  step={64}
                  defaultValue={data.settings.maxOutputTokens}
                />
              </label>
              <label>
                Minimum free GPU VRAM (MiB)
                <input
                  name="minFreeVramMiB"
                  type="number"
                  min={512}
                  max={8192}
                  step={256}
                  defaultValue={data.settings.minFreeVramMiB}
                />
                <small>This is an admission reserve, not a hard VRAM allocation cap.</small>
              </label>
              <div className="llm-actions">
                <button className="dashboard-link-btn" disabled={busy}>
                  Save settings
                </button>
                <button
                  type="button"
                  className="dashboard-link-btn"
                  disabled={busy || data.settings.paused}
                  onClick={() => void action('pause')}
                >
                  Pause requests
                </button>
                <button
                  type="button"
                  className="dashboard-link-btn"
                  disabled={busy || data.settings.paused}
                  onClick={() => void action('stop')}
                >
                  Pause and unload model
                </button>
                <button
                  type="button"
                  className="dashboard-link-btn"
                  disabled={busy || !data.settings.paused}
                  onClick={() => void action('resume')}
                >
                  Resume requests
                </button>
              </div>
            </form>
            <p role="status">
              {message || (data.settings.paused ? 'Inference paused' : 'Inference enabled')}
            </p>
            {error && (
              <p className="db-error" role="alert">
                {error}
              </p>
            )}
          </section>
          <section className="panel">
            <h2>Live runtime</h2>
            <div className="llm-runtime-grid">
              <article>
                <strong>GPU</strong>
                <span>
                  {data.gpu
                    ? `GPU #${data.gpu.index ?? 0} · ${data.gpu.name} · ${data.gpu.freeMiB} MiB free / ${data.gpu.totalMiB} MiB · ${data.gpu.temperatureC}°C`
                    : 'nvidia-smi telemetry unavailable'}
                </span>
              </article>
              <article>
                <strong>Engine</strong>
                <span>
                  {data.engine.available
                    ? `Available · ${data.engine.loadedModels?.length ?? 0} model(s) reported`
                    : data.engine.detail}
                </span>
              </article>
              <article>
                <strong>GPU compute processes</strong>
                <span>
                  {data.processes === null
                    ? 'Process list unavailable'
                    : data.processes.length
                      ? data.processes
                          .map((p) => `${p.processName} (${p.pid}, ${p.usedMiB} MiB)`)
                          .join(' · ')
                      : 'None reported'}
                </span>
              </article>
            </div>
            <p className="panel-hint">
              The audit log records request timing, sizes, status, and GPU checks. Prompt text and document contents are never logged. Log entries are held in memory and clear when Hub restarts. Stop pauses new requests and unloads the configured Ollama model; it cannot terminate unrelated GPU processes. vLLM remains loaded until its service operator stops it.
            </p>
          </section>
          <section className="panel">
            <h2>LLM activity log</h2>
            <div className="llm-log-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>GPU free</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((event) => (
                    <tr key={event.id}>
                      <td>{new Date(event.at).toLocaleTimeString()}</td>
                      <td>{event.type}</td>
                      <td>{event.status ?? '—'}</td>
                      <td>{event.durationMs == null ? '—' : `${event.durationMs} ms`}</td>
                      <td>{event.gpuFreeMiB == null ? '—' : `${event.gpuFreeMiB} MiB`}</td>
                      <td>{event.detail ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
