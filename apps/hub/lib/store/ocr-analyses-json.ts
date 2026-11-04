import { randomUUID } from 'crypto';
import {
  readablePattern,
  type OcrAnalysis,
  type OcrAnalysisSummary,
  type OcrAiPage,
  type OcrDocumentVector,
  type OcrLibraryHit,
  type OcrLibraryQuery,
  type OcrPatternDocument,
  type OcrWorkSnapshot,
} from '@sorye/types';
import { queryLibrary, type OcrLibrarySource } from '@/lib/ocr/library-query';
import { buildVector, flattenLines } from '@/lib/ocr/vector';
import { stampWorkColumns } from '@/lib/ocr/work-timing';
import { MAX_OCR_ANALYSES } from '@/lib/security-limits';
import { jsonDataFile } from './json-file';
import { getHubSession, getHubSessionForWorkspace } from './json-store';

interface OcrAnalysisStore {
  analyses: OcrAnalysis[];
}

const storeFile = jsonDataFile<OcrAnalysisStore>('ocr-analyses.json', () => ({
  analyses: [],
}));

async function assertMember(userId: string, workspaceId: string) {
  const session = await getHubSessionForWorkspace(userId, workspaceId);
  if (!session) return null;
  if (session.workspace.id !== workspaceId) return null;
  if (!session.workspace.memberIds.includes(userId)) return null;
  return session;
}

function present(record: OcrAnalysis): OcrAnalysis {
  const pages = record.pages ?? [];
  const vector =
    record.vector?.version === 1 && Array.isArray(record.vector.pageStarts)
      ? record.vector
      : buildVector(pages);
  return {
    ...record,
    pages,
    vector,
    lines: flattenLines(pages),
    pattern: record.pattern ? readablePattern(record.pattern) : null,
    status:
      record.status === 'ready' ||
      record.status === 'extracting' ||
      record.status === 'rows_only'
        ? record.status
        : 'rows_only',
  };
}

export type OcrAnalysisRead =
  | { access: 'denied' }
  | { access: 'ok'; analysis: OcrAnalysis | null };

export type OcrAnalysisList =
  | { access: 'denied' }
  | { access: 'ok'; analyses: OcrAnalysisSummary[] };

