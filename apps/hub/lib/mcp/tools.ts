import { randomUUID } from 'node:crypto';
import {
  APP_CATALOG,
  SUBSCRIPTION_PLANS,
  getPlanById,
  selectableAppCount,
  withAlwaysAvailableAppIds,
  type AppCatalogEntry,
  type CalendarEvent,
  type HubSession,
  type McpActionCard,
  type McpChatEngine,
  type McpToolCallResult,
  type McpToolDescriptor,
  type OcrAmountOp,
  type TasksBoard,
} from '@sorye/types';
import { z } from 'zod';
import { getUserGpuPreference } from '@/lib/llm-control';
import { completeChat, llmModelName } from '@/lib/ocr/llm';
import { isPlatformAdmin } from '@/lib/platform-admin';
import {
  createDefaultMcpHubBridge,
  readCalendarViaBridge,
  readNotesViaBridge,
  readTasksBoardViaBridge,
  type McpHubBridge,
} from './dispatcher';
import {
  McpPermissionError,
  allowedAppIdsForSession,
  assertMcpToolPermission,
  filterPermittedMcpTools,
} from './permissions';
import { buildMcpAssistantContextPrompt } from './system-prompt';

export const MCP_TOOLS: readonly McpToolDescriptor[] = [
  {
    name: 'ocr.search_stored_tables',
    appId: 'ocr',
    title: 'Search stored OCR tables',
    description:
      'Search the latest 50 stored PDF extractions by UTC date range, table name, JSON field notations, position code, and numeric amount comparisons (> 50 000, < 25 000, etc.).',
    parameters: {
      from: { type: 'string', description: 'UTC start date (YYYY-MM-DD)' },
      to: { type: 'string', description: 'UTC end date (YYYY-MM-DD)' },
      name: { type: 'string', description: 'Substring of the stored PDF or table name' },
      code: { type: 'string', description: 'Position code or value substring (e.g. 01.11.04.A or 26-01579)' },
      notations: { type: 'array', description: 'Field or record key names (e.g. ["amount", "fields.Total"])' },
      amountNotation: { type: 'string', description: 'Field/column name for numeric comparison (e.g. amount)' },
      amountOp: { type: 'string', description: 'Comparison operator: gt, gte, lt, lte, eq' },
      amountValue: { type: 'number', description: 'Numeric threshold (e.g. 50000 or 25000)' },
      scope: { type: 'string', description: '"document" (whole table) or "fields" (matching fields/rows only)' },
    },
  },
  {
    name: 'ocr.get_reading_summary',
    appId: 'ocr',
    title: 'Summarize a stored OCR reading',
    description:
      'Read fields, normalized rows, position codes, and units (m², PA, kg) from a stored OCR extraction ID.',
    parameters: {
      id: { type: 'string', description: 'Stored OCR analysis ID (ocr-...)', required: true },
    },
  },
  {
    name: 'ocr.rename_table',
    appId: 'ocr',
    title: 'Rename a stored OCR table',
    description: 'Set a clear custom table name on a stored PDF extraction.',
    parameters: {
      id: { type: 'string', description: 'Stored OCR analysis ID (ocr-...)', required: true },
      fileName: { type: 'string', description: 'New display name for the table', required: true },
    },
  },
  {
    name: 'ocr.handoff_to_protocolio',
    appId: 'ocr',
    title: 'Send OCR table to Protocolio',
    description:
      'Create a Hub handoff from a stored OCR table to Protocolio and open Protocolio in the workspace.',
    parameters: {
      id: { type: 'string', description: 'Stored OCR analysis ID (ocr-...)', required: true },
    },
  },
  {
    name: 'tasks.list',
    appId: 'tasks',
    title: 'List workspace tasks',
    description:
      'Read the workspace Tasks board (redirected through Sorye Hub to Rodrigo) and filter by status or keyword.',
    rodrigoBacked: true,
    parameters: {
      query: { type: 'string', description: 'Optional keyword in task title or body' },
      statusId: { type: 'string', description: 'Optional status column ID or name' },
    },
  },
  {
    name: 'tasks.create',
    appId: 'tasks',
    title: 'Create a task',
    description:
      'Add a new task card to the workspace Tasks board via Sorye Hub → Rodrigo and emit sorye.task.created.',
    rodrigoBacked: true,
    parameters: {
      title: { type: 'string', description: 'Task title', required: true },
      body: { type: 'string', description: 'Task details or reference codes' },
      statusId: { type: 'string', description: 'Target column ID (defaults to To do)' },
    },
  },
  {
    name: 'tasks.move',
    appId: 'tasks',
    title: 'Move a task between columns',
    description:
      'Move an existing task to another board status column via Sorye Hub → Rodrigo and emit sorye.task.moved.',
    rodrigoBacked: true,
    parameters: {
      taskId: { type: 'string', description: 'Task ID or title match', required: true },
      statusId: { type: 'string', description: 'Target status ID or column name (e.g. Done, In progress)', required: true },
    },
  },
  {
    name: 'tasks.complete',
    appId: 'tasks',
    title: 'Complete a task',
    description:
      'Move a task to the Done column via Sorye Hub → Rodrigo and emit sorye.task.moved.',
    rodrigoBacked: true,
    parameters: {
      taskId: { type: 'string', description: 'Task ID or title match', required: true },
    },
  },
  {
    name: 'tasks.delete',
    appId: 'tasks',
    title: 'Delete a task',
    description:
      'Remove a task from the workspace Tasks board via Sorye Hub → Rodrigo (requires confirmation) and emit sorye.task.updated.',
    rodrigoBacked: true,
    requiresConfirmation: true,
    parameters: {
      taskId: { type: 'string', description: 'Task ID or title match', required: true },
    },
  },
  {
    name: 'calendar.list_upcoming',
    appId: 'calendar',
    title: 'List upcoming calendar events',
    description:
      'Read upcoming events from the workspace Calendar via Sorye Hub → Rodrigo.',
    rodrigoBacked: true,
    parameters: {
      from: { type: 'string', description: 'Optional UTC start date (YYYY-MM-DD)' },
      to: { type: 'string', description: 'Optional UTC end date (YYYY-MM-DD)' },
    },
  },
  {
    name: 'calendar.schedule_event',
    appId: 'calendar',
    title: 'Schedule a calendar event',
    description:
      'Create a timed or all-day event on the workspace Calendar via Sorye Hub → Rodrigo and emit sorye.calendar.saved.',
    rodrigoBacked: true,
    parameters: {
      title: { type: 'string', description: 'Event title', required: true },
      date: { type: 'string', description: 'UTC date (YYYY-MM-DD)', required: true },
      startTime: { type: 'string', description: 'Optional 24h start time (HH:MM)' },
      endTime: { type: 'string', description: 'Optional 24h end time (HH:MM)' },
    },
  },
  {
    name: 'notes.search',
    appId: 'notes',
    title: 'Search workspace notes',
    description:
      'Search workspace Notes by title or body via Sorye Hub → Rodrigo.',
    rodrigoBacked: true,
    parameters: {
      query: { type: 'string', description: 'Search text (empty returns recent notes)' },
    },
  },
  {
    name: 'notes.create_or_append',
    appId: 'notes',
    title: 'Save a workspace note',
    description:
      'Create a new note or append findings in workspace Notes via Sorye Hub → Rodrigo and emit sorye.notes.saved.',
    rodrigoBacked: true,
    parameters: {
      title: { type: 'string', description: 'Note title', required: true },
      body: { type: 'string', description: 'Note content', required: true },
    },
  },
  {
    name: 'personal.quick_capture',
    appId: 'notes',
    title: 'Quick capture (note + optional task)',
    description:
      'Save a note in workspace Notes and, if Tasks is enabled, add a matching task in one step (via Sorye Hub → Rodrigo).',
    rodrigoBacked: true,
    parameters: {
      note: { type: 'string', description: 'Note text to save', required: true },
      title: { type: 'string', description: 'Optional note title (defaults to the first words of the note)' },
      task: { type: 'string', description: 'Optional task title to add to To do' },
    },
  },
  {
    name: 'files.list_recent',
    appId: 'files',
    title: 'List recent Drive files',
    description: 'List the most recently updated files in the workspace Drive through the Hub files library.',
    parameters: {
      query: { type: 'string', description: 'Optional file-name substring' },
      limit: { type: 'number', description: 'Maximum files to list (1-20, default 8)' },
    },
  },
  {
    name: 'messenger.post_update',
    appId: 'messenger',
    title: 'Post update to Messenger',
    description:
      'Post a workspace update into Messenger through the Hub event spine (requires confirmation).',
    requiresConfirmation: true,
    parameters: {
      title: { type: 'string', description: 'Update headline', required: true },
      summary: { type: 'string', description: 'Message body', required: true },
    },
  },
  {
    name: 'hub.explain_workspace',
    appId: 'hub',
    title: 'Explain workspace, apps, GPU & Rodrigo status',
    description:
      'Show installed apps, subscription limits, active GPU target (WebGPU vs Hub Server), and Rodrigo backend capabilities.',
    parameters: {},
  },
  {
    name: 'hub.whoami',
    appId: 'hub',
    title: 'Who am I & who owns this workspace',
    description:
      'Explain from the signed-in session who you are, whether the active workspace is personal or team, whether you own it or are a member, and which settings are per-user (GPU) vs workspace-scoped (OCR, Tasks, Notes, Calendar, Drive).',
    parameters: {},
  },
  {
    name: 'hub.my_day_briefing',
    appId: 'hub',
    title: 'My day briefing',
    description:
      'Summarize open tasks, calendar events for today and the next 7 days, latest notes, and latest OCR readings for the enabled apps in the active workspace.',
    parameters: {},
  },
  {
    name: 'hub.switch_workspace',
    appId: 'hub',
    title: 'Switch workspace',
    description:
      'List your personal and team workspaces and offer a switch card; the switch itself goes through the authorized Hub workspace route.',
    parameters: {
      workspace: { type: 'string', description: 'Optional workspace name or ID to switch to' },
    },
  },
  {
    name: 'hub.open_app',
    appId: 'hub',
    title: 'Open an app in the Hub split workspace',
    description: 'Open any enabled Sorye app in the left or right workspace pane.',
    parameters: {
      appId: { type: 'string', description: 'Catalog app ID or slug (e.g. ocr, tasks, calendar, notes, dashboard)', required: true },
      pane: { type: 'string', description: '"left" or "right" pane (default "left")' },
    },
  },
  {
    name: 'backend.topology',
    appId: 'hub',
    title: 'Inspect Rodrigo backend topology (Admin)',
    description:
      'Query Rodrigo /v1/topology with a signed Ed25519 Hub assertion (platform admins only).',
    requiresAdmin: true,
    rodrigoBacked: true,
    parameters: {},
  },
] as const;

