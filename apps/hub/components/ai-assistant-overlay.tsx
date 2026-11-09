'use client';

import {
  probeWebGpu,
  readLocalGpuPreference,
  subscribeGpuPreference,
  unloadWebGpuModel,
  writeLocalGpuPreference,
} from '@sorye/platform';
import {
  APP_CATALOG,
  DEFAULT_USER_GPU_PREFERENCE,
  WEBGPU_MODEL_CATALOG,
  type AppCatalogEntry,
  type HostGpuDescriptor,
  type LlmExecutionTarget,
  type McpActionCard,
  type McpChatEngine,
  type McpChatMessage,
  type McpToolCallResult,
  type McpToolDescriptor,
  type UserGpuPreference,
  type WebGpuDeviceDescriptor,
  type WebGpuPowerPreference,
} from '@sorye/types';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface AiAssistantOverlayProps {
  open: boolean;
  activeAppId: string | null;
  workspaceName: string;
  workspaceKind: 'personal' | 'team';
  ownedByUser: boolean;
  onClose: () => void;
  onOpenApp: (app: AppCatalogEntry, side?: 'left' | 'right') => void;
  onOpenPicker: () => void;
  onSwitchWorkspace: (workspaceId: string) => Promise<void>;
}

type QuickStarter = { label: string; prompt: string; tool?: string };

const QUICK_STARTER_GROUPS: ReadonlyArray<{ title: string; starters: readonly QuickStarter[] }> = [
  {
    title: 'Work',
    starters: [
      { label: 'Find code 01.11.04.A', prompt: 'Find code 01.11.04.A', tool: 'ocr.search_stored_tables' },
      { label: 'Amounts > 50 000', prompt: 'Stored tables with amount greater than 50000', tool: 'ocr.search_stored_tables' },
      { label: 'List my tasks', prompt: 'List my tasks', tool: 'tasks.list' },
      { label: 'Recent Drive files', prompt: 'Show recent Drive files', tool: 'files.list_recent' },
    ],
  },
  {
    title: 'Personal & general',
    starters: [
      { label: 'Does this belong to me or my team?', prompt: 'Does this workspace belong to me or my team?' },
      { label: 'My day', prompt: 'My day' },
      {
        label: 'Quick note + task',
        prompt: 'Quick note: call the plumber about the leak + task: book plumber visit',
        tool: 'personal.quick_capture',
      },
      { label: 'Switch workspace', prompt: 'List my workspaces' },
      { label: 'What can you do?', prompt: 'What can you do?' },
    ],
  },
];

const ENGINE_LABEL: Record<McpChatEngine, string> = {
  tools: 'Sorye MCP tools',
  'server-llm': 'server model',
  'built-in': 'built-in',
};

