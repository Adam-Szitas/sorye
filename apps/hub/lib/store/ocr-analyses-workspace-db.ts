import { randomUUID } from 'crypto';
import type {
  OcrAnalysis,
  OcrAiPage,
  OcrDocumentVector,
  OcrLibraryHit,
  OcrLibraryQuery,
  OcrPatternDocument,
} from '@sorye/types';
import { queryLibrary, utcDayRange } from '@/lib/ocr/library-query';
import { flattenLines } from '@/lib/ocr/vector';
import type { WorkspaceDb } from '@/lib/workspace-db';
import { getHubSession } from './postgres-store';
import {
  insertOcrAnalysis,
  selectOcrAnalyses,
  renameOcrAnalysisRow,
  selectOcrAnalysis,
  selectOcrLibrarySources,
  updateOcrAnalysisRow,
} from './ocr-analyses-db';
import type { OcrAnalysisList, OcrAnalysisRead } from './ocr-analyses-json';

async function assertMember(userId: string, workspaceId: string) {
  const session = await getHubSession(userId);
  if (!session) return null;
  if (session.workspace.id !== workspaceId) return null;
  if (!session.workspace.memberIds.includes(userId)) return null;
  return session;
}

export async function listOcrAnalyses(
  db: WorkspaceDb,
  userId: string,
  workspaceId: string,
): Promise<OcrAnalysisList> {
  if (!(await assertMember(userId, workspaceId))) return { access: 'denied' };
  const analyses = await selectOcrAnalyses(db, workspaceId);
  return { access: 'ok', analyses };
}

export async function getOcrAnalysis(
  db: WorkspaceDb,
  userId: string,
  workspaceId: string,
  id: string,
): Promise<OcrAnalysisRead> {
  if (!(await assertMember(userId, workspaceId))) return { access: 'denied' };
  const analysis = await selectOcrAnalysis(db, workspaceId, id);
  return { access: 'ok', analysis };
}

export async function createOcrAnalysis(
  db: WorkspaceDb,
  userId: string,
  workspaceId: string,
  input: {
    fileName: string;
    model: string;
    status: OcrAnalysis['status'];
    pages: OcrAiPage[];
    pattern: OcrPatternDocument | null;
    error: string | null;
    vector: OcrDocumentVector;
  },
): Promise<OcrAnalysis | null> {
  if (!(await assertMember(userId, workspaceId))) return null;
  const record: OcrAnalysis = {
    id: `ocr-${randomUUID().slice(0, 12)}`,
    workspaceId,
    createdBy: userId,
    fileName: input.fileName,
    model: input.model,
    status: input.status,
    pages: input.pages,
    lines: flattenLines(input.pages),
    vector: input.vector,
    pattern: input.pattern,
    error: input.error,
    createdAt: new Date().toISOString(),
  };
  return insertOcrAnalysis(db, record);
}

export async function updateOcrAnalysis(
  db: WorkspaceDb,
  userId: string,
  workspaceId: string,
  id: string,
  patch: Pick<OcrAnalysis, 'status' | 'pattern' | 'error'> & {
    vector?: OcrAnalysis['vector'];
  },
): Promise<OcrAnalysis | null> {
  if (!(await assertMember(userId, workspaceId))) return null;
  const current = await selectOcrAnalysis(db, workspaceId, id);
  if (!current) return null;
  const next: OcrAnalysis = { ...current, ...patch };
  await updateOcrAnalysisRow(db, next);
  return next;
}

export async function queryOcrLibrary(
  db: WorkspaceDb,
  userId: string,
  workspaceId: string,
  query: OcrLibraryQuery,
): Promise<{ access: 'denied' } | { access: 'ok'; hits: OcrLibraryHit[] }> {
  if (!(await assertMember(userId, workspaceId))) return { access: 'denied' };
  const sources = await selectOcrLibrarySources(db, workspaceId, {
    from: query.from ? utcDayRange(query.from).start : undefined,
    toExclusive: query.to ? utcDayRange(query.to).end : undefined,
    ids: query.ids,
  });
  return { access: 'ok', hits: queryLibrary(sources, query) };
}

export async function renameOcrAnalysis(
  db: WorkspaceDb,
  userId: string,
  workspaceId: string,
  id: string,
  fileName: string,
): Promise<OcrAnalysis | null> {
  if (!(await assertMember(userId, workspaceId))) return null;
  const current = await selectOcrAnalysis(db, workspaceId, id);
  if (!current) return null;
  await renameOcrAnalysisRow(db, workspaceId, id, fileName);
  return { ...current, fileName };
}