export function listMcpToolsForSession(session: HubSession): McpToolDescriptor[] {
  return filterPermittedMcpTools(session, MCP_TOOLS);
}

export interface WorkspaceOwnershipFacts {
  userName: string;
  email: string;
  role: 'platform-admin' | 'member';
  workspaceId: string;
  workspaceName: string;
  kind: 'personal' | 'team';
  isOwner: boolean;
  memberCount: number;
  otherWorkspaces: Array<{ id: string; name: string; kind: 'personal' | 'team' }>;
}

export function workspaceOwnershipFacts(session: HubSession): WorkspaceOwnershipFacts {
  const { user, workspace } = session;
  const members = new Set([workspace.ownerId, ...(workspace.memberIds ?? [])].filter(Boolean));
  return {
    userName: user.displayName,
    email: user.email,
    role: isPlatformAdmin(user) ? 'platform-admin' : 'member',
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    kind: workspace.kind,
    isOwner: workspace.ownerId === user.id,
    memberCount: Math.max(1, members.size),
    otherWorkspaces: (session.workspaces ?? [])
      .filter((ws) => ws.id !== workspace.id)
      .map((ws) => ({ id: ws.id, name: ws.name, kind: ws.kind })),
  };
}

function findTask(board: TasksBoard, needleRaw: string) {
  const needle = needleRaw.trim().toLowerCase();
  return (
    board.tasks.find((t) => t.id.toLowerCase() === needle) ??
    board.tasks.find((t) => t.title.toLowerCase() === needle) ??
    board.tasks.find((t) => t.title.toLowerCase().includes(needle))
  );
}

function doneStatus(board: TasksBoard) {
  return (
    board.statuses.find((s) => s.id === 'status-done') ??
    board.statuses.find((s) => /\bdone\b/i.test(s.name))
  );
}

async function createTaskViaBridge(
  bridge: McpHubBridge,
  session: HubSession,
  input: { title: string; body?: string; statusId?: string },
) {
  const { board, revision } = await readTasksBoardViaBridge(bridge, session);
  const targetStatus =
    board.statuses.find(
      (s) => s.id === input.statusId || s.name.toLowerCase() === (input.statusId ?? '').toLowerCase(),
    ) ??
    board.statuses.find((s) => s.id === 'status-todo') ??
    board.statuses[0]!;
  const now = new Date().toISOString();
  const task = {
    id: `task-${randomUUID().slice(0, 8)}`,
    title: input.title.trim(),
    body: (input.body ?? '').trim(),
    statusId: targetStatus.id,
    createdAt: now,
    updatedAt: now,
  };
  const saved = await bridge.writeDocument(
    session,
    'tasks',
    { board: { ...board, tasks: [task, ...board.tasks] } },
    revision,
  );
  await bridge.emitEvent(session, 'sorye.task.created', {
    title: `Task created: ${task.title}`,
    summary: task.body || `Column: ${targetStatus.name}`,
    appId: 'tasks',
    entityId: task.id,
  });
  return { task, statusName: targetStatus.name, revision: saved.revision };
}

async function saveNoteViaBridge(
  bridge: McpHubBridge,
  session: HubSession,
  input: { title: string; body: string },
) {
  const { notes, revision } = await readNotesViaBridge(bridge, session);
  const now = new Date().toISOString();
  const title = input.title.trim();
  const existingIdx = notes.findIndex((n) => n.title.toLowerCase() === title.toLowerCase());
  const nextNotes = [...notes];
  let note;
  if (existingIdx >= 0) {
    const prev = nextNotes[existingIdx]!;
    note = { ...prev, body: `${prev.body}\n\n${input.body.trim()}`, updatedAt: now };
    nextNotes[existingIdx] = note;
  } else {
    note = { id: `note-${randomUUID().slice(0, 8)}`, title, body: input.body.trim(), updatedAt: now };
    nextNotes.unshift(note);
  }
  const saved = await bridge.writeDocument(session, 'notes', { notes: nextNotes }, revision);
  await bridge.emitEvent(session, 'sorye.notes.saved', {
    title: `Note saved: ${note.title}`,
    appId: 'notes',
    entityId: note.id,
  });
  return { note, revision: saved.revision };
}

export interface ExecuteMcpOptions {
  confirmed?: boolean;
  bridge?: McpHubBridge;
}

