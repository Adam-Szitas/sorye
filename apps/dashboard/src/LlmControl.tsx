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
  const [userPref, setUserPref] = useState<UserGpuPreference>(DEFAULT_USER_GPU_PREFERENCE);
  const [userHostGpus, setUserHostGpus] = useState<HostGpuDescriptor[]>([]);
  const [webGpu, setWebGpu] = useState<WebGpuDeviceDescriptor | null>(null);
  const [prefMessage, setPrefMessage] = useState('');
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

  useEffect(() => {
    void refreshUserPref();
    void detectBrowserWebGpu(DEFAULT_USER_GPU_PREFERENCE.webGpuPowerPreference).then(setWebGpu);
  }, [refreshUserPref]);

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

  const hostGpus = userHostGpus;

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

      <section className="panel" aria-labelledby="llm-admin-moved">
        <h2 id="llm-admin-moved">Shared AI engine</h2>
        <p className="panel-hint">
          The server engine (provider, model, limits, pause and stop) is managed in the administration console. Each change there is a numbered,
          audited revision that both the Hub and the OCR worker apply.
        </p>
        <p>
          <a className="dashboard-link-btn" href="/admin/ai">Open AI and workers in the administration console</a>
        </p>
      </section>
    </div>
  );
}
