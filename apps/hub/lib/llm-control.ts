import { jsonDataFile } from '@/lib/store/json-file';
import { getEnv } from '@/lib/env';
import { assertSafeLlmBaseUrl } from '@/lib/security';

export type LlmProvider = 'ollama' | 'vllm';
export interface LlmControlSettings {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  contextLength: number;
  maxOutputTokens: number;
  minFreeVramMiB: number;
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

interface PersistedSettings { settings: LlmControlSettings | null }
interface RuntimeState {
  settings: LlmControlSettings;
  initialized: boolean;
  events: LlmActivity[];
}

const SETTINGS_FILE = jsonDataFile<PersistedSettings>('llm-control.json', () => ({ settings: null }));
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
    paused: false,
  };
}

function state(): RuntimeState {
  return globalState[STATE_KEY] ??= {
    settings: environmentSettings(), initialized: false, events: [],
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
  return { ...value, baseUrl: value.baseUrl.trim(), model: value.model.trim() };
}

export async function initializeLlmControl(): Promise<void> {
  const current = state();
  if (current.initialized) return;
  const stored = await SETTINGS_FILE.read();
  if (stored.settings) {
    try { current.settings = validateSettings(stored.settings); } catch { current.settings = environmentSettings(); }
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