export async function executeMcpTool(
  session: HubSession,
  toolName: string,
  rawArgs: Record<string, unknown> = {},
  options: ExecuteMcpOptions = {},
): Promise<McpToolCallResult> {
  const started = Date.now();
  const tool = MCP_TOOLS.find((item) => item.name === toolName);
  if (!tool) {
    return {
      ok: false,
      toolName,
      message: `Unknown MCP tool "${toolName}".`,
      trace: {
        toolName,
        appId: 'hub',
        status: 'error',
        summary: `Unknown tool "${toolName}".`,
        routedVia: 'hub-session',
        durationMs: Math.max(1, Date.now() - started),
      },
    };
  }

  try {
    assertMcpToolPermission(session, tool);
  } catch (err) {
    const permErr = err instanceof McpPermissionError ? err : null;
    const actions: McpActionCard[] =
      permErr?.code === 'APP_NOT_ENABLED'
        ? [{ kind: 'open-picker', label: 'Open Manage apps', appId: permErr.requiredAppId }]
        : [];
    return {
      ok: false,
      toolName,
      message: err instanceof Error ? err.message : 'Permission denied.',
      actions,
      trace: {
        toolName,
        appId: tool.appId,
        status: 'denied',
        summary: err instanceof Error ? err.message : 'Permission denied',
        routedVia: 'hub-session',
        durationMs: Math.max(1, Date.now() - started),
      },
    };
  }

  if (tool.requiresConfirmation && options.confirmed !== true) {
    return {
      ok: false,
      toolName,
      requiresConfirmation: true,
      message: `Please confirm before running "${tool.title}".`,
      actions: [
        {
          kind: 'confirm-tool',
          label: `Confirm: ${tool.title}`,
          toolName: tool.name,
          toolArgs: rawArgs,
        },
      ],
      trace: {
        toolName,
        appId: tool.appId,
        status: 'confirmation_required',
        summary: `Awaiting user confirmation for ${tool.name}.`,
        routedVia: 'hub-session',
        durationMs: Math.max(1, Date.now() - started),
      },
    };
  }

  const bridge = options.bridge ?? createDefaultMcpHubBridge();

  try {
    switch (tool.name) {
      case 'ocr.search_stored_tables': {
        const schema = z.object({
          from: z.string().optional(),
          to: z.string().optional(),
          name: z.string().optional(),
          code: z.string().optional(),
          notations: z.array(z.string()).optional(),
          amountNotation: z.string().optional(),
          amountOp: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']).optional(),
          amountValue: z.number().optional(),
          scope: z.enum(['document', 'fields']).optional(),
        });
        const args = schema.parse(rawArgs);
        const amounts =
          args.amountNotation && args.amountOp && typeof args.amountValue === 'number'
            ? [{ notation: args.amountNotation, op: args.amountOp as OcrAmountOp, value: args.amountValue }]
            : undefined;
        const hits = await bridge.queryOcrTables(session, {
          from: args.from,
          to: args.to,
          name: args.name,
          code: args.code,
          notations: args.notations,
          amounts,
          scope: args.scope ?? 'document',
        });
        await bridge.emitEvent(session, 'sorye.mcp.action_executed', {
          title: `MCP searched stored OCR tables (${hits.length} match${hits.length === 1 ? '' : 'es'})`,
          appId: 'ocr',
          meta: { tool: tool.name, hits: hits.length },
        });
        const summaryLines = hits.slice(0, 6).map((hit) => {
          const fieldPairs = Object.entries(hit.fields)
            .slice(0, 3)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
          const sampleRow = hit.records[0]
            ? Object.entries(hit.records[0])
                .map(([k, v]) => `${k}=${v}`)
                .join(' · ')
            : '';
          return `• ${hit.fileName} (${hit.createdAt.slice(0, 10)}) — ${hit.recordCount} row(s)${fieldPairs ? ` · ${fieldPairs}` : ''}${sampleRow ? ` · [${sampleRow}]` : ''}`;
        });
        const message =
          hits.length === 0
            ? 'No stored OCR tables matched those filters in the latest 50 extractions.'
            : `Found ${hits.length} stored table${hits.length === 1 ? '' : 's'}:\n${summaryLines.join('\n')}`;
        return {
          ok: true,
          toolName,
          message,
          data: { hits },
          actions: [{ kind: 'open-app', label: 'Open OCR Stored tables', appId: 'ocr', pane: 'left' }],
          trace: {
            toolName,
            appId: 'ocr',
            status: 'executed',
            summary: `Searched latest 50 OCR tables → ${hits.length} match(es)`,
            routedVia: 'hub-event-router',
            eventEmitted: 'sorye.mcp.action_executed',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'ocr.get_reading_summary': {
        const { id } = z.object({ id: z.string().min(4).max(80) }).parse(rawArgs);
        const analysis = await bridge.readOcrAnalysis(session, id);
        if (!analysis) {
          return {
            ok: false,
            toolName,
            message: `Stored OCR extraction "${id}" was not found in this workspace.`,
            trace: {
              toolName,
              appId: 'ocr',
              status: 'error',
              summary: `OCR analysis ${id} not found`,
              routedVia: 'hub-event-router',
              durationMs: Math.max(1, Date.now() - started),
            },
          };
        }
        const rowLines = analysis.normalizedRows
          .slice(0, 8)
          .map((row) => `• p.${row.page} #${row.row + 1}: ${row.cells.filter(Boolean).join(' | ')}`)
          .join('\n');
        return {
          ok: true,
          toolName,
          message: `Reading for ${analysis.fileName} (${analysis.status}):\n${rowLines || analysis.summary || 'No normalized rows.'}`,
          data: { analysis },
          actions: [{ kind: 'open-app', label: 'Open OCR', appId: 'ocr', pane: 'left' }],
          trace: {
            toolName,
            appId: 'ocr',
            status: 'executed',
            summary: `Loaded ${analysis.normalizedRows.length} normalized rows from ${analysis.fileName}`,
            routedVia: 'hub-event-router',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'ocr.rename_table': {
        const { id, fileName } = z
          .object({ id: z.string().min(4).max(80), fileName: z.string().min(1).max(180) })
          .parse(rawArgs);
        const renamed = await bridge.renameOcrTable(session, id, fileName.trim());
        if (!renamed) {
          return {
            ok: false,
            toolName,
            message: `Could not rename OCR table "${id}".`,
            trace: {
              toolName,
              appId: 'ocr',
              status: 'error',
              summary: `Rename failed for ${id}`,
              routedVia: 'hub-event-router',
              durationMs: Math.max(1, Date.now() - started),
            },
          };
        }
        return {
          ok: true,
          toolName,
          message: `Renamed table ${renamed.id} to "${renamed.fileName}".`,
          data: renamed,
          trace: {
            toolName,
            appId: 'ocr',
            status: 'executed',
            summary: `Renamed ${renamed.id} → ${renamed.fileName}`,
            routedVia: 'hub-event-router',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'ocr.handoff_to_protocolio': {
        const { id } = z.object({ id: z.string().min(4).max(80) }).parse(rawArgs);
        const handoff = await bridge.handoffOcrToProtocolio(session, id);
        if (!handoff) {
          return {
            ok: false,
            toolName,
            message: `Could not create Protocolio handoff for "${id}".`,
            trace: {
              toolName,
              appId: 'ocr',
              status: 'error',
              summary: `Handoff failed for ${id}`,
              routedVia: 'hub-event-router',
              durationMs: Math.max(1, Date.now() - started),
            },
          };
        }
        await bridge.emitEvent(session, 'sorye.ocr.ready', {
          title: handoff.title,
          appId: 'ocr',
          entityId: handoff.handoffId,
        });
        return {
          ok: true,
          toolName,
          message: `Created handoff "${handoff.title}" (${handoff.handoffId}) for Protocolio.`,
          data: handoff,
          actions: [{ kind: 'open-app', label: 'Open Protocolio', appId: 'protocolio', pane: 'right' }],
          trace: {
            toolName,
            appId: 'ocr',
            status: 'executed',
            summary: `Handoff ${handoff.handoffId} → Protocolio`,
            routedVia: 'hub-event-router',
            eventEmitted: 'sorye.ocr.ready',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'tasks.list': {
        const args = z
          .object({ query: z.string().optional(), statusId: z.string().optional() })
          .parse(rawArgs);
        const { board, revision } = await readTasksBoardViaBridge(bridge, session);
        const statusById = new Map(board.statuses.map((s) => [s.id, s.name]));
        const q = args.query?.trim().toLowerCase() ?? '';
        const statusFilter = args.statusId?.trim().toLowerCase() ?? '';
        const tasks = board.tasks.filter((task) => {
          if (q && !`${task.title} ${task.body}`.toLowerCase().includes(q)) return false;
          if (statusFilter) {
            const colName = (statusById.get(task.statusId) ?? '').toLowerCase();
            if (task.statusId.toLowerCase() !== statusFilter && !colName.includes(statusFilter)) {
              return false;
            }
          }
          return true;
        });
        const lines = tasks
          .slice(0, 10)
          .map((t) => `• [${statusById.get(t.statusId) ?? t.statusId}] ${t.title}${t.body ? ` — ${t.body}` : ''}`);
        return {
          ok: true,
          toolName,
          message:
            tasks.length === 0
              ? 'No tasks matched in your workspace board.'
              : `Workspace tasks (${tasks.length}, revision ${revision}):\n${lines.join('\n')}`,
          data: { tasks, statuses: board.statuses, revision },
          actions: [{ kind: 'open-app', label: 'Open Tasks', appId: 'tasks', pane: 'left' }],
          trace: {
            toolName,
            appId: 'tasks',
            status: 'executed',
            summary: `Read Tasks via Hub → Rodrigo router (${tasks.length} task(s), rev ${revision})`,
            routedVia: 'rodrigo-signed',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'tasks.create': {
        const args = z
          .object({
            title: z.string().min(1).max(200),
            body: z.string().max(4000).optional(),
            statusId: z.string().max(80).optional(),
          })
          .parse(rawArgs);
        const created = await createTaskViaBridge(bridge, session, args);
        const { task } = created;
        const saved = { revision: created.revision };
        return {
          ok: true,
          toolName,
          message: `Created task "${task.title}" in column "${created.statusName}" (revision ${saved.revision}).`,
          data: { task, revision: saved.revision },
          actions: [{ kind: 'open-app', label: 'Open Tasks', appId: 'tasks', pane: 'left' }],
          trace: {
            toolName,
            appId: 'tasks',
            status: 'executed',
            summary: `Forwarded task write → Rodrigo (rev ${saved.revision})`,
            routedVia: 'rodrigo-signed',
            eventEmitted: 'sorye.task.created',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'tasks.move': {
        const args = z
          .object({
            taskId: z.string().min(1).max(200),
            statusId: z.string().min(1).max(80),
          })
          .parse(rawArgs);
        const { board, revision } = await readTasksBoardViaBridge(bridge, session);
        const targetStatus = board.statuses.find(
          (s) =>
            s.id.toLowerCase() === args.statusId.toLowerCase() ||
            s.name.toLowerCase().includes(args.statusId.toLowerCase()),
        );
        if (!targetStatus) {
          throw new Error(`Status column "${args.statusId}" was not found.`);
        }
        const needle = args.taskId.toLowerCase();
        const existing = board.tasks.find(
          (t) => t.id.toLowerCase() === needle || t.title.toLowerCase().includes(needle),
        );
        if (!existing) {
          throw new Error(`Task "${args.taskId}" was not found on the board.`);
        }
        const now = new Date().toISOString();
        const nextTasks = board.tasks.map((t) =>
          t.id === existing.id ? { ...t, statusId: targetStatus.id, updatedAt: now } : t,
        );
        const saved = await bridge.writeDocument(
          session,
          'tasks',
          { board: { ...board, tasks: nextTasks } },
          revision,
        );
        await bridge.emitEvent(session, 'sorye.task.moved', {
          title: `Moved "${existing.title}" to ${targetStatus.name}`,
          appId: 'tasks',
          entityId: existing.id,
        });
        return {
          ok: true,
          toolName,
          message: `Moved "${existing.title}" to "${targetStatus.name}" (revision ${saved.revision}).`,
          data: { taskId: existing.id, statusId: targetStatus.id, revision: saved.revision },
          actions: [{ kind: 'open-app', label: 'Open Tasks', appId: 'tasks', pane: 'left' }],
          trace: {
            toolName,
            appId: 'tasks',
            status: 'executed',
            summary: `Moved task ${existing.id} → ${targetStatus.name} via Rodrigo (rev ${saved.revision})`,
            routedVia: 'rodrigo-signed',
            eventEmitted: 'sorye.task.moved',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'tasks.complete':
      case 'tasks.delete': {
        const { taskId } = z.object({ taskId: z.string().min(1).max(200) }).parse(rawArgs);
        const { board, revision } = await readTasksBoardViaBridge(bridge, session);
        const existing = findTask(board, taskId);
        if (!existing) {
          throw new Error(`Task "${taskId}" was not found on the board.`);
        }
        const now = new Date().toISOString();
        let nextTasks;
        let message: string;
        let eventName: 'sorye.task.moved' | 'sorye.task.updated';
        if (tool.name === 'tasks.complete') {
          const done = doneStatus(board);
          if (!done) throw new Error('The Tasks board has no Done column.');
          if (existing.statusId === done.id) {
            return {
              ok: true,
              toolName,
              message: `"${existing.title}" is already in ${done.name}.`,
              data: { taskId: existing.id, statusId: done.id, revision },
              actions: [{ kind: 'open-app', label: 'Open Tasks', appId: 'tasks', pane: 'left' }],
              trace: {
                toolName,
                appId: 'tasks',
                status: 'executed',
                summary: `Task ${existing.id} already done`,
                routedVia: 'rodrigo-signed',
                durationMs: Math.max(1, Date.now() - started),
              },
            };
          }
          nextTasks = board.tasks.map((t) =>
            t.id === existing.id ? { ...t, statusId: done.id, updatedAt: now } : t,
          );
          message = `Marked "${existing.title}" as done.`;
          eventName = 'sorye.task.moved';
        } else {
          nextTasks = board.tasks.filter((t) => t.id !== existing.id);
          message = `Deleted task "${existing.title}".`;
          eventName = 'sorye.task.updated';
        }
        const saved = await bridge.writeDocument(
          session,
          'tasks',
          { board: { ...board, tasks: nextTasks } },
          revision,
        );
        await bridge.emitEvent(session, eventName, {
          title: tool.name === 'tasks.complete' ? `Completed: ${existing.title}` : `Deleted task: ${existing.title}`,
          appId: 'tasks',
          entityId: existing.id,
        });
        return {
          ok: true,
          toolName,
          message: `${message} (revision ${saved.revision})`,
          data: { taskId: existing.id, revision: saved.revision },
          actions: [{ kind: 'open-app', label: 'Open Tasks', appId: 'tasks', pane: 'left' }],
          trace: {
            toolName,
            appId: 'tasks',
            status: 'executed',
            summary: `${tool.name === 'tasks.complete' ? 'Completed' : 'Deleted'} task ${existing.id} via Rodrigo (rev ${saved.revision})`,
            routedVia: 'rodrigo-signed',
            eventEmitted: eventName,
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'calendar.list_upcoming': {
        const args = z
          .object({ from: z.string().optional(), to: z.string().optional() })
          .parse(rawArgs);
        const { events, revision } = await readCalendarViaBridge(bridge, session);
        const filtered = events.filter((ev) => {
          const first = ev.dates[0] ?? '';
          const last = ev.dates[ev.dates.length - 1] ?? first;
          if (args.from && last < args.from) return false;
          if (args.to && first > args.to) return false;
          return true;
        });
        const lines = filtered
          .slice(0, 10)
          .map((ev) => `• ${ev.dates.join(', ')}${ev.startTime ? ` ${ev.startTime}` : ''} — ${ev.title}`);
        return {
          ok: true,
          toolName,
          message:
            filtered.length === 0
              ? 'No calendar events in that window.'
              : `Calendar events (${filtered.length}, revision ${revision}):\n${lines.join('\n')}`,
          data: { events: filtered, revision },
          actions: [{ kind: 'open-app', label: 'Open Calendar', appId: 'calendar', pane: 'left' }],
          trace: {
            toolName,
            appId: 'calendar',
            status: 'executed',
            summary: `Read Calendar via Hub → Rodrigo (${filtered.length} event(s), rev ${revision})`,
            routedVia: 'rodrigo-signed',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'calendar.schedule_event': {
        const args = z
          .object({
            title: z.string().min(1).max(200),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
            endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
          })
          .parse(rawArgs);
        const { events, revision } = await readCalendarViaBridge(bridge, session);
        const newEvent = {
          id: `cal-${randomUUID().slice(0, 8)}`,
          title: args.title.trim(),
          kind: args.startTime ? ('timed' as const) : ('allDay' as const),
          dates: [args.date],
          ...(args.startTime ? { startTime: args.startTime } : {}),
          ...(args.endTime ? { endTime: args.endTime } : {}),
        };
        const saved = await bridge.writeDocument(
          session,
          'calendar',
          { events: [...events, newEvent] },
          revision,
        );
        await bridge.emitEvent(session, 'sorye.calendar.saved', {
          title: `Scheduled: ${newEvent.title}`,
          summary: `${args.date}${args.startTime ? ` at ${args.startTime}` : ' (all day)'}`,
          appId: 'calendar',
          entityId: newEvent.id,
        });
        return {
          ok: true,
          toolName,
          message: `Scheduled "${newEvent.title}" on ${args.date}${args.startTime ? ` at ${args.startTime}` : ''} (revision ${saved.revision}).`,
          data: { event: newEvent, revision: saved.revision },
          actions: [{ kind: 'open-app', label: 'Open Calendar', appId: 'calendar', pane: 'left' }],
          trace: {
            toolName,
            appId: 'calendar',
            status: 'executed',
            summary: `Forwarded calendar write → Rodrigo (rev ${saved.revision})`,
            routedVia: 'rodrigo-signed',
            eventEmitted: 'sorye.calendar.saved',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'notes.search': {
        const args = z.object({ query: z.string().optional() }).parse(rawArgs);
        const { notes, revision } = await readNotesViaBridge(bridge, session);
        const q = args.query?.trim().toLowerCase() ?? '';
        const matched = q
          ? notes.filter((n) => `${n.title} ${n.body}`.toLowerCase().includes(q))
          : notes;
        const lines = matched
          .slice(0, 8)
          .map((n) => `• ${n.title}: ${n.body.slice(0, 120)}${n.body.length > 120 ? '…' : ''}`);
        return {
          ok: true,
          toolName,
          message:
            matched.length === 0
              ? 'No matching notes found.'
              : `Notes (${matched.length}, revision ${revision}):\n${lines.join('\n')}`,
          data: { notes: matched, revision },
          actions: [{ kind: 'open-app', label: 'Open Notes', appId: 'notes', pane: 'left' }],
          trace: {
            toolName,
            appId: 'notes',
            status: 'executed',
            summary: `Read Notes via Hub → Rodrigo (${matched.length} note(s), rev ${revision})`,
            routedVia: 'rodrigo-signed',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'notes.create_or_append': {
        const args = z
          .object({
            title: z.string().min(1).max(200),
            body: z.string().min(1).max(10_000),
          })
          .parse(rawArgs);
        const { note: targetNote, revision: savedRevision } = await saveNoteViaBridge(bridge, session, args);
        const saved = { revision: savedRevision };
        return {
          ok: true,
          toolName,
          message: `Saved note "${targetNote.title}" (revision ${saved.revision}).`,
          data: { note: targetNote, revision: saved.revision },
          actions: [{ kind: 'open-app', label: 'Open Notes', appId: 'notes', pane: 'left' }],
          trace: {
            toolName,
            appId: 'notes',
            status: 'executed',
            summary: `Forwarded note write → Rodrigo (rev ${saved.revision})`,
            routedVia: 'rodrigo-signed',
            eventEmitted: 'sorye.notes.saved',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'personal.quick_capture': {
        const args = z
          .object({
            note: z.string().min(1).max(10_000),
            title: z.string().max(200).optional(),
            task: z.string().max(200).optional(),
          })
          .parse(rawArgs);
        const noteText = args.note.trim();
        const title =
          args.title?.trim() ||
          `Quick note · ${noteText.split(/\s+/).slice(0, 6).join(' ').slice(0, 60)}`;
        const { note, revision } = await saveNoteViaBridge(bridge, session, { title, body: noteText });
        const lines = [`Saved note "${note.title}" (revision ${revision}).`];
        const actions: McpActionCard[] = [
          { kind: 'open-app', label: 'Open Notes', appId: 'notes', pane: 'left' },
        ];
        let eventEmitted = 'sorye.notes.saved';
        const taskTitle = args.task?.trim();
        if (taskTitle) {
          if (allowedAppIdsForSession(session).has('tasks')) {
            const created = await createTaskViaBridge(bridge, session, {
              title: taskTitle,
              body: `From note: ${note.title}`,
            });
            lines.push(`Added task "${created.task.title}" to ${created.statusName}.`);
            actions.push({ kind: 'open-app', label: 'Open Tasks', appId: 'tasks', pane: 'right' });
            eventEmitted = 'sorye.notes.saved, sorye.task.created';
          } else {
            lines.push('Task skipped: the Tasks app is not enabled in this workspace.');
            actions.push({ kind: 'open-picker', label: 'Enable Tasks', appId: 'tasks' });
          }
        }
        return {
          ok: true,
          toolName,
          message: lines.join('\n'),
          data: { note },
          actions,
          trace: {
            toolName,
            appId: 'notes',
            status: 'executed',
            summary: `Quick capture → Notes${eventEmitted.includes('task') ? ' + Tasks' : ''} via Rodrigo`,
            routedVia: 'rodrigo-signed',
            eventEmitted,
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'files.list_recent': {
        const args = z
          .object({ query: z.string().max(120).optional(), limit: z.number().int().min(1).max(20).optional() })
          .parse(rawArgs);
        if (!bridge.listDriveFiles) {
          throw new Error('Drive listing is not available in this Hub build.');
        }
        const q = args.query?.trim().toLowerCase() ?? '';
        const files = (await bridge.listDriveFiles(session))
          .filter((f) => !q || f.displayName.toLowerCase().includes(q))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, args.limit ?? 8);
        const lines = files.map(
          (f) => `• ${f.displayName} — ${f.updatedAt.slice(0, 10)} · ${Math.max(1, Math.round(f.size / 1024))} KB${f.sourceAppId ? ` · ${f.sourceAppId}` : ''}`,
        );
        return {
          ok: true,
          toolName,
          message: files.length === 0 ? 'No files in this workspace Drive yet.' : `Recent Drive files:\n${lines.join('\n')}`,
          data: { files },
          actions: [{ kind: 'open-app', label: 'Open Drive', appId: 'files', pane: 'left' }],
          trace: {
            toolName,
            appId: 'files',
            status: 'executed',
            summary: `Listed ${files.length} Drive file(s) via Hub files library`,
            routedVia: 'hub-session',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'messenger.post_update': {
        const args = z
          .object({
            title: z.string().min(1).max(200),
            summary: z.string().min(1).max(1500),
          })
          .parse(rawArgs);
        const published = await bridge.emitEvent(session, 'sorye.messenger.posted', {
          title: args.title.trim(),
          summary: args.summary.trim(),
          appId: 'messenger',
        });
        return {
          ok: true,
          toolName,
          message: `Posted "${args.title.trim()}" to Messenger (${published.eventId}).`,
          data: published,
          actions: [{ kind: 'open-app', label: 'Open Messenger', appId: 'messenger', pane: 'right' }],
          trace: {
            toolName,
            appId: 'messenger',
            status: 'executed',
            summary: `Emitted sorye.messenger.posted (${published.eventId})`,
            routedVia: 'hub-event-router',
            eventEmitted: 'sorye.messenger.posted',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'hub.explain_workspace': {
        const plan = getPlanById(SUBSCRIPTION_PLANS, session.workspace.subscriptionId);
        const effectiveIds = withAlwaysAvailableAppIds(
          APP_CATALOG,
          session.workspace.selectedAppIds,
        );
        const appNames = APP_CATALOG.filter((app) => effectiveIds.includes(app.id)).map((a) => a.name);
        const gpuPref = getUserGpuPreference(session.user.id);
        const rodrigoCaps = await bridge.readRodrigoCapabilities(session);
        const usedSlots = selectableAppCount(APP_CATALOG, session.workspace.selectedAppIds);
        const message = [
          `Workspace: ${session.workspace.name} (${plan.name} plan, ${usedSlots}/${plan.maxApps === 999 ? '∞' : plan.maxApps} app slots).`,
          `Enabled apps: ${appNames.join(', ')}.`,
          `GPU target: ${gpuPref.target === 'client-webgpu' ? `Browser WebGPU (${gpuPref.webGpuModelId}, ${gpuPref.webGpuPowerPreference})` : `Hub Server GPU #${gpuPref.hostGpuIndex}`}.`,
          `Rodrigo Rust backend: ${rodrigoCaps ? `connected (contract v${rodrigoCaps.contractVersion}, dataReady=${rodrigoCaps.dataReady})` : 'Hub store active (Rodrigo standby)'}.`,
        ].join('\n');
        return {
          ok: true,
          toolName,
          message,
          data: {
            workspace: session.workspace.name,
            plan: plan.name,
            enabledApps: appNames,
            gpuPreference: gpuPref,
            rodrigo: rodrigoCaps,
          },
          trace: {
            toolName,
            appId: 'hub',
            status: 'executed',
            summary: `Inspected workspace & Rodrigo capabilities`,
            routedVia: rodrigoCaps ? 'rodrigo-signed' : 'hub-session',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'hub.whoami': {
        const facts = workspaceOwnershipFacts(session);
        const gpuPref = getUserGpuPreference(session.user.id);
        const scope =
          facts.kind === 'personal'
            ? 'your Personal workspace (private to you)'
            : facts.isOwner
              ? `a Team workspace owned by you (${facts.memberCount} member${facts.memberCount === 1 ? '' : 's'})`
              : `a Team workspace you are a member of, not the owner (${facts.memberCount} members)`;
        const others = facts.otherWorkspaces.length
          ? facts.otherWorkspaces.map((ws) => `${ws.name} (${ws.kind})`).join(', ')
          : 'none';
        const gpuLabel =
          gpuPref.target === 'client-webgpu'
            ? `Browser WebGPU (${gpuPref.webGpuModelId})`
            : `Hub Server GPU #${gpuPref.hostGpuIndex}`;
        const message = [
          `You are ${facts.userName} (${facts.email}) · ${facts.role === 'platform-admin' ? 'Platform admin' : 'Member'}.`,
          `"${facts.workspaceName}" is ${scope}.`,
          `Your other workspaces: ${others}.`,
          `Belongs to you personally: the GPU choice (${gpuLabel}) is saved per user and follows you across workspaces.`,
          `Belongs to "${facts.workspaceName}": OCR tables, Tasks, Notes, Calendar and Drive files. ${facts.kind === 'team' ? 'Everyone in this team sees them; switching workspace shows a different set.' : 'Only you see them.'}`,
        ].join('\n');
        return {
          ok: true,
          toolName,
          message,
          data: { ...facts, gpuTarget: gpuPref.target },
          trace: {
            toolName,
            appId: 'hub',
            status: 'executed',
            summary: `Read ownership from the signed-in session`,
            routedVia: 'hub-session',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'hub.my_day_briefing': {
        const allowed = allowedAppIdsForSession(session);
        const facts = workspaceOwnershipFacts(session);
        const today = new Date().toISOString().slice(0, 10);
        const weekEnd = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
        const sections: string[] = [
          `Scope: "${facts.workspaceName}" · ${facts.kind === 'personal' ? 'Personal' : facts.isOwner ? 'Team (owned by you)' : 'Team (member)'}`,
        ];
        const failed = (label: string) => `${label}: could not be loaded right now.`;
        if (allowed.has('tasks')) {
          try {
            const { board } = await readTasksBoardViaBridge(bridge, session);
            const done = doneStatus(board);
            const statusById = new Map(board.statuses.map((s) => [s.id, s.name]));
            const open = board.tasks.filter((t) => t.statusId !== done?.id);
            sections.push(
              open.length === 0
                ? 'Tasks: nothing open.'
                : `Open tasks (${open.length}):\n${open
                    .slice(0, 6)
                    .map((t) => `• [${statusById.get(t.statusId) ?? t.statusId}] ${t.title}`)
                    .join('\n')}`,
            );
          } catch {
            sections.push(failed('Tasks'));
          }
        }
        if (allowed.has('calendar')) {
          try {
            const { events } = await readCalendarViaBridge(bridge, session);
            const upcoming = events
              .map((ev) => ({ ev, day: ev.dates.find((d) => d >= today && d <= weekEnd) }))
              .filter((item): item is { ev: CalendarEvent; day: string } => Boolean(item.day))
              .sort((a, b) => `${a.day}${a.ev.startTime ?? ''}`.localeCompare(`${b.day}${b.ev.startTime ?? ''}`));
            const todays = upcoming.filter((item) => item.day === today);
            const later = upcoming.filter((item) => item.day !== today);
            const fmt = (item: { ev: CalendarEvent; day: string }) =>
              `• ${item.day}${item.ev.startTime ? ` ${item.ev.startTime}` : ''} — ${item.ev.title}`;
            sections.push(
              `Today: ${todays.length ? `\n${todays.map(fmt).join('\n')}` : 'no events.'}`,
              `Next 7 days: ${later.length ? `\n${later.slice(0, 6).map(fmt).join('\n')}` : 'no events.'}`,
            );
          } catch {
            sections.push(failed('Calendar'));
          }
        }
        if (allowed.has('notes')) {
          try {
            const { notes } = await readNotesViaBridge(bridge, session);
            const latest = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
            sections.push(
              latest.length === 0
                ? 'Notes: none yet.'
                : `Latest notes:\n${latest.map((n) => `• ${n.title}`).join('\n')}`,
            );
          } catch {
            sections.push(failed('Notes'));
          }
        }
        if (allowed.has('ocr')) {
          try {
            const hits = await bridge.queryOcrTables(session, { scope: 'document' });
            const latest = [...hits].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
            sections.push(
              latest.length === 0
                ? 'OCR: no stored readings.'
                : `Latest OCR readings:\n${latest.map((h) => `• ${h.fileName} (${h.createdAt.slice(0, 10)}, ${h.status})`).join('\n')}`,
            );
          } catch {
            sections.push(failed('OCR'));
          }
        }
        if (sections.length === 1) {
          sections.push('Enable Tasks, Calendar, Notes or OCR to get a briefing.');
        }
        return {
          ok: true,
          toolName,
          message: sections.join('\n\n'),
          trace: {
            toolName,
            appId: 'hub',
            status: 'executed',
            summary: 'Built My day briefing from enabled apps',
            routedVia: 'rodrigo-signed',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'hub.switch_workspace': {
        const { workspace: targetRaw } = z
          .object({ workspace: z.string().max(120).optional() })
          .parse(rawArgs);
        const all = session.workspaces ?? [];
        const needle = targetRaw?.trim().toLowerCase() ?? '';
        const matches = needle
          ? all.filter(
              (ws) =>
                ws.id.toLowerCase() === needle ||
                ws.name.toLowerCase() === needle ||
                ws.name.toLowerCase().includes(needle) ||
                (needle === 'personal' && ws.kind === 'personal'),
            )
          : all.filter((ws) => ws.id !== session.workspace.id);
        const switchCards: McpActionCard[] = matches
          .filter((ws) => ws.id !== session.workspace.id)
          .map((ws) => ({
            kind: 'switch-workspace',
            label: `Switch to ${ws.name}`,
            workspaceId: ws.id,
            workspaceName: ws.name,
            workspaceKind: ws.kind,
          }));
        const list = all
          .map((ws) => `• ${ws.name} (${ws.kind})${ws.id === session.workspace.id ? ' — active' : ''}`)
          .join('\n');
        const message =
          needle && matches.length === 0
            ? `No workspace matches "${targetRaw}". Your workspaces:\n${list}`
            : needle && switchCards.length === 0
              ? `"${session.workspace.name}" is already your active workspace.`
              : `Your workspaces:\n${list}${switchCards.length ? '\n\nPick one below to switch.' : ''}`;
        return {
          ok: true,
          toolName,
          message,
          data: { workspaces: all, activeWorkspaceId: session.workspace.id },
          actions: switchCards,
          trace: {
            toolName,
            appId: 'hub',
            status: 'executed',
            summary: `Listed ${all.length} workspace(s); switch runs through /api/workspace/team`,
            routedVia: 'hub-session',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'hub.open_app': {
        const args = z
          .object({
            appId: z.string().min(1).max(40),
            pane: z.enum(['left', 'right']).optional(),
          })
          .parse(rawArgs);
        const needle = args.appId.trim().toLowerCase();
        const app = APP_CATALOG.find(
          (entry) =>
            entry.id.toLowerCase() === needle ||
            entry.slug.toLowerCase() === needle ||
            entry.name.toLowerCase() === needle,
        );
        if (!app) {
          throw new Error(`Unknown Sorye app "${args.appId}".`);
        }
        assertMcpToolPermission(session, {
          name: 'hub.open_app',
          appId: app.id,
          requiresAdmin: app.adminOnly,
        });
        const pane = args.pane ?? 'left';
        return {
          ok: true,
          toolName,
          message: `Opening ${app.name} in the ${pane} workspace pane.`,
          data: { appId: app.id, pane },
          actions: [{ kind: 'open-app', label: `Open ${app.name}`, appId: app.id, pane }],
          trace: {
            toolName,
            appId: app.id,
            status: 'executed',
            summary: `Navigate → ${app.name} (${pane} pane)`,
            routedVia: 'hub-session',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      case 'backend.topology': {
        const topology = await bridge.readRodrigoTopology(session);
        return {
          ok: true,
          toolName,
          message: topology
            ? `Rodrigo topology (v${topology.contractVersion}): providers [${topology.documentProviders.join(', ')}], cacheReady=${topology.cacheReady}.`
            : 'Rodrigo topology endpoint is currently unreachable; Hub fallback stores are active.',
          data: { topology },
          trace: {
            toolName,
            appId: 'hub',
            status: 'executed',
            summary: 'Queried Rodrigo /v1/topology with signed assertion',
            routedVia: 'rodrigo-signed',
            durationMs: Math.max(1, Date.now() - started),
          },
        };
      }

      default:
        throw new Error(`Unhandled MCP tool "${tool.name}".`);
    }
  } catch (err) {
    if (err instanceof McpPermissionError) {
      return {
        ok: false,
        toolName,
        message: err.message,
        actions:
          err.code === 'APP_NOT_ENABLED'
            ? [{ kind: 'open-picker', label: 'Open Manage apps', appId: err.requiredAppId }]
            : [],
        trace: {
          toolName,
          appId: tool.appId,
          status: 'denied',
          summary: err.message,
          routedVia: 'hub-session',
          durationMs: Math.max(1, Date.now() - started),
        },
      };
    }
    return {
      ok: false,
      toolName,
      message: err instanceof Error ? err.message : 'Tool execution failed.',
      trace: {
        toolName,
        appId: tool.appId,
        status: 'error',
        summary: err instanceof Error ? err.message : 'Tool execution failed',
        routedVia: 'hub-session',
        durationMs: Math.max(1, Date.now() - started),
      },
    };
  }
}

/** Plain-text answer from the configured server model; throws when unavailable. */
export type McpChatResponder = (
  systemPrompt: string,
  userPrompt: string,
) => Promise<{ text: string; model: string }>;

const CHAT_TIMEOUT_MS = 15_000;

const defaultChatResponder: McpChatResponder = async (systemPrompt, userPrompt) => {
  const text = await completeChat(systemPrompt, userPrompt, {
    timeoutMs: CHAT_TIMEOUT_MS,
    maxOutputTokens: 500,
  });
  let model = 'server model';
  try {
    model = llmModelName();
  } catch {
    // Model name is only a footer label.
  }
  return { text, model };
};

export interface McpChatAnswer {
  reply: string;
  traces: McpToolCallResult['trace'][];
  actions: McpActionCard[];
  engine: McpChatEngine;
  model?: string;
}

const SUGGESTIONS: ReadonlyArray<{ appId: string; text: string }> = [
  { appId: 'hub', text: '"Does this workspace belong to me or my team?"' },
  { appId: 'hub', text: '"My day" for open tasks, events, notes and OCR readings' },
  { appId: 'notes', text: '"Quick note: call the plumber + task: book plumber visit"' },
  { appId: 'ocr', text: '"Find code 01.11.04.A" in stored OCR tables' },
  { appId: 'files', text: '"Recent Drive files"' },
  { appId: 'tasks', text: '"List my tasks" or "Complete task <title>"' },
  { appId: 'calendar', text: '"Schedule Site visit 2026-11-12"' },
];

function suggestionsFor(session: HubSession, limit = 4): string[] {
  const allowed = allowedAppIdsForSession(session);
  return SUGGESTIONS.filter((s) => allowed.has(s.appId))
    .slice(0, limit)
    .map((s) => `• ${s.text}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMentionedApp(text: string): AppCatalogEntry | undefined {
  const lower = text.toLowerCase();
  return APP_CATALOG.find((app) =>
    [app.name, app.slug, app.id].some(
      (key) => key && new RegExp(`(^|[^a-z0-9])${escapeRegExp(key.toLowerCase())}([^a-z0-9]|$)`).test(lower),
    ),
  );
}

function parseLooseNumber(raw: string): number | undefined {
  let s = raw.replace(/\s+/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const num = Number(s);
  return s && Number.isFinite(num) ? num : undefined;
}

/** Recursive-descent evaluator for + - * / ^ and parentheses; no eval. */
export function evaluateArithmetic(expression: string): number | undefined {
  const src = expression.replace(/[×x]/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  if (!/^[\d.,+\-*/^()]+$/.test(src) || !/\d[+\-*/^]|\)[+\-*/^]/.test(src)) return undefined;
  let pos = 0;
  const peek = () => src[pos];
  const parsePrimary = (): number => {
    if (peek() === '(') {
      pos += 1;
      const value = parseSum();
      if (peek() !== ')') throw new Error('paren');
      pos += 1;
      return value;
    }
    if (peek() === '-') {
      pos += 1;
      return -parsePrimary();
    }
    const match = /^\d+(?:[.,]\d+)?/.exec(src.slice(pos));
    if (!match) throw new Error('number');
    pos += match[0].length;
    return Number(match[0].replace(',', '.'));
  };
  const parsePower = (): number => {
    const base = parsePrimary();
    if (peek() === '^') {
      pos += 1;
      return base ** parsePower();
    }
    return base;
  };
  const parseProduct = (): number => {
    let value = parsePower();
    while (peek() === '*' || peek() === '/') {
      const op = src[pos++];
      const rhs = parsePower();
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  };
  const parseSum = (): number => {
    let value = parseProduct();
    while (peek() === '+' || peek() === '-') {
      const op = src[pos++];
      const rhs = parseProduct();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  };
  try {
    const value = parseSum();
    return pos === src.length && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const UNIT_ALIASES: ReadonlyArray<[RegExp, string]> = [
  [/^(m²|m2|sqm|sq\.? ?m|square met(?:er|re)s?)$/, 'm2'],
  [/^(ft²|ft2|sq\.? ?ft|square f(?:oo|ee)t)$/, 'ft2'],
  [/^(ha|hectares?)$/, 'ha'],
  [/^(acres?)$/, 'acre'],
  [/^(km|kilomet(?:er|re)s?)$/, 'km'],
  [/^(mi|miles?)$/, 'mi'],
  [/^(cm|centimet(?:er|re)s?)$/, 'cm'],
  [/^(m|met(?:er|re)s?)$/, 'm'],
  [/^(ft|feet|foot)$/, 'ft'],
  [/^(in|inch(?:es)?)$/, 'in'],
  [/^(kg|kilograms?|kilos?)$/, 'kg'],
  [/^(lbs?|pounds?)$/, 'lb'],
  [/^(°?c|celsius)$/, 'c'],
  [/^(°?f|fahrenheit)$/, 'f'],
];

const UNIT_FACTORS: Record<string, { dim: string; toBase: number; label: string }> = {
  m2: { dim: 'area', toBase: 1, label: 'm²' },
  ft2: { dim: 'area', toBase: 0.09290304, label: 'ft²' },
  ha: { dim: 'area', toBase: 10_000, label: 'ha' },
  acre: { dim: 'area', toBase: 4046.8564224, label: 'acres' },
  m: { dim: 'length', toBase: 1, label: 'm' },
  km: { dim: 'length', toBase: 1000, label: 'km' },
  cm: { dim: 'length', toBase: 0.01, label: 'cm' },
  mi: { dim: 'length', toBase: 1609.344, label: 'mi' },
  ft: { dim: 'length', toBase: 0.3048, label: 'ft' },
  in: { dim: 'length', toBase: 0.0254, label: 'in' },
  kg: { dim: 'mass', toBase: 1, label: 'kg' },
  lb: { dim: 'mass', toBase: 0.45359237, label: 'lb' },
};

function canonicalUnit(raw: string): string | undefined {
  const key = raw.trim().toLowerCase();
  return UNIT_ALIASES.find(([re]) => re.test(key))?.[1];
}

function formatNumber(value: number): string {
  return Number(value.toPrecision(10)).toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function convertUnits(text: string): string | undefined {
  const match = text.match(
    /(-?\d[\d\s.,]*)\s*([a-z°²2 .]+?)\s+(?:to|in|into|as|=|->)\s+([a-z°²2 .]+?)\s*\??$/i,
  );
  if (!match) return undefined;
  const value = parseLooseNumber(match[1]!);
  const from = canonicalUnit(match[2]!);
  const to = canonicalUnit(match[3]!);
  if (value === undefined || !from || !to) return undefined;
  if (from === 'c' && to === 'f') return `${formatNumber(value)} °C = ${formatNumber((value * 9) / 5 + 32)} °F`;
  if (from === 'f' && to === 'c') return `${formatNumber(value)} °F = ${formatNumber(((value - 32) * 5) / 9)} °C`;
  const a = UNIT_FACTORS[from];
  const b = UNIT_FACTORS[to];
  if (!a || !b || a.dim !== b.dim) return undefined;
  return `${formatNumber(value)} ${a.label} = ${formatNumber((value * a.toBase) / b.toBase)} ${b.label}`;
}

function computeAnswer(text: string): string | undefined {
  const converted = convertUnits(text);
  if (converted) return converted;
  const expr = text
    .replace(/^(what(?:'s| is)|calculate|compute|how much is|solve)\s+/i, '')
    .replace(/[=?]+\s*$/, '')
    .trim();
  if (/^\d{2}-\d{4,6}$/.test(expr)) return undefined;
  const value = evaluateArithmetic(expr);
  return value === undefined ? undefined : `${expr} = ${formatNumber(value)}`;
}

function capabilitiesAnswer(session: HubSession): string {
  const permitted = listMcpToolsForSession(session);
  const has = (name: string) => permitted.some((t) => t.name === name);
  const work = [
    has('ocr.search_stored_tables') && '• Search stored OCR tables by code, name, date or amount',
    has('tasks.list') && '• List, create, complete or delete tasks',
    has('calendar.list_upcoming') && '• Show or schedule calendar events',
    has('files.list_recent') && '• List recent Drive files',
    has('messenger.post_update') && '• Post an update to Messenger (asks first)',
  ].filter(Boolean);
  const personal = [
    '• "My day" briefing across your enabled apps',
    has('personal.quick_capture') && '• Quick note + task in one step',
    has('notes.search') && '• Search your notes',
    '• Tell you whether this workspace is yours or your team\'s, and switch workspaces',
    '• Explain how to use any Sorye app, and do quick maths or unit conversions (m² ↔ ft², km ↔ mi …)',
  ].filter(Boolean);
  return [
    `I can help with work and personal tasks in "${session.workspace.name}":`,
    work.length ? `Work:\n${work.join('\n')}` : '',
    `Personal & general:\n${personal.join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function appHowToAnswer(session: HubSession, app: AppCatalogEntry): { reply: string; actions: McpActionCard[] } {
  const enabled = allowedAppIdsForSession(session).has(app.id);
  const steps = app.usageIntro.steps.map((step, i) => `${i + 1}. ${step}`).join('\n');
  return {
    reply: `${app.name}: ${app.usageIntro.summary}\n${steps}${enabled ? '' : `\n\n${app.name} is not enabled in "${session.workspace.name}" yet.`}`,
    actions: enabled
      ? [{ kind: 'open-app', label: `Open ${app.name}`, appId: app.id, pane: 'left' }]
      : [{ kind: 'open-picker', label: 'Open Manage apps', appId: app.id }],
  };
}

function builtInAnswer(session: HubSession, text: string): { reply: string; actions: McpActionCard[] } {
  const firstName = session.user.displayName.split(/\s+/)[0] || 'there';
  if (/^(hi|hello|hey|hallo|servus|ahoj|szia|hola|good (morning|afternoon|evening))\b/i.test(text)) {
    return {
      reply: `Hi ${firstName}! Try one of these:\n${suggestionsFor(session, 3).join('\n')}`,
      actions: [],
    };
  }
  const app = findMentionedApp(text);
  if (app && /\b(how|use|using|what|explain|help|guide|work|works)\b/i.test(text)) {
    return appHowToAnswer(session, app);
  }
  if (/\b(m²|m2|sqm|square met(er|re)s?)\b/i.test(text)) {
    return {
      reply: '1 m² = 10.7639 ft² and 1 ft² = 0.0929 m². Ask e.g. "25 m2 to ft2" for an exact conversion.',
      actions: [],
    };
  }
  return {
    reply: `I can't answer open questions until the model server is running. Here is what I can do now:\n${suggestionsFor(session).join('\n')}`,
    actions: [],
  };
}

/**
 * Route prompts to permission-checked MCP tools when they ask for workspace data or
 * actions; everything else goes to the server model (no tools) or the built-in responder.
 */
export async function answerMcpChat(
  session: HubSession,
  promptText: string,
  options: { activeAppId?: string | null; bridge?: McpHubBridge; chat?: McpChatResponder } = {},
): Promise<McpChatAnswer> {
  const clean = promptText.trim();
  const lower = clean.toLowerCase();
  const traces: McpToolCallResult['trace'][] = [];
  const actions: McpActionCard[] = [];

  const runTool = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await executeMcpTool(session, name, args, { bridge: options.bridge });
    traces.push(res.trace);
    if (res.actions) actions.push(...res.actions);
    return res;
  };
  const toolReply = async (name: string, args: Record<string, unknown> = {}): Promise<McpChatAnswer> => {
    const res = await runTool(name, args);
    return { reply: res.message, traces, actions, engine: 'tools' };
  };
  const builtIn = (answer: { reply: string; actions: McpActionCard[] }): McpChatAnswer => ({
    reply: answer.reply,
    traces,
    actions: [...actions, ...answer.actions],
    engine: 'built-in',
  });

  if (/^(help|commands)\??$|\bwhat (can|do) you (do|help)|\bwhat are you able\b|\byour (capabilities|tools)\b/i.test(clean)) {
    return builtIn({ reply: capabilitiesAnswer(session), actions: [] });
  }

  if (
    /\b(belongs?|belonging|owner|owns|owned|whose|who am i|whoami|my role|am i (an? )?(admin|member|owner)|personal or (a )?team|team or (a )?personal|my workspace or)\b/i.test(
      clean,
    )
  ) {
    return toolReply('hub.whoami');
  }

  if (/\bswitch\b.*\b(workspace|team|personal)\b|\b(my|list|which|other) workspaces\b/i.test(clean)) {
    const target = clean
      .match(/\bswitch\b(?:\s+(?:me|workspace))?\s+(?:to|into)\s+(?:the\s+|my\s+)?(.+?)(?:\s+workspace)?\s*[.?!]?$/i)?.[1]
      ?.trim();
    return toolReply('hub.switch_workspace', target ? { workspace: target } : {});
  }

  if (/\b(my day|briefing|daily summary|agenda|what'?s on (today|my plate)|plan for today)\b/i.test(clean)) {
    return toolReply('hub.my_day_briefing');
  }

  const capture = clean.match(
    /^(?:quick\s+(?:note|capture)|capture|jot(?:\s+down)?|remember(?:\s+that)?)\s*:?\s*([\s\S]+)$/i,
  );
  if (capture?.[1]) {
    const [notePart, taskPart] = capture[1].split(/\s*(?:\+|\band\b)\s*(?:a\s+)?task\s*:?\s*/i);
    return toolReply('personal.quick_capture', {
      note: (notePart ?? '').trim() || capture[1].trim(),
      ...(taskPart?.trim() ? { task: taskPart.trim() } : {}),
    });
  }

  const computed = computeAnswer(clean);
  if (computed) {
    return builtIn({ reply: computed, actions: [] });
  }

  const mentionedApp = findMentionedApp(clean);
  const isHowTo =
    /\b(how (do|can|should|to)|what (is|does|are)|explain|tutorial|guide me|help me (use|with))\b/i.test(clean);
  const isGenericAppQuestion = Boolean(mentionedApp) && isHowTo;

  if (!isGenericAppQuestion) {
    if (/\b(drive|files?|uploads?)\b/i.test(clean) && /\b(recent|latest|list|show|my|last|new)\b/i.test(clean)) {
      const query = clean.match(/\b(?:named|called|matching)\s+["']?([^"']+?)["']?\s*$/i)?.[1];
      return toolReply('files.list_recent', query ? { query } : {});
    }

    const codeMatch =
      clean.match(/\b(\d{2}(?:\.\d{2})+(?:\.[A-Za-z0-9]+)?|\d{2}-\d{4,6})\b/) ??
      clean.match(/\bcode\s+["']?([A-Za-z0-9._-]+)["']?/i);
    if (codeMatch || /\b(ocr|pdf|invoices?|stored tables?|tables?|amounts?|baustelle|readings?)\b/i.test(clean)) {
    const gtMatch = clean.match(/(?:greater than|over|above|>)\s*([\d\s.,]+)/i);
    const ltMatch = clean.match(/(?:less than|under|below|<)\s*([\d\s.,]+)/i);
    const parseThreshold = (raw?: string) => {
      if (!raw) return undefined;
      const num = Number(raw.replace(/\s+/g, '').replace(',', '.'));
      return Number.isFinite(num) ? num : undefined;
    };
    const gtVal = parseThreshold(gtMatch?.[1]);
    const ltVal = parseThreshold(ltMatch?.[1]);
    const res = await runTool('ocr.search_stored_tables', {
      ...(codeMatch?.[1] ? { code: codeMatch[1] } : {}),
      ...(gtVal !== undefined
        ? { amountNotation: 'amount', amountOp: 'gt', amountValue: gtVal }
        : ltVal !== undefined
          ? { amountNotation: 'amount', amountOp: 'lt', amountValue: ltVal }
          : {}),
      scope: /\b(field|fields only)\b/i.test(lower) ? 'fields' : 'document',
    });
    return { reply: res.message, traces, actions, engine: 'tools' };
  }

    const taskRef = (re: RegExp) => clean.match(re)?.[1]?.trim().replace(/^["']|["'.?!]$/g, '');
    const deleteRef = taskRef(/\b(?:delete|remove)\s+(?:the\s+)?task\s*:?\s*(.+)$/i);
    if (deleteRef) return toolReply('tasks.delete', { taskId: deleteRef });
    const completeRef =
      taskRef(/\b(?:complete|finish|close)\s+(?:the\s+)?task\s*:?\s*(.+)$/i) ??
      taskRef(/\bmark\s+(?:the\s+)?(?:task\s+)?(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished)\s*[.!]?$/i);
    if (completeRef) return toolReply('tasks.complete', { taskId: completeRef });

    if (/\b(create|add)\s+(?:a\s+)?(?:new\s+)?task\b/i.test(clean)) {
      const title = clean.replace(/^.*?\b(?:create|add)\s+(?:a\s+)?(?:new\s+)?task\s*:?\s*/i, '').trim();
      return toolReply('tasks.create', { title: title || 'Follow up on workspace item' });
    }

    if (/\b(tasks?|todos?|to-dos?|board)\b/i.test(clean)) {
      return toolReply('tasks.list');
    }

    if (/\b(schedule|calendar|events?|deadlines?|meetings?|appointments?)\b/i.test(clean)) {
      const dateMatch = clean.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (/\b(schedule|add|book)\b/i.test(clean) && dateMatch?.[1]) {
        const timeMatch = clean.match(/\b(?:at\s+)?([01]\d|2[0-3]):([0-5]\d)\b/);
        const title =
          clean
            .replace(/\b(schedule|add|book)\b/i, '')
            .replace(dateMatch[1], '')
            .replace(timeMatch?.[0] ?? '', '')
            .replace(/\b(on|for|at)\s*$/i, '')
            .trim() || 'Workspace milestone';
        return toolReply('calendar.schedule_event', {
          title,
          date: dateMatch[1],
          ...(timeMatch ? { startTime: `${timeMatch[1]}:${timeMatch[2]}` } : {}),
        });
      }
      return toolReply('calendar.list_upcoming');
    }

    const saveNote = clean.match(/^(?:save|add|write|create)\s+(?:a\s+)?note\s*:?\s*(.+?)\s*:\s*([\s\S]+)$/i);
    if (saveNote?.[1] && saveNote[2]) {
      return toolReply('notes.create_or_append', { title: saveNote[1], body: saveNote[2] });
    }
    if (/\bnotes?\b/i.test(clean)) {
      const query = clean.match(/\bnotes?\s+(?:about|for|on|with|containing)\s+["']?(.+?)["']?\s*\??$/i)?.[1];
      return toolReply('notes.search', query ? { query } : {});
    }

    const openMatch = clean.match(/^(?:please\s+)?open\s+(?:the\s+)?([a-z0-9 _-]+?)(?:\s+app)?\s*[.!]?$/i);
    if (openMatch?.[1]) {
      return toolReply('hub.open_app', { appId: findMentionedApp(openMatch[1])?.id ?? openMatch[1].trim() });
    }

    if (
      /\b(gpu|webgpu|rodrigo|app slots|my plan|subscription|explain (my )?workspace|workspace status|enabled apps|installed apps)\b/i.test(
        clean,
      )
    ) {
      return toolReply('hub.explain_workspace');
    }
  }

  // Generic question: the model answers without tools; built-in responder if it is unavailable.
  try {
    const permitted = listMcpToolsForSession(session);
    const systemPrompt = `${buildMcpAssistantContextPrompt(
      session,
      permitted,
      getUserGpuPreference(session.user.id),
      options.activeAppId,
    )}

Answer the user's message directly in plain text (no JSON, no tables unless asked). Do not recite the workspace details above unless they are asked about. You cannot run tools in this reply: if the user wants a Sorye action, tell them the exact phrase to ask, such as "My day" or "Quick note: …".`;
    const { text, model } = await (options.chat ?? defaultChatResponder)(systemPrompt, clean);
    const reply = text.trim().slice(0, 4000);
    if (!reply) throw new Error('empty');
    return {
      reply,
      traces,
      actions: mentionedApp && allowedAppIdsForSession(session).has(mentionedApp.id)
        ? [{ kind: 'open-app', label: `Open ${mentionedApp.name}`, appId: mentionedApp.id, pane: 'left' }]
        : [],
      engine: 'server-llm',
      model,
    };
  } catch {
    return builtIn(builtInAnswer(session, clean));
  }
}
