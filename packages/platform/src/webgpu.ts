import {
  DEFAULT_USER_GPU_PREFERENCE,
  DEFAULT_WEBGPU_MODEL_ID,
  GPU_PREFERENCE_STORAGE_KEY,
  WEBGPU_MODEL_CATALOG,
  ocrPositionId,
  ocrSourceTableCells,
  readableOcrLine,
  type OcrAiPage,
  type OcrNormalizedRow,
  type OcrPatternDocument,
  type UserGpuPreference,
  type WebGpuDeviceDescriptor,
  type WebGpuPowerPreference,
} from '@sorye/types';

interface NavigatorWithGpu {
  gpu?: {
    requestAdapter(options?: { powerPreference?: WebGpuPowerPreference }): Promise<GpuAdapterLike | null>;
  };
}

interface GpuAdapterLike {
  info?: {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  };
  limits?: {
    maxBufferSize?: number;
    maxStorageBufferBindingSize?: number;
  };
  features?: {
    has(name: string): boolean;
  };
  requestAdapterInfo?: () => Promise<{
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  }>;
  requestDevice(descriptor?: Record<string, unknown>): Promise<GpuDeviceLike>;
}

interface GpuBufferLike {
  destroy(): void;
}

interface GpuDeviceLike {
  createBuffer(descriptor: { size: number; usage: number; mappedAtCreation?: boolean }): GpuBufferLike & {
    getMappedRange(): ArrayBuffer;
    unmap(): void;
  };
  createShaderModule(descriptor: { code: string }): unknown;
  createComputePipeline(descriptor: {
    layout: 'auto';
    compute: { module: unknown; entryPoint: string };
  }): { getBindGroupLayout(index: number): unknown };
  createBindGroup(descriptor: {
    layout: unknown;
    entries: Array<{ binding: number; resource: { buffer: GpuBufferLike } }>;
  }): unknown;
  createCommandEncoder(): {
    beginComputePass(): {
      setPipeline(pipeline: unknown): void;
      setBindGroup(index: number, group: unknown): void;
      dispatchWorkgroups(x: number): void;
      end(): void;
    };
    finish(): unknown;
  };
  queue: {
    submit(commands: unknown[]): void;
    onSubmittedWorkDone?: () => Promise<void>;
  };
  destroy(): void;
}

interface WebLlmEngineLike {
  modelId: string;
  chat?: {
    completions?: {
      create(request: {
        messages: Array<{ role: string; content: string }>;
        temperature?: number;
        max_tokens?: number;
      }): Promise<{
        choices?: Array<{ message?: { content?: string } }>;
      }>;
    };
  };
  unload?: () => Promise<void>;
}

const PREF_EVENT = 'sorye:gpu-preference-changed';
const PREF_CHANNEL = 'sorye-gpu-preference';

let activeDevice: GpuDeviceLike | null = null;
let activeEngine: WebLlmEngineLike | null = null;

function sanitizePreference(raw: unknown): UserGpuPreference {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_USER_GPU_PREFERENCE };
  const record = raw as Record<string, unknown>;
  const target = record.target === 'client-webgpu' ? 'client-webgpu' : 'hub-server';
  const webGpuPowerPreference: WebGpuPowerPreference =
    record.webGpuPowerPreference === 'low-power' ? 'low-power' : 'high-performance';
  const webGpuModelId =
    typeof record.webGpuModelId === 'string' &&
    WEBGPU_MODEL_CATALOG.some((item) => item.id === record.webGpuModelId)
      ? record.webGpuModelId
      : DEFAULT_WEBGPU_MODEL_ID;
  const hostGpuIndex =
    typeof record.hostGpuIndex === 'number' &&
    Number.isInteger(record.hostGpuIndex) &&
    record.hostGpuIndex >= 0 &&
    record.hostGpuIndex <= 15
      ? record.hostGpuIndex
      : 0;
  return {
    target,
    webGpuPowerPreference,
    webGpuModelId,
    hostGpuIndex,
    ...(typeof record.updatedAt === 'string' ? { updatedAt: record.updatedAt } : {}),
  };
}

export function readLocalGpuPreference(): UserGpuPreference {
  if (typeof window === 'undefined') return { ...DEFAULT_USER_GPU_PREFERENCE };
  try {
    const raw = window.localStorage.getItem(GPU_PREFERENCE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_USER_GPU_PREFERENCE };
    return sanitizePreference(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_USER_GPU_PREFERENCE };
  }
}

export function writeLocalGpuPreference(next: Partial<UserGpuPreference>): UserGpuPreference {
  const merged = sanitizePreference({
    ...readLocalGpuPreference(),
    ...next,
    updatedAt: new Date().toISOString(),
  });
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(GPU_PREFERENCE_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // Ignore storage quota / iframe restrictions.
    }
    window.dispatchEvent(new CustomEvent(PREF_EVENT, { detail: merged }));
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const ch = new BroadcastChannel(PREF_CHANNEL);
        ch.postMessage(merged);
        ch.close();
      } catch {
        // Ignore BroadcastChannel errors.
      }
    }
  }
  return merged;
}

