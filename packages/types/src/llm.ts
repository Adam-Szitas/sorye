/** Shared GPU, WebGPU, LLM runtime, and Hub MCP assistant contracts. */

export type LlmExecutionTarget = 'client-webgpu' | 'hub-server';

export type WebGpuPowerPreference = 'high-performance' | 'low-power';

export interface WebGpuDeviceDescriptor {
  available: boolean;
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  powerPreference: WebGpuPowerPreference;
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
  supportsShaderF16: boolean;
  computeVerified?: boolean;
  dispatchLatencyMs?: number;
}

export interface HostGpuDescriptor {
  index: number;
  name: string;
  usedMiB: number;
  freeMiB: number;
  totalMiB: number;
  temperatureC: number;
}

export interface UserGpuPreference {
  target: LlmExecutionTarget;
  webGpuPowerPreference: WebGpuPowerPreference;
  webGpuModelId: string;
  hostGpuIndex: number;
  updatedAt?: string;
}

export const DEFAULT_WEBGPU_MODEL_ID = 'Qwen2.5-3B-Instruct-q4f16_1-MLC';

export const WEBGPU_MODEL_CATALOG: ReadonlyArray<{
  id: string;
  label: string;
  vramMiB: number;
  requiresShaderF16: boolean;
  summary: string;
}> = [
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 3B Instruct (WebGPU q4f16)',
    vramMiB: 2200,
    requiresShaderF16: false,
    summary: 'Fast browser WebGPU assistant & OCR table normalizer (~2.2 GB VRAM).',
  },
  {
    id: 'Qwen3-4B-q4f16_1-MLC',
    label: 'Qwen 3 4B (WebGPU q4f16)',
    vramMiB: 3100,
    requiresShaderF16: true,
    summary: 'Higher-capacity multilingual WebGPU model for 8 GB+ discrete GPUs.',
  },
] as const;

export const DEFAULT_USER_GPU_PREFERENCE: UserGpuPreference = {
  target: 'hub-server',
  webGpuPowerPreference: 'high-performance',
  webGpuModelId: DEFAULT_WEBGPU_MODEL_ID,
  hostGpuIndex: 0,
};

export const GPU_PREFERENCE_STORAGE_KEY = 'sorye:llm:gpu-preference:v1';

/** Hub MCP tool descriptor returned by GET /api/mcp/tools (permission-filtered). */
export interface McpToolDescriptor {
  name: string;
  appId: string;
  title: string;
  description: string;
  requiresAdmin?: boolean;
  requiresConfirmation?: boolean;
  rodrigoBacked?: boolean;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

export interface McpActionCard {
  kind:
    | 'open-app'
    | 'open-picker'
    | 'confirm-tool'
    | 'handoff-created'
    | 'ocr-matches'
    | 'switch-workspace';
  label: string;
  appId?: string;
  pane?: 'left' | 'right';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  handoffId?: string;
  workspaceId?: string;
  workspaceName?: string;
  workspaceKind?: 'personal' | 'team';
}

export interface McpToolTrace {
  toolName: string;
  appId: string;
  status: 'executed' | 'confirmation_required' | 'denied' | 'error';
  summary: string;
  routedVia: 'rodrigo-signed' | 'hub-event-router' | 'hub-session';
  eventEmitted?: string;
  durationMs: number;
}

export interface McpToolCallResult {
  ok: boolean;
  toolName: string;
  requiresConfirmation?: boolean;
  message: string;
  data?: unknown;
  trace: McpToolTrace;
  actions?: McpActionCard[];
}

/** Who produced an assistant reply: routed MCP tools, the server model, or the built-in responder. */
export type McpChatEngine = 'tools' | 'server-llm' | 'built-in';

export interface McpChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  executionTarget?: LlmExecutionTarget;
  engine?: McpChatEngine;
  model?: string;
  durationMs?: number;
  traces?: McpToolTrace[];
  actions?: McpActionCard[];
}
