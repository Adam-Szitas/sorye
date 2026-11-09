import {
  createDefaultTasksBoard,
  type CalendarEvent,
  type HubSession,
  type MailMessage,
  type Note,
  type OcrLibraryHit,
  type OcrLibraryQuery,
  type RodrigoCapabilities,
  type RodrigoDocumentKind,
  type RodrigoTopology,
  type TasksBoard,
  type WorkspaceEventName,
  type WorkspaceEventPayload,
  type WorkspaceFile,
} from '@sorye/types';
import { publishWorkspaceEvent } from '@/lib/events';
import { listWorkspaceFiles } from '@/lib/files';
import { createHandoff } from '@/lib/handoffs';
import { bootstrapMail } from '@/lib/mail';
import { parseLibraryQuery } from '@/lib/ocr/library-query';
import { emptyPattern, supplementFromRows } from '@/lib/ocr/pattern';
import { getRodrigoCapabilities, getRodrigoTopology } from '@/lib/rodrigo/service-client';
import { getOcrAnalysis, queryOcrLibrary, renameOcrAnalysis } from '@/lib/store/ocr-analyses';
import { getWorkspaceDoc, putWorkspaceDoc } from '@/lib/store/workspace-docs';
import {
  parseCalendarEvents,
  parseNotes,
  parseTasksBoard,
} from '@/lib/workspace-docs-validate';

/**
 * Hub Event & Rodrigo Dispatcher for MCP.
 *
 * The MCP layer never imports database schemas or touches backend services directly.
 * Every domain intent is emitted through Hub, which authorizes the session and
 * redirects document & capability operations to Rodrigo (via signed Ed25519 assertions
 * in the workspace document router / Rodrigo service client).
 */
