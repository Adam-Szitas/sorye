import { getRodrigoResource, listRodrigoResources, RodrigoResponseError } from '@/lib/rodrigo/service-client';
import type { CanvasBoard, CanvasBoardSummary, CanvasDocument } from '@sorye/types';

function payloadBoard(resource: Record<string, unknown>, revision: number, workspaceId: string): CanvasBoard {
  const { id, title, document, updatedAt } = resource;
  if (typeof id !== 'string' || typeof title !== 'string' || !document || typeof document !== 'object'
    || !Array.isArray((document as CanvasDocument).items) || typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))) {
    throw new RodrigoResponseError(502, 'invalid_canvas_resource', '00000000-0000-4000-8000-000000000000');
  }
  const doc = document as CanvasDocument;
  const when = updatedAt;
  return {
    id, workspaceId, title, createdBy: 'workspace', updatedBy: 'workspace', createdAt: when, updatedAt: when,
    revision, itemCount: doc.items.length, document: doc,
  };
}

export function toCanvasSummary(board: CanvasBoard): CanvasBoardSummary {
  const { document: _document, ...summary } = board;
  return summary;
}

export async function readCanvasBoard(context: { userId: string; workspaceId: string }, boardId: string) {
  const snapshot = await getRodrigoResource(context, 'canvas', 'board', boardId);
  return snapshot.resource ? payloadBoard(snapshot.resource, snapshot.revision, context.workspaceId) : null;
}

export async function listCanvasBoards(context: { userId: string; workspaceId: string }) {
  const out: CanvasBoard[] = [];
  let cursor: string | undefined;
  do {
    const page = await listRodrigoResources(context, 'canvas', 'board', 100, cursor);
    out.push(...page.items.map((item) => payloadBoard(item.resource, item.revision, context.workspaceId)));
    cursor = page.nextCursor ?? undefined;
  } while (cursor && out.length <= 5000);
  return out;
}

export function canvasAccess(session: { user: { id: string }; workspace: { id: string; memberIds: string[]; selectedAppIds: string[] } }) {
  return session.workspace.memberIds.includes(session.user.id) && session.workspace.selectedAppIds.includes('canvas');
}