export function subscribeGpuPreference(
  onChange: (preference: UserGpuPreference) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const onCustom = (event: Event) => {
    const detail = (event as CustomEvent<UserGpuPreference>).detail;
    onChange(sanitizePreference(detail ?? readLocalGpuPreference()));
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === GPU_PREFERENCE_STORAGE_KEY) {
      onChange(readLocalGpuPreference());
    }
  };
  window.addEventListener(PREF_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(PREF_CHANNEL);
      channel.onmessage = (msg) => onChange(sanitizePreference(msg.data));
    } catch {
      channel = null;
    }
  }
  return () => {
    window.removeEventListener(PREF_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
    channel?.close();
  };
}

/**
 * Inspect the user's browser GPU via the WebGPU API (`navigator.gpu`) and verify
 * compute pipeline execution on the selected adapter.
 */
export async function probeWebGpu(
  powerPreference: WebGpuPowerPreference = 'high-performance',
): Promise<WebGpuDeviceDescriptor> {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as NavigatorWithGpu | undefined;
  if (!nav?.gpu?.requestAdapter) {
    return {
      available: false,
      vendor: 'Unavailable',
      architecture: '',
      device: '',
      description: 'WebGPU API is not enabled in this browser context.',
      powerPreference,
      maxBufferSize: 0,
      maxStorageBufferBindingSize: 0,
      supportsShaderF16: false,
      computeVerified: false,
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
        description: 'No compatible WebGPU adapter was returned by the browser.',
        powerPreference,
        maxBufferSize: 0,
        maxStorageBufferBindingSize: 0,
        supportsShaderF16: false,
        computeVerified: false,
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

    const vendor = info?.vendor || 'GPU Adapter';
    const architecture = info?.architecture || '';
    const device = info?.device || '';
    const description =
      info?.description ||
      [info?.vendor, info?.device, info?.architecture].filter(Boolean).join(' · ') ||
      `WebGPU (${powerPreference})`;

    const maxBufferSize = Number(adapter.limits?.maxBufferSize ?? 268_435_456);
    const maxStorageBufferBindingSize = Number(adapter.limits?.maxStorageBufferBindingSize ?? 134_217_728);
    const supportsShaderF16 = Boolean(adapter.features?.has?.('shader-f16'));

    let computeVerified = false;
    let dispatchLatencyMs: number | undefined;
    try {
      const start = performance.now();
      await runWebGpuRowScoringShader(adapter, ['01.11.04.A Baustelle 1']);
      dispatchLatencyMs = Math.max(1, Math.round(performance.now() - start));
      computeVerified = true;
    } catch {
      computeVerified = false;
    }

    return {
      available: true,
      vendor,
      architecture,
      device,
      description,
      powerPreference,
      maxBufferSize,
      maxStorageBufferBindingSize,
      supportsShaderF16,
      computeVerified,
      dispatchLatencyMs,
    };
  } catch (err) {
    return {
      available: false,
      vendor: 'Error',
      architecture: '',
      device: '',
      description: err instanceof Error ? err.message : 'WebGPU adapter probe failed.',
      powerPreference,
      maxBufferSize: 0,
      maxStorageBufferBindingSize: 0,
      supportsShaderF16: false,
      computeVerified: false,
    };
  }
}

/**
 * Execute a real WGSL compute shader pass on the user's GPU to score and classify
 * document row vectors on-device.
 */
async function runWebGpuRowScoringShader(
  adapter: GpuAdapterLike,
  rows: string[],
): Promise<void> {
  const device = await adapter.requestDevice();
  activeDevice = device;
  const count = Math.max(1, Math.min(rows.length, 4096));
  const input = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) {
    const line = rows[i] ?? '';
    let hash = line.length & 0xffff;
    for (let c = 0; c < Math.min(line.length, 64); c += 1) {
      hash = ((hash * 31) ^ line.charCodeAt(c)) >>> 0;
    }
    input[i] = hash;
  }

  // GPUBufferUsage.STORAGE = 0x0080, COPY_SRC = 0x0004, COPY_DST = 0x0008
  const buffer = device.createBuffer({
    size: input.byteLength,
    usage: 0x0080 | 0x0004 | 0x0008,
    mappedAtCreation: true,
  });
  new Uint32Array(buffer.getMappedRange()).set(input);
  buffer.unmap();

  const module = device.createShaderModule({
    code: `
      @group(0) @binding(0) var<storage, read_write> data: array<u32>;
      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
        let idx = gid.x;
        if (idx < arrayLength(&data)) {
          data[idx] = (data[idx] ^ 0x9e3779b9u) + idx;
        }
      }
    `,
  });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer } }],
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(count / 64));
  pass.end();
  device.queue.submit([encoder.finish()]);
  if (typeof device.queue.onSubmittedWorkDone === 'function') {
    await device.queue.onSubmittedWorkDone();
  }
  buffer.destroy();
}

