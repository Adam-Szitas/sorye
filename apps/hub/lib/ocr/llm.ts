import { getEnv } from '@/lib/env';
import { assertSafeLlmBaseUrl } from '@/lib/security';
import { OCR_PATTERN_SYSTEM_PROMPT } from './pattern';

const LLM_TIMEOUT_MS = 90_000;
const CONTEXT_TOKENS = 8192;
const OUTPUT_TOKENS = 1800;
const MAX_INPUT_BYTES = 6000;
/** How long Ollama may keep weights resident if the process dies mid-request. */
const OLLAMA_KEEP_ALIVE = '30s';

export function llmModelName(): string {
  const model = getEnv().OCR_LLM_MODEL.trim();
  if (
    model.length > 80 ||
    model.includes('..') ||
    !/^[\w./:-]+$/.test(model)
  ) {
    throw new Error('OCR_LLM_MODEL is invalid');
  }
  return model;
}

/** OpenAI-compatible chat route on the Qwen/Qwen3-8B container. */
export function llmChatUrl(): string {
  const base = assertSafeLlmBaseUrl(getEnv().OCR_LLM_BASE_URL);
  return new URL(getEnv().OCR_LLM_PROVIDER === 'ollama' ? '/api/chat' : '/v1/chat/completions', base).toString();
}

function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export function parseModelJson(text: string): unknown {
  const cleaned = stripThink(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    }
    throw new Error('Model did not return JSON');
  }
}

function classifyFailure(status: number, body: string): string {
  if (/model/i.test(body) && /not found|does not exist/i.test(body)) {
    return `Qwen3-8B is not loaded. ${startHint()}`;
  }
  if (status === 0 || status === 404) {
    return `Qwen3-8B is not reachable. ${startHint()}`;
  }
  return 'Qwen3-8B did not return a pattern. The rows are still stored.';
}

function startHint(): string {
  return getEnv().OCR_LLM_PROVIDER === 'ollama'
    ? 'Start: docker compose --profile qwen-local up -d qwen-local; then docker exec sorye-qwen-local ollama pull qwen3:8b'
    : 'Start: docker compose --profile qwen up -d qwen3';
}

async function postChat(url: string, body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    cache: 'no-store',
    redirect: 'error',
  });
}

function messageContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  return typeof message?.content === 'string' ? message.content : '';
}

/** Ask the local Qwen/Qwen3-8B server for one JSON object. */
export async function completeJson(user: string, parentSignal?: AbortSignal): Promise<unknown> {
  if (Buffer.byteLength(user) + Buffer.byteLength(OCR_PATTERN_SYSTEM_PROMPT) > MAX_INPUT_BYTES) {
    throw new Error('OCR model input exceeds the safe context budget.');
  }
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, AbortSignal.timeout(LLM_TIMEOUT_MS)])
    : AbortSignal.timeout(LLM_TIMEOUT_MS);
  signal.throwIfAborted();
  const ollama = getEnv().OCR_LLM_PROVIDER === 'ollama';
  const url = llmChatUrl();
  const model = llmModelName();
  const messages = [
    { role: 'system', content: OCR_PATTERN_SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
  const body: Record<string, unknown> = ollama ? {
    model, messages, stream: false, think: false, format: 'json', keep_alive: OLLAMA_KEEP_ALIVE,
    options: { temperature: 0.1, num_ctx: CONTEXT_TOKENS, num_predict: OUTPUT_TOKENS, num_batch: 128 },
  } : {
    model,
    messages,
    temperature: 0.1,
    max_tokens: OUTPUT_TOKENS,
    stream: false,
    response_format: { type: 'json_object' },
    chat_template_kwargs: { enable_thinking: false },
  };

  let response: Response;
  try {
    response = await postChat(url, body, signal);
    if (!ollama && response.status === 400) {
      const preview = (await response.clone().text()).slice(0, 400);
      if (/response_format|chat_template|enable_thinking|extra/i.test(preview)) {
        response = await postChat(url, {
          model,
          messages,
          temperature: 0.1,
          max_tokens: OUTPUT_TOKENS,
          stream: false,
          chat_template_kwargs: { enable_thinking: false },
        }, signal);
      }
    }
  } catch (err) {
    if (parentSignal?.aborted) {
      throw new Error('OCR analysis was cancelled or reached its time budget. Extracted rows are retained without a complete summary.');
    }
    const aborted = err instanceof Error && err.name === 'TimeoutError';
    console.error('[ocr] qwen unreachable', aborted ? 'timeout' : err);
    throw new Error(
      aborted
        ? 'Qwen3-8B took too long. The rows are still stored.'
        : `Qwen3-8B is not reachable. ${startHint()}`,
    );
  }

  if (!response.ok) {
    const errorBody = (await response.text()).slice(0, 500);
    console.error('[ocr] qwen status', response.status);
    throw new Error(classifyFailure(response.status, errorBody));
  }

  const payload = (await response.json()) as unknown;
  if (!payload || typeof payload !== 'object') throw new Error('Qwen returned an invalid response.');
  const native = payload as { message?: { content?: unknown }; done_reason?: string; choices?: Array<{ finish_reason?: string }> };
  if (native.done_reason === 'length' || native.choices?.[0]?.finish_reason === 'length') {
    throw new Error('Qwen reached its output limit. The extracted rows are retained; this summary is incomplete.');
  }
  const content = ollama && typeof native.message?.content === 'string'
    ? native.message.content : messageContent(payload);
  if (!content.trim()) {
    throw new Error('Qwen3-8B did not return a pattern. The rows are still stored.');
  }
  try {
    return parseModelJson(content);
  } catch (err) {
    console.error('[ocr] qwen invalid JSON');
    throw new Error('Qwen3-8B did not return a pattern. The rows are still stored.');
  }
}

/**
 * Drop Ollama's resident weights. vLLM keeps the model for the life of its
 * container, so this is a no-op for that provider.
 */
export async function releaseLoadedModel(): Promise<void> {
  if (getEnv().OCR_LLM_PROVIDER !== 'ollama') return;
  try {
    const base = assertSafeLlmBaseUrl(getEnv().OCR_LLM_BASE_URL);
    await fetch(new URL('/api/generate', base).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: llmModelName(), keep_alive: 0 }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
      redirect: 'error',
    });
  } catch (err) {
    console.error('[ocr] qwen unload', err instanceof Error ? err.message : err);
  }
}