export async function listOcrAnalyses(
  userId: string,
  workspaceId: string,
  offset = 0,
): Promise<OcrAnalysisList> {
  if (!(await assertMember(userId, workspaceId))) return { access: 'denied' };
  const store = await storeFile.read();
  const analyses = store.analyses
    .filter((row) => row.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .slice(offset, offset + 20)
    .map(({ id, fileName, model, status, error, createdAt }) => ({ id, fileName, model, status, error, createdAt }));
  return { access: 'ok', analyses };
}

export async function getOcrAnalysis(
  userId: string,
  workspaceId: string,
  id: string,
): Promise<OcrAnalysisRead> {
  if (!(await assertMember(userId, workspaceId))) return { access: 'denied' };
  const store = await storeFile.read();
  const analysis =
    store.analyses.find(
      (row) => row.id === id && row.workspaceId === workspaceId,
    )     ?? null;
  return { access: 'ok', analysis: analysis ? present(analysis) : null };
}

export async function createOcrAnalysis(
  userId: string,
  workspaceId: string,
  input: {
    id?: string;
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
  const record: OcrAnalysis = present({
    id: input.id ?? `ocr-${randomUUID().slice(0, 12)}`,
    workspaceId,
    createdBy: userId,
    fileName: input.fileName,
    model: input.model,
    status: input.status,
    pages: input.pages,
    pattern: input.pattern,
    error: input.error,
    vector: input.vector,
    lines: [],
    createdAt: new Date().toISOString(),
  });
  return storeFile.update((store) => {
    store.analyses.unshift(record);
    return record;
  });
}

export async function updateOcrAnalysis(
  userId: string,
  workspaceId: string,
  id: string,
  patch: Pick<OcrAnalysis, 'status' | 'pattern' | 'error'> & {
    vector?: OcrAnalysis['vector'];
    workStartedAt?: string | null;
    workFinishedAt?: string | null;
    durationMs?: number | null;
  },
): Promise<OcrAnalysis | null> {
  if (!(await assertMember(userId, workspaceId))) return null;
  return storeFile.update((store) => {
    const row = store.analyses.find(
      (item) => item.id === id && item.workspaceId === workspaceId,
    );
    if (!row) return null;
    row.status = patch.status;
    row.pattern = patch.pattern;
    row.error = patch.error;
    if (patch.vector) row.vector = patch.vector;
    if (patch.durationMs !== undefined) row.durationMs = patch.durationMs;
    const stamped = stampWorkColumns(present(row));
    row.workStartedAt = stamped.workStartedAt ?? null;
    row.workFinishedAt = stamped.workFinishedAt ?? null;
    row.durationMs = stamped.durationMs ?? null;
    return present(row);
  });
}

export async function listOcrWork(
  userId: string,
  workspaceId: string,
): Promise<{ access: 'denied' } | { access: 'ok'; work: OcrWorkSnapshot }> {
  if (!(await assertMember(userId, workspaceId))) return { access: 'denied' };
  const store = await storeFile.read();
  const finished = store.analyses
    .filter((row) => row.workspaceId === workspaceId && (row.status === 'ready' || row.status === 'rows_only'))
    .map((row) => stampWorkColumns(present(row)))
    .sort((a, b) =>
      (b.workFinishedAt ?? b.createdAt).localeCompare(a.workFinishedAt ?? a.createdAt)
      || b.createdAt.localeCompare(a.createdAt),
    );
  let timedCount = 0;
  let totalDurationMs = 0;
  for (const row of finished) {
    if (typeof row.durationMs !== 'number') continue;
    timedCount += 1;
    totalDurationMs += row.durationMs;
  }
  return {
    access: 'ok',
    work: {
      count: finished.length,
      timedCount,
      totalDurationMs: timedCount > 0 ? totalDurationMs : null,
      jobs: finished.slice(0, 20).map((row) => {
        const pages = row.pages ?? [];
        let rowCount = 0;
        for (const page of pages) rowCount += page.rows?.length ?? 0;
        return {
          id: row.id,
          fileName: row.fileName,
          status: row.status === 'ready' ? 'ready' as const : 'rows_only' as const,
          pageCount: pages.length,
          rowCount,
          createdAt: row.createdAt,
          workStartedAt: row.workStartedAt ?? null,
          workFinishedAt: row.workFinishedAt ?? null,
          durationMs: typeof row.durationMs === 'number' ? row.durationMs : null,
        };
      }),
    },
  };
}

export async function queryOcrLibrary(
  userId: string,
  workspaceId: string,
  query: OcrLibraryQuery,
): Promise<{ access: 'denied' } | { access: 'ok'; hits: OcrLibraryHit[] }> {
  if (!(await assertMember(userId, workspaceId))) return { access: 'denied' };
  const store = await storeFile.read();
  const sources: OcrLibrarySource[] = store.analyses
    .filter((row) => row.workspaceId === workspaceId)
    .map((row) => ({
      id: row.id,
      fileName: row.fileName,
      createdAt: row.createdAt,
      status: row.status,
      pattern: row.pattern,
      pages: row.pages,
    }));
  return { access: 'ok', hits: queryLibrary(sources, query) };
}

export async function renameOcrAnalysis(
  userId: string,
  workspaceId: string,
  id: string,
  fileName: string,
): Promise<OcrAnalysis | null> {
  if (!(await assertMember(userId, workspaceId))) return null;
  return storeFile.update((store) => {
    const row = store.analyses.find((item) => item.id === id && item.workspaceId === workspaceId);
    if (!row) return null;
    row.fileName = fileName;
    return present(row);
  });
}
