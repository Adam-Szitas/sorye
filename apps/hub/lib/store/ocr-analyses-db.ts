import * as schema from '@sorye/db/schema';
import {
  readablePattern,
  type OcrAnalysis,
  type OcrAnalysisSummary,
  type OcrAiPage,
  type OcrAnalysisStatus,
  type OcrDocumentVector,
  type OcrPatternDocument,
} from '@sorye/types';
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { MAX_OCR_ANALYSES } from '@/lib/security-limits';
import { OCR_LIBRARY_LIMIT, type OcrLibrarySource } from '@/lib/ocr/library-query';
import { buildVector, flattenLines } from '@/lib/ocr/vector';
import type { WorkspaceDb } from '@/lib/workspace-db';

function asStatus(value: string): OcrAnalysisStatus {
  if (value === 'ready' || value === 'extracting' || value === 'rows_only') return value;
  return 'rows_only';
}

function asVector(value: unknown, pages: OcrAiPage[]): OcrDocumentVector {
  if (!value || typeof value !== 'object') return buildVector(pages);
  const vector = value as OcrDocumentVector;
  if (vector.version !== 1 || !Array.isArray(vector.pageStarts) || !Array.isArray(vector.notes)) {
    return buildVector(pages);
  }
  return vector;
}

function asPages(value: unknown): OcrAiPage[] {
  if (!Array.isArray(value)) return [];
  const pages: OcrAiPage[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const page = item as { page?: unknown; rows?: unknown };
    const number = typeof page.page === 'number' ? page.page : pages.length + 1;
    const rows = Array.isArray(page.rows)
      ? page.rows.filter((row): row is string => typeof row === 'string')
      : [];
    pages.push({ page: number, rows });
  }
  return pages;
}

function rowToAnalysis(row: typeof schema.ocrAnalyses.$inferSelect): OcrAnalysis {
  const pattern = row.pattern;
  const pages = asPages(row.pages);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    createdBy: row.createdBy,
    fileName: row.fileName,
    model: row.model,
    status: asStatus(row.status),
    pages,
    lines: flattenLines(pages),
    vector: asVector(row.vector, pages),
    pattern:
      pattern && typeof pattern === 'object'
        ? readablePattern(pattern as unknown as OcrPatternDocument)
        : null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function insertOcrAnalysis(
  db: WorkspaceDb,
  record: OcrAnalysis,
): Promise<OcrAnalysis> {
  await db.insert(schema.ocrAnalyses).values({
    id: record.id,
    workspaceId: record.workspaceId,
    createdBy: record.createdBy,
    fileName: record.fileName,
    model: record.model,
    status: record.status,
    pages: record.pages,
    vector: record.vector,
    pattern: record.pattern as unknown as Record<string, unknown> | null,
    error: record.error,
    createdAt: new Date(record.createdAt),
  }).onConflictDoNothing();

  return record;
}

export async function updateOcrAnalysisRow(
  db: WorkspaceDb,
  record: Pick<OcrAnalysis, 'id' | 'workspaceId' | 'status' | 'pattern' | 'error' | 'vector'>,
): Promise<void> {
  await db
    .update(schema.ocrAnalyses)
    .set({
      status: record.status,
      pattern: record.pattern as unknown as Record<string, unknown> | null,
      error: record.error,
      vector: record.vector,
    })
    .where(
      and(
        eq(schema.ocrAnalyses.id, record.id),
        eq(schema.ocrAnalyses.workspaceId, record.workspaceId),
      ),
    );
}

export async function selectOcrLibrarySources(
  db: WorkspaceDb,
  workspaceId: string,
  range: { from?: Date; toExclusive?: Date; ids?: string[] },
): Promise<OcrLibrarySource[]> {
  const filters = [eq(schema.ocrAnalyses.workspaceId, workspaceId)];
  if (range.ids && range.ids.length > 0) {
    filters.push(inArray(schema.ocrAnalyses.id, range.ids));
  }
  if (range.from) filters.push(gte(schema.ocrAnalyses.createdAt, range.from));
  if (range.toExclusive) filters.push(lt(schema.ocrAnalyses.createdAt, range.toExclusive));
  const rows = await db
    .select({
      id: schema.ocrAnalyses.id,
      fileName: schema.ocrAnalyses.fileName,
      createdAt: schema.ocrAnalyses.createdAt,
      status: schema.ocrAnalyses.status,
      pattern: schema.ocrAnalyses.pattern,
      pages: schema.ocrAnalyses.pages,
    })
    .from(schema.ocrAnalyses)
    .where(and(...filters))
    .orderBy(desc(schema.ocrAnalyses.createdAt))
    .limit(OCR_LIBRARY_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    createdAt: row.createdAt.toISOString(),
    status: asStatus(row.status),
    pattern:
      row.pattern && typeof row.pattern === 'object'
        ? (row.pattern as unknown as OcrPatternDocument)
        : null,
    pages: asPages(row.pages),
  }));
}

export async function renameOcrAnalysisRow(
  db: WorkspaceDb,
  workspaceId: string,
  id: string,
  fileName: string,
): Promise<void> {
  await db
    .update(schema.ocrAnalyses)
    .set({ fileName })
    .where(and(eq(schema.ocrAnalyses.id, id), eq(schema.ocrAnalyses.workspaceId, workspaceId)));
}

export async function selectOcrAnalyses(
  db: WorkspaceDb, workspaceId: string, offset = 0,
): Promise<OcrAnalysisSummary[]> {
  const rows = await db.select({
    id: schema.ocrAnalyses.id, fileName: schema.ocrAnalyses.fileName,
    model: schema.ocrAnalyses.model, status: schema.ocrAnalyses.status,
    error: schema.ocrAnalyses.error, createdAt: schema.ocrAnalyses.createdAt,
  }).from(schema.ocrAnalyses).where(eq(schema.ocrAnalyses.workspaceId, workspaceId))
    .orderBy(desc(schema.ocrAnalyses.createdAt), desc(schema.ocrAnalyses.id)).limit(20).offset(offset);
  return rows.map(row => ({ ...row, status: asStatus(row.status), createdAt: row.createdAt.toISOString() }));
}

export async function selectOcrAnalysis(
  db: WorkspaceDb,
  workspaceId: string,
  id: string,
): Promise<OcrAnalysis | null> {
  const [row] = await db
    .select()
    .from(schema.ocrAnalyses)
    .where(eq(schema.ocrAnalyses.id, id))
    .limit(1);
  if (!row || row.workspaceId !== workspaceId) return null;
  return rowToAnalysis(row);
}
