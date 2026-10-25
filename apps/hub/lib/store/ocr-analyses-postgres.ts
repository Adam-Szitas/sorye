import { randomUUID } from 'crypto';
import { getDb } from '@sorye/db';
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

function newRecord(
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
): OcrAnalysis {
  return {
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
}

export async function listOcrAnalyses(
  userId: string,
  workspaceId: string,
): Promise<OcrAnalysisList> {
  if (!(await assertMember(userId, workspaceId))) return { access: 'denied' };
  const analyses = await selectOcrAnalyses(getDb(), workspaceId);
  return { access: 'ok', analyses };
}

export async function getOcrAnalysis(
  userId: string,
  workspaceId: string,
  id: string,
): Promise<OcrAnalysisRead> {
  if (!(await assertMember(userId, workspaceId))) return { access: 'denied' };
  const analysis = await selectOcrAnalysis(getDb(), workspaceId, id);
  return { access: 'ok', analysis };
}

export async function createOcrAnalysis(
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
  return insertOcrAnalysis(getDb(), newRecord(userId, workspaceId, input));
}

export async function updateOcrAnalysis(
  userId: string,
  workspaceId: string,
  id: string,
  patch: Pick<OcrAnalysis, 'status' | 'pattern' | 'error'> & {
    vector?: OcrAnalysis['vector'];
  },
): Promise<OcrAnalysis | null> {
  if (!(await assertMember(userId, workspaceId))) return null;
  const current = await selectOcrAnalysis(getDb(), workspaceId, id);
  if (!current) return null;
  const next: OcrAnalysis = { ...current, ...patch };
  await updateOcrAnalysisRow(getDb(), next);
  return next;
}

function libraryRange(query: OcrLibraryQuery) {
  return {
    from: query.from ? utcDayRange(query.from).start : undefined,
    toExclusive: query.to ? utcDayRange(query.to).end : undefined,
    ids: query.ids,
  };
}

export async function queryOcrLibrary(
  userId: string,
  workspaceId: string,
  query: OcrLibraryQuery,
): Promise<{ access: 'denied' } | { access: 'ok'; hits: OcrLibraryHit[] }> {
  if (!(await assertMember(userId, workspaceId))) return { access: 'denied' };
  const sources = await selectOcrLibrarySources(getDb(), workspaceId, libraryRange(query));
  return { access: 'ok', hits: queryLibrary(sources, query) };
}

export async function renameOcrAnalysis(
  userId: string,
  workspaceId: string,
  id: string,
  fileName: string,
): Promise<OcrAnalysis | null> {
  if (!(await assertMember(userId, workspaceId))) return null;
  const current = await selectOcrAnalysis(getDb(), workspaceId, id);
  if (!current) return null;
  await renameOcrAnalysisRow(getDb(), workspaceId, id, fileName);
  return { ...current, fileName };
}