export function AiAssistantOverlay({
  open,
  activeAppId,
  workspaceName,
  workspaceKind,
  ownedByUser,
  onClose,
  onOpenApp,
  onOpenPicker,
  onSwitchWorkspace,
}: AiAssistantOverlayProps) {
  const scopeLabel =
    workspaceKind === 'personal' ? 'Personal' : ownedByUser ? 'Team · owned by you' : 'Team · member';
  const [preference, setPreference] = useState<UserGpuPreference>(DEFAULT_USER_GPU_PREFERENCE);
  const [webGpu, setWebGpu] = useState<WebGpuDeviceDescriptor | null>(null);
  const [hostGpus, setHostGpus] = useState<HostGpuDescriptor[]>([]);
  const [tools, setTools] = useState<McpToolDescriptor[]>([]);
  const [showTools, setShowTools] = useState(false);
  const [messages, setMessages] = useState<McpChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [gpuNotice, setGpuNotice] = useState<string | null>(null);

  const loadContext = useCallback(async () => {
    const localPref = readLocalGpuPreference();
    setPreference(localPref);
    void probeWebGpu(localPref.webGpuPowerPreference).then(setWebGpu);

    try {
      const [toolsRes, prefRes] = await Promise.all([
        fetch('/api/mcp/tools', { cache: 'no-store' }),
        fetch('/api/llm/preferences', { cache: 'no-store' }),
      ]);
      if (toolsRes.ok) {
        const data = (await toolsRes.json()) as {
          tools?: McpToolDescriptor[];
          gpuPreference?: UserGpuPreference;
        };
        setTools(data.tools ?? []);
      }
      if (prefRes.ok) {
        const data = (await prefRes.json()) as {
          preference?: UserGpuPreference;
          hostGpus?: HostGpuDescriptor[];
        };
        if (data.hostGpus) setHostGpus(data.hostGpus);
        if (data.preference) {
          const synced = writeLocalGpuPreference(data.preference);
          setPreference(synced);
        }
      }
    } catch {
      // Keep local preference if server is temporarily unreachable.
    }
  }, []);

  useEffect(() => {
    void loadContext();
    return subscribeGpuPreference((next) => {
      setPreference(next);
      void probeWebGpu(next.webGpuPowerPreference).then(setWebGpu);
    });
  }, [loadContext]);

  useEffect(() => {
    if (!open) return;
    void loadContext();
  }, [open, loadContext]);

  async function updateGpuPreference(patch: Partial<UserGpuPreference>) {
    const next = writeLocalGpuPreference(patch);
    setPreference(next);
    setGpuNotice(
      next.target === 'client-webgpu'
        ? `Using your browser WebGPU (${next.webGpuModelId})`
        : `Using Hub Server GPU #${next.hostGpuIndex}`,
    );
    if (patch.webGpuPowerPreference) {
      const probed = await probeWebGpu(patch.webGpuPowerPreference);
      setWebGpu(probed);
    }
    try {
      await fetch('/api/llm/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
    } catch {
      // Local preference is already saved.
    }
  }

  async function handleUnloadWebGpu() {
    await unloadWebGpuModel();
    setGpuNotice('Unloaded browser WebGPU buffers and weights.');
  }

  async function sendPrompt(promptText: string) {
    const trimmed = promptText.trim();
    if (!trimmed || busy) return;
    const userMessage: McpChatMessage = {
      id: `msg-${Date.now()}-u`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setBusy(true);

    try {
      let webGpuLatency = 0;
      if (preference.target === 'client-webgpu') {
        const probed = await probeWebGpu(preference.webGpuPowerPreference);
        setWebGpu(probed);
        webGpuLatency = probed.dispatchLatencyMs ?? 0;
      }

      const res = await fetch('/api/mcp/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmed,
          activeAppId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        reply?: string;
        traces?: McpChatMessage['traces'];
        actions?: McpActionCard[];
        executionTarget?: LlmExecutionTarget;
        engine?: McpChatEngine;
        model?: string;
        durationMs?: number;
      };
      const assistantMessage: McpChatMessage = {
        id: `msg-${Date.now()}-a`,
        role: 'assistant',
        content: res.ok
          ? (data.reply ?? 'Completed.')
          : (data.error ?? 'Could not process request.'),
        createdAt: new Date().toISOString(),
        executionTarget: preference.target,
        engine: res.ok ? data.engine : undefined,
        model: data.model,
        durationMs: (data.durationMs ?? 1) + webGpuLatency,
        traces: data.traces,
        actions: data.actions,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-err`,
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Assistant request failed.',
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function handleAction(action: McpActionCard) {
    if (action.kind === 'open-picker') {
      onOpenPicker();
      return;
    }
    if (action.kind === 'switch-workspace' && action.workspaceId) {
      setBusy(true);
      try {
        await onSwitchWorkspace(action.workspaceId);
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}-switch`,
            role: 'assistant',
            content: `Switched to ${action.workspaceName ?? 'the selected workspace'}. Tasks, Notes, Calendar, OCR and Drive now show that workspace; your GPU choice stays the same.`,
            createdAt: new Date().toISOString(),
            engine: 'tools',
          },
        ]);
        void loadContext();
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}-switch-err`,
            role: 'assistant',
            content: 'Could not switch workspace. Try the workspace switcher in the top bar.',
            createdAt: new Date().toISOString(),
          },
        ]);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (action.kind === 'open-app' && action.appId) {
      const entry = APP_CATALOG.find((app) => app.id === action.appId);
      if (entry) {
        onOpenApp(entry, action.pane ?? 'left');
      }
      return;
    }
    if (action.kind === 'confirm-tool' && action.toolName) {
      setBusy(true);
      try {
        const res = await fetch('/api/mcp/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toolName: action.toolName,
            arguments: action.toolArgs ?? {},
            confirmed: true,
          }),
        });
        const data = (await res.json()) as McpToolCallResult;
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}-confirm`,
            role: 'assistant',
            content: data.message,
            createdAt: new Date().toISOString(),
            executionTarget: preference.target,
            engine: 'tools',
            traces: [data.trace],
            actions: data.actions,
          },
        ]);
      } finally {
        setBusy(false);
      }
    }
  }

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    void sendPrompt(input);
  }

  if (!open) return null;

  return (
    <aside
      aria-label="Sorye AI & MCP Assistant"
      className="fixed bottom-4 right-4 top-16 z-50 flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b0f17]/95 text-[#f1f5f9] shadow-2xl backdrop-blur-xl sm:right-6"
    >
      <header className="flex items-center justify-between border-b border-white/10 bg-[#121826] px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-sky-400" aria-hidden />
            <h2 className="text-sm font-semibold">Sorye MCP Assistant</h2>
          </div>
          <p className="text-[11px] text-[#94a3b8]">
            Permission-scoped · Hub events → Rodrigo Rust backend
          </p>
          <span
            className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-md border border-white/10 bg-[#0b0f17] px-2 py-0.5 text-[10px] text-[#cbd5e1]"
            title="Active workspace — Tasks, Notes, Calendar, OCR and Drive belong to it"
          >
            <span className="truncate font-medium text-white">{workspaceName}</span>
            <span aria-hidden>·</span>
            <span className={workspaceKind === 'personal' ? 'text-emerald-300' : 'text-sky-300'}>
              {scopeLabel}
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2.5 py-1 text-xs text-[#94a3b8] hover:bg-white/10 hover:text-white"
        >
          Close
        </button>
      </header>

      {/* GPU Selection & WebGPU Status Bar */}
      <section
        aria-label="GPU selection"
        className="border-b border-white/10 bg-[#121826]/70 px-4 py-2.5 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-[#94a3b8]">Execution GPU</span>
          <div className="flex rounded-lg border border-white/10 bg-[#0b0f17] p-0.5">
            <button
              type="button"
              onClick={() => void updateGpuPreference({ target: 'client-webgpu' })}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                preference.target === 'client-webgpu'
                  ? 'bg-sky-400 text-[#0b0f17]'
                  : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              My GPU (WebGPU)
            </button>
            <button
              type="button"
              onClick={() => void updateGpuPreference({ target: 'hub-server' })}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                preference.target === 'hub-server'
                  ? 'bg-sky-400 text-[#0b0f17]'
                  : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              Hub Server GPU
            </button>
          </div>
        </div>

        {preference.target === 'client-webgpu' ? (
          <div className="mt-2 space-y-1.5 rounded-lg border border-white/10 bg-[#0b0f17] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-[#f1f5f9]">
                {webGpu?.available
                  ? `WebGPU ready · ${webGpu.description}${webGpu.dispatchLatencyMs ? ` (${webGpu.dispatchLatencyMs}ms)` : ''}`
                  : (webGpu?.description ?? 'Checking navigator.gpu…')}
              </span>
              <button
                type="button"
                onClick={() => void handleUnloadWebGpu()}
                className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-[#94a3b8] hover:bg-white/10 hover:text-white"
              >
                Free VRAM
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <label className="flex flex-col gap-0.5 text-[10px] text-[#94a3b8]">
                Adapter profile
                <select
                  aria-label="WebGPU power preference"
                  value={preference.webGpuPowerPreference}
                  onChange={(e) =>
                    void updateGpuPreference({
                      webGpuPowerPreference: e.target.value as WebGpuPowerPreference,
                    })
                  }
                  className="rounded border border-white/15 bg-[#121826] px-1.5 py-1 text-[11px] text-white"
                >
                  <option value="high-performance">Discrete (High performance)</option>
                  <option value="low-power">Integrated (Low power)</option>
                </select>
              </label>
              <label className="flex flex-col gap-0.5 text-[10px] text-[#94a3b8]">
                WebGPU Model
                <select
                  aria-label="WebGPU model"
                  value={preference.webGpuModelId}
                  onChange={(e) =>
                    void updateGpuPreference({ webGpuModelId: e.target.value })
                  }
                  className="rounded border border-white/15 bg-[#121826] px-1.5 py-1 text-[11px] text-white"
                >
                  {WEBGPU_MODEL_CATALOG.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#0b0f17] px-2.5 py-1.5 text-[11px]">
            <span className="text-[#94a3b8]">
              {hostGpus.length > 0
                ? `Host GPU #${preference.hostGpuIndex}: ${hostGpus.find((g) => g.index === preference.hostGpuIndex)?.name ?? hostGpus[0]?.name} · Qwen3-8B`
                : 'Hub Server · Qwen/Qwen3-8B'}
            </span>
            {hostGpus.length > 1 ? (
              <select
                aria-label="Host GPU index"
                value={preference.hostGpuIndex}
                onChange={(e) =>
                  void updateGpuPreference({ hostGpuIndex: Number(e.target.value) })
                }
                className="rounded border border-white/15 bg-[#121826] px-1.5 py-0.5 text-[11px] text-white"
              >
                {hostGpus.map((gpu) => (
                  <option key={gpu.index} value={gpu.index}>
                    GPU #{gpu.index} · {gpu.name} ({gpu.freeMiB} MiB free)
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        )}

        {gpuNotice ? (
          <p className="mt-1.5 text-[11px] text-sky-300" role="status">
            {gpuNotice}
          </p>
        ) : null}

        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-[#94a3b8]">
            {tools.length} permitted MCP tools for your role
          </span>
          <button
            type="button"
            onClick={() => setShowTools((prev) => !prev)}
            className="text-[11px] text-sky-300 hover:underline"
          >
            {showTools ? 'Hide tools' : 'Inspect tools'}
          </button>
        </div>

        {showTools ? (
          <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-[#0b0f17] p-2 text-[11px]">
            {tools.map((tool) => (
              <li key={tool.name} className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-sky-300">{tool.name}</span>
                  <p className="text-[10px] text-[#94a3b8]">{tool.title}</p>
                </div>
                {tool.rodrigoBacked ? (
                  <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-300">
                    Rodrigo
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* Conversation Body */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-xs">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="leading-relaxed text-[#94a3b8]">
              Ask about your work data, plan your day, capture notes and tasks, or ask any general question.
            </p>
            {QUICK_STARTER_GROUPS.map((group) => {
              const starters = group.starters.filter(
                (starter) => !starter.tool || tools.length === 0 || tools.some((t) => t.name === starter.tool),
              );
              if (starters.length === 0) return null;
              return (
                <div key={group.title} className="space-y-1.5">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[#64748b]">
                    {group.title}
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {starters.map((starter) => (
                      <button
                        key={starter.label}
                        type="button"
                        onClick={() => void sendPrompt(starter.prompt)}
                        className="rounded-lg border border-white/10 bg-[#121826] px-2.5 py-1.5 text-left text-[11px] text-[#f1f5f9] transition hover:border-sky-400/50 hover:bg-[#1a2233]"
                      >
                        {starter.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {messages.map((msg) => (
          <article
            key={msg.id}
            className={`rounded-xl p-3 ${
              msg.role === 'user'
                ? 'ml-8 bg-sky-500/15 text-[#f1f5f9]'
                : 'mr-4 border border-white/10 bg-[#121826] text-[#f1f5f9]'
            }`}
          >
            <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
            {msg.role === 'assistant' && msg.engine ? (
              <p className="mt-1.5 text-[10px] text-[#64748b]">
                Answered by{' '}
                {msg.engine === 'server-llm' && msg.model
                  ? `server model ${msg.model}`
                  : ENGINE_LABEL[msg.engine]}
                {msg.durationMs ? ` · ${msg.durationMs}ms` : ''}
              </p>
            ) : null}
            {msg.traces && msg.traces.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1 border-t border-white/10 pt-2">
                {msg.traces.map((trace, index) => (
                  <span
                    key={`${trace.toolName}-${index}`}
                    className="rounded bg-[#0b0f17] px-2 py-0.5 text-[10px] text-[#94a3b8]"
                  >
                    {trace.summary} · {trace.routedVia} ({trace.durationMs}ms)
                  </span>
                ))}
              </div>
            ) : null}
            {msg.actions && msg.actions.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {msg.actions.map((act, index) => (
                  <button
                    key={`${act.label}-${index}`}
                    type="button"
                    onClick={() => void handleAction(act)}
                    className="rounded-lg bg-sky-400 px-2.5 py-1 text-[11px] font-semibold text-[#0b0f17] transition hover:bg-sky-300"
                  >
                    {act.label}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {/* Prompt Input */}
      <form
        onSubmit={handleFormSubmit}
        className="flex items-center gap-2 border-t border-white/10 bg-[#121826] p-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything, e.g. “My day” or “How do I use Calendar?”"
          className="flex-1 rounded-lg border border-white/15 bg-[#0b0f17] px-3 py-2 text-xs text-white placeholder-[#94a3b8]"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-lg bg-sky-400 px-3 py-2 text-xs font-semibold text-[#0b0f17] disabled:opacity-50"
        >
          {busy ? '…' : 'Send'}
        </button>
      </form>
    </aside>
  );
}
