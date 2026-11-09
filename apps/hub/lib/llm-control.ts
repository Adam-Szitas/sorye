import { jsonDataFile } from '@/lib/store/json-file';
import { getEnv } from '@/lib/env';
import { assertSafeLlmBaseUrl } from '@/lib/security';
import {
  DEFAULT_USER_GPU_PREFERENCE,
  DEFAULT_WEBGPU_MODEL_ID,
  WEBGPU_MODEL_CATALOG,
  type UserGpuPreference,
} from '@sorye/types';

export type LlmProvider = 'ollama' | 'vllm';
export interface LlmControlSettings {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  contextLength: number;
  maxOutputTokens: number;
  minFreeVramMiB: number;
  gpuIndex?: number;
  paused: boolean;
}

export type LlmActivityType =
  | 'request_start'
  | 'request_success'
  | 'request_failure'
  | 'gpu_check'
  | 'gpu_rejected'
  | 'engine_probe'
  | 'model_unload'
  | 'settings_updated'
  | 'inference_paused'
  | 'inference_resumed';

export interface LlmActivity {
  id: string;
  at: string;
  type: LlmActivityType;
  provider?: LlmProvider;
  model?: string;
  status?: 'ok' | 'blocked' | 'error';
  durationMs?: number;
  inputBytes?: number;
  outputBytes?: number;
  gpuUsedMiB?: number;
  gpuFreeMiB?: number;
  gpuTotalMiB?: number;
  temperatureC?: number;
  detail?: string;
}

interface PersistedSettings {
  settings: LlmControlSettings | null;
  userGpuPreferences?: Record<string, UserGpuPreference>;
}
interface RuntimeState {
  settings: LlmControlSettings;
  userGpuPreferences: Record<string, UserGpuPreference>;
  initialized: boolean;
  events: LlmActivity[];
}

const SETTINGS_FILE = jsonDataFile<PersistedSettings>('llm-control.json', () => ({
  settings: null,
  userGpuPreferences: {},
}));
const STATE_KEY = Symbol.for('sorye.llm.control.state');
const globalState = globalThis as typeof globalThis & { [STATE_KEY]?: RuntimeState };

function environmentSettings(): LlmControlSettings {
  const env = getEnv();
  return {
    provider: env.OCR_LLM_PROVIDER === 'vllm' ? 'vllm' : 'ollama',
    baseUrl: env.OCR_LLM_PROVIDER ? env.OCR_LLM_BASE_URL ?? '' : '',
    model: env.OCR_LLM_PROVIDER ? env.OCR_LLM_MODEL ?? '' : '',
    contextLength: 8192,
    maxOutputTokens: 1800,
    minFreeVramMiB: 1536,
    gpuIndex: 0,
    paused: false,
  };
}

function state(): RuntimeState {
  return globalState[STATE_KEY] ??= {
    settings: environmentSettings(),
    userGpuPreferences: {},
    initialized: false,
    events: [],
  };
}

function validateSettings(value: LlmControlSettings): LlmControlSettings {
  if (!['ollama', 'vllm'].includes(value.provider)) throw new Error('Choose Ollama or vLLM.');
  if (value.baseUrl) assertSafeLlmBaseUrl(value.baseUrl);
  if (value.model && (value.model.length > 80 || value.model.includes('..') || !/^[\w./:-]+$/.test(value.model))) {
    throw new Error('Model name contains unsupported characters.');
  }
  if (!Number.isInteger(value.contextLength) || value.contextLength < 2048 || value.contextLength > 8192) {
    throw new Error('Context length must be between 2048 and 8192 tokens.');
  }
  if (!Number.isInteger(value.maxOutputTokens) || value.maxOutputTokens < 128 || value.maxOutputTokens > 1800) {
    throw new Error('Maximum output must be between 128 and 1800 tokens.');
  }
  if (!Number.isInteger(value.minFreeVramMiB) || value.minFreeVramMiB < 512 || value.minFreeVramMiB > 8192) {
    throw new Error('Free VRAM reserve must be between 512 and 8192 MiB.');
  }
  const gpuIndex = value.gpuIndex ?? 0;
  if (!Number.isInteger(gpuIndex) || gpuIndex < 0 || gpuIndex > 15) {
    throw new Error('GPU index must be an integer between 0 and 15.');
  }
  return { ...value, gpuIndex, baseUrl: value.baseUrl.trim(), model: value.model.trim() };
}

export function validateUserGpuPreference(raw: unknown): UserGpuPreference {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_USER_GPU_PREFERENCE };
  const record = raw as Record<string, unknown>;
  const target = record.target === 'client-webgpu' ? 'client-webgpu' : 'hub-server';
  const webGpuPowerPreference =
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
    updatedAt: new Date().toISOString(),
  };
}

export async function initializeLlmControl(): Promise<void> {
  const current = state();
  if (current.initialized) return;
  const stored = await SETTINGS_FILE.read();
  if (stored.settings) {
    try { current.settings = validateSettings(stored.settings); } catch { current.settings = environmentSettings(); }
  }
  if (stored.userGpuPreferences && typeof stored.userGpuPreferences === 'object') {
    current.userGpuPreferences = { ...stored.userGpuPreferences };
  }
  current.initialized = true;
}

export function getLlmControlSettings(): LlmControlSettings {
  const current = state();
  if (!current.initialized) current.settings = environmentSettings();
  return { ...current.settings };
}

export async function saveLlmControlSettings(settings: LlmControlSettings): Promise<LlmControlSettings> {
  const next = validateSettings(settings);
  await SETTINGS_FILE.update((stored) => { stored.settings = next; });
  state().settings = next;
  return { ...next };
}

export function getUserGpuPreference(userId: string): UserGpuPreference {
  const current = state();
  const existing = current.userGpuPreferences[userId];
  return existing ? { ...existing } : { ...DEFAULT_USER_GPU_PREFERENCE };
}

export async function saveUserGpuPreference(
  userId: string,
  preference: unknown,
): Promise<UserGpuPreference> {
  await initializeLlmControl();
  const next = validateUserGpuPreference(preference);
  await SETTINGS_FILE.update((stored) => {
    stored.userGpuPreferences ??= {};
    stored.userGpuPreferences[userId] = next;
  });
  state().userGpuPreferences[userId] = next;
  return { ...next };
}

export async function setLlmInferencePaused(paused: boolean): Promise<void> {
  await saveLlmControlSettings({ ...getLlmControlSettings(), paused });
  logLlmActivity({
    type: paused ? 'inference_paused' : 'inference_resumed',
    status: 'ok',
    detail: paused ? 'New model requests are paused.' : 'New model requests are allowed.',
  });
}

export function logLlmActivity(event: Omit<LlmActivity, 'id' | 'at'>): void {
  const current = state();
  current.events.unshift({ ...event, id: crypto.randomUUID(), at: new Date().toISOString() });
  if (current.events.length > 500) current.events.length = 500;
}

export function getLlmActivity(limit = 100): LlmActivity[] {
  return state().events.slice(0, Math.max(1, Math.min(200, limit))).map((event) => ({ ...event }));
}