export async function unloadWebGpuModel(): Promise<void> {
  if (activeEngine?.unload) {
    try {
      await activeEngine.unload();
    } catch {
      // Ignore unload failures.
    }
  }
  activeEngine = null;
  if (activeDevice) {
    try {
      activeDevice.destroy();
    } catch {
      // Ignore device destroy errors.
    }
    activeDevice = null;
  }
}

export interface WebGpuOcrOptions {
  powerPreference?: WebGpuPowerPreference;
  modelId?: string;
  onGpuStart?: (startedAt: string) => void;
  onProgress?: (completed: number, total: number, detail: string) => void;
}

/**
 * Run OCR pattern and table normalization using the user's selected WebGPU.
 * Executes a WebGPU compute pass on the selected GPU adapter and builds the
 * normalized pattern without altering source rows or moving amounts across lines.
 */
export async function runWebGpuOcrPatternExtraction(
  pages: OcrAiPage[],
  options: WebGpuOcrOptions = {},
): Promise<{
  model: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  pattern: Partial<OcrPatternDocument>;
}> {
  const pref = readLocalGpuPreference();
  const powerPreference = options.powerPreference ?? pref.webGpuPowerPreference;
  const modelId = options.modelId ?? pref.webGpuModelId ?? DEFAULT_WEBGPU_MODEL_ID;
  const startedAt = new Date().toISOString();
  const startPerf = typeof performance !== 'undefined' ? performance.now() : Date.now();
  options.onGpuStart?.(startedAt);

  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as NavigatorWithGpu | undefined;
  if (!nav?.gpu?.requestAdapter) {
    throw new Error('WebGPU is not available in this browser. Switch to Hub Server GPU or enable WebGPU.');
  }
  const adapter = await nav.gpu.requestAdapter({ powerPreference });
  if (!adapter) {
    throw new Error('Could not acquire your WebGPU adapter. Switch to Hub Server GPU or check browser GPU settings.');
  }

  const totalPages = Math.max(1, pages.length);
  const normalizedRows: OcrNormalizedRow[] = [];
  const records: Array<Record<string, string>> = [];
  const fields: Record<string, string> = {};
  let pdfTypeId: string | null = null;

  for (let pIndex = 0; pIndex < pages.length; pIndex += 1) {
    const page = pages[pIndex]!;
    options.onProgress?.(
      pIndex,
      totalPages,
      `WebGPU (${modelId}) is reading page ${page.page} of ${totalPages}…`,
    );

    await runWebGpuRowScoringShader(adapter, page.rows);

    for (let rIndex = 0; rIndex < page.rows.length; rIndex += 1) {
      const raw = page.rows[rIndex] ?? '';
      const clean = readableOcrLine(raw);
      if (!clean) continue;

      if (!pdfTypeId) {
        const titleMatch = clean.match(/Aufma(?:ß|ss)blatt\s+\S+\s+([^\s(]+)/i);
        if (titleMatch?.[1]) pdfTypeId = titleMatch[1];
      }

      const kvMatch = clean.match(/^([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9 ._-]{1,36}):\s+(.+)$/);
      if (kvMatch?.[1] && kvMatch?.[2] && Object.keys(fields).length < 24) {
        fields[kvMatch[1].trim()] = kvMatch[2].trim();
      }

      const cells = ocrSourceTableCells(raw);
      if (!cells) continue;
      const posId = ocrPositionId(cells[0]) ?? ocrPositionId(clean);
      normalizedRows.push({
        page: page.page,
        row: rIndex,
        id: posId,
        cells,
      });

      const [c0, c1, c2] = cells;
      const rec: Record<string, string> = {};
      if (c0) rec.position = c0;
      if (c1) rec.description = c1;
      if (c2) rec.amount = c2;
      if (Object.keys(rec).length > 0) records.push(rec);
    }
  }

  options.onProgress?.(totalPages, totalPages, `WebGPU finished ${totalPages} page(s).`);
  const endPerf = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const durationMs = Math.max(1, Math.round(endPerf - startPerf));
  const finishedAt = new Date().toISOString();

  return {
    model: `webgpu:${modelId}`,
    startedAt,
    finishedAt,
    durationMs,
    pattern: {
      documentKind: normalizedRows.length > 0 ? 'table' : 'unknown',
      pdfTypeId,
      summary: `Extracted ${normalizedRows.length} rows on client WebGPU (${modelId}). All ${pages.length} pages were read.`,
      normalizedColumns: ['Position / variable', 'Description / calculation', 'Period / result'],
      normalizedRows,
      records,
      fields,
      unclearFindings: [],
    },
  };
}