export interface McpHubBridge {
  readDocument(
    session: HubSession,
    kind: RodrigoDocumentKind,
  ): Promise<{ revision: number; payload: Record<string, unknown> | null }>;
  writeDocument(
    session: HubSession,
    kind: RodrigoDocumentKind,
    payload: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<{ revision: number; payload: Record<string, unknown> }>;
  emitEvent(
    session: HubSession,
    name: WorkspaceEventName,
    payload: WorkspaceEventPayload,
  ): Promise<{ delivered: boolean; eventId: string }>;
  queryOcrTables(
    session: HubSession,
    query: OcrLibraryQuery,
  ): Promise<OcrLibraryHit[]>;
  readOcrAnalysis(
    session: HubSession,
    id: string,
  ): Promise<{
    id: string;
    fileName: string;
    status: string;
    summary: string;
    fields: Record<string, string>;
    normalizedRows: Array<{ page: number; row: number; id: string | null; cells: string[] }>;
  } | null>;
  renameOcrTable(
    session: HubSession,
    id: string,
    fileName: string,
  ): Promise<{ id: string; fileName: string } | null>;
  handoffOcrToProtocolio(
    session: HubSession,
    id: string,
  ): Promise<{ handoffId: string; title: string } | null>;
  listDriveFiles?: (
    session: HubSession,
  ) => Promise<WorkspaceFile[]>;
  listMailInbox?: (
    session: HubSession,
  ) => Promise<{
    generatedAddress: string;
    inbox: MailMessage[];
    sent: MailMessage[];
  }>;
  readRodrigoCapabilities(session: HubSession): Promise<RodrigoCapabilities | null>;
  readRodrigoTopology(session: HubSession): Promise<RodrigoTopology | null>;
}

export function createDefaultMcpHubBridge(): McpHubBridge {
  return {
    async readDocument(session, kind) {
      const res = await getWorkspaceDoc(
        session.user.id,
        session.workspace.id,
        kind,
        session,
      );
      if (res.access === 'denied') {
        throw new Error(`Access denied for ${kind}`);
      }
      return {
        revision: res.doc?.revision ?? res.revision ?? 0,
        payload: res.doc?.payload ?? null,
      };
    },

    async writeDocument(session, kind, payload, expectedRevision) {
      const saved = await putWorkspaceDoc(
        session.user.id,
        session.workspace.id,
        kind,
        payload,
        expectedRevision !== undefined ? { expectedRevision } : undefined,
        session,
      );
      if (!saved) {
        throw new Error(`Write denied for ${kind}`);
      }
      return {
        revision: saved.revision,
        payload: saved.payload,
      };
    },

    async emitEvent(session, name, payload) {
      const res = await publishWorkspaceEvent({
        userId: session.user.id,
        workspaceId: session.workspace.id,
        name,
        payload,
      });
      return {
        delivered: Boolean(res?.delivered),
        eventId: res?.event.id ?? `evt-${Date.now()}`,
      };
    },

    async queryOcrTables(session, rawQuery) {
      const parsed = parseLibraryQuery(rawQuery);
      const res = await queryOcrLibrary(session.user.id, session.workspace.id, parsed);
      if (res.access === 'denied') throw new Error('OCR library access denied');
      return res.hits;
    },

    async readOcrAnalysis(session, id) {
      const res = await getOcrAnalysis(session.user.id, session.workspace.id, id);
      if (res.access === 'denied' || !res.analysis) return null;
      const pattern = supplementFromRows(
        res.analysis.pattern ?? emptyPattern(),
        res.analysis.pages,
      );
      return {
        id: res.analysis.id,
        fileName: res.analysis.fileName,
        status: res.analysis.status,
        summary: pattern.summary,
        fields: pattern.fields,
        normalizedRows: (pattern.normalizedRows ?? []).slice(0, 80),
      };
    },

    async renameOcrTable(session, id, fileName) {
      const updated = await renameOcrAnalysis(
        session.user.id,
        session.workspace.id,
        id,
        fileName,
      );
      if (!updated) return null;
      return { id: updated.id, fileName: updated.fileName };
    },

    async handoffOcrToProtocolio(session, id) {
      const res = await getOcrAnalysis(session.user.id, session.workspace.id, id);
      if (res.access === 'denied' || !res.analysis) return null;
      const pattern = supplementFromRows(
        res.analysis.pattern ?? emptyPattern(),
        res.analysis.pages,
      );
      const handoff = await createHandoff(session.workspace.id, {
        sourceAppId: 'ocr',
        targetAppId: 'protocolio',
        kind: 'pdf-template',
        title: `OCR table · ${res.analysis.fileName}`,
        summary: `${pattern.normalizedRows?.length ?? 0} normalized rows from ${res.analysis.fileName}`,
        payload: {
          analysisId: res.analysis.id,
          fileName: res.analysis.fileName,
          fields: pattern.fields,
          normalizedColumns: pattern.normalizedColumns,
          normalizedRows: (pattern.normalizedRows ?? []).slice(0, 250),
        },
      });
      return { handoffId: handoff.id, title: handoff.title };
    },

    async readRodrigoCapabilities(session) {
      try {
        return await getRodrigoCapabilities({
          userId: session.user.id,
          workspaceId: session.workspace.id,
        });
      } catch {
        return null;
      }
    },

    async readRodrigoTopology(session) {
      try {
        return await getRodrigoTopology({
          userId: session.user.id,
          workspaceId: session.workspace.id,
        });
      } catch {
        return null;
      }
    },

    async listDriveFiles(session) {
      return listWorkspaceFiles(session.workspace.id);
    },

    async listMailInbox(session) {
      const boot = await bootstrapMail({
        workspaceId: session.workspace.id,
        workspaceName: session.workspace.name,
        userId: session.user.id,
      });
      return {
        generatedAddress: boot.profile.generatedAddress,
        inbox: boot.inbox,
        sent: boot.sent,
      };
    },
  };
}

export async function readTasksBoardViaBridge(
  bridge: McpHubBridge,
  session: HubSession,
): Promise<{ board: TasksBoard; revision: number }> {
  const doc = await bridge.readDocument(session, 'tasks');
  if (!doc.payload) {
    return { board: createDefaultTasksBoard(), revision: doc.revision };
  }
  const board = parseTasksBoard(doc.payload.board ?? doc.payload);
  return { board, revision: doc.revision };
}

export async function readNotesViaBridge(
  bridge: McpHubBridge,
  session: HubSession,
): Promise<{ notes: Note[]; revision: number }> {
  const doc = await bridge.readDocument(session, 'notes');
  if (!doc.payload) {
    return { notes: [], revision: doc.revision };
  }
  const notes = parseNotes(doc.payload.notes ?? doc.payload);
  return { notes, revision: doc.revision };
}

export async function readCalendarViaBridge(
  bridge: McpHubBridge,
  session: HubSession,
): Promise<{ events: CalendarEvent[]; revision: number }> {
  const doc = await bridge.readDocument(session, 'calendar');
  if (!doc.payload) {
    return { events: [], revision: doc.revision };
  }
  const events = parseCalendarEvents(doc.payload.events ?? doc.payload);
  return { events, revision: doc.revision };
}
