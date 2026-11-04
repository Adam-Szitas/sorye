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
import type { AnalyticsOcrJob, OcrWorkSnapshot } from '@sorye/types';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
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
    workStartedAt: row.workStartedAt?.toISOString() ?? null,
    workFinishedAt: row.workFinishedAt?.toISOString() ?? null,
    durationMs: row.durationMs ?? null,
  };
}

const workColumnsReady = new WeakMap<object, Promise<void>>();

/** Nullable columns. Safe to run more than once; skipped after the first success per pool. */
export function ensureOcrWorkColumns(db: WorkspaceDb): Promise<void> {
  const existing = workColumnsReady.get(db);
  if (existing) return existing;
  const pending = db
    .execute(sql`
      ALTER TABLE ocr_analyses
        ADD COLUMN IF NOT EXISTS work_started_at timestamptz,
        ADD COLUMN IF NOT EXISTS work_finished_at timestamptz,
        ADD COLUMN IF NOT EXISTS duration_ms integer
    `)
    .then(() => undefined)
    .catch((err: unknown) => {
      workColumnsReady.delete(db);
      throw err;
    });
  workColumnsReady.set(db, pending);
  return pending;
}

function asDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
  record: Pick<OcrAnalysis, 'id' | 'workspaceId' | 'status' | 'pattern' | 'error' | 'vector'> &
    Partial<Pick<OcrAnalysis, 'workStartedAt' | 'workFinishedAt' | 'durationMs'>>,
): Promise<void> {
  await ensureOcrWorkColumns(db);
  await db
    .update(schema.ocrAnalyses)
    .set({
      status: record.status,
      pattern: record.pattern as unknown as Record<string, unknown> | null,
      error: record.error,
      vector: record.vector,
      workStartedAt: asDate(record.workStartedAt),
      workFinishedAt: asDate(record.workFinishedAt),
      durationMs: record.durationMs ?? null,
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

function modelTimeSql() {
  return sql`coalesce(
    ${schema.ocrAnalyses.durationMs},
    case
      when coalesce(${schema.ocrAnalyses.vector}->>'gpuStartedAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
       and coalesce(${schema.ocrAnalyses.vector}->>'gpuFinishedAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      then greatest(0, (
        extract(epoch from (
          (${schema.ocrAnalyses.vector}->>'gpuFinishedAt')::timestamptz
          - (${schema.ocrAnalyses.vector}->>'gpuStartedAt')::timestamptz
        )) * 1000
      )::int)
      else null
    end
  )`;
}

function clockSql(
  column: typeof schema.ocrAnalyses.workStartedAt | typeof schema.ocrAnalyses.workFinishedAt,
  key: 'gpuStartedAt' | 'gpuFinishedAt',
) {
  return sql`coalesce(
    ${column},
    case
      when coalesce(${schema.ocrAnalyses.vector}->>${key}, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      then (${schema.ocrAnalyses.vector}->>${key})::timestamptz
      else null
    end
  )`;
}

function asInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(2_147_483_647, Math.floor(n));
}

function asIso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function resultRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return [];
}

/** Finished analyses for the analytics page. Transcripts stay in the table. */
export async function selectOcrWorkSnapshot(
  db: WorkspaceDb,
  workspaceId: string,
): Promise<OcrWorkSnapshot> {
  await ensureOcrWorkColumns(db);
  const finished = () => and(
    eq(schema.ocrAnalyses.workspaceId, workspaceId),
    inArray(schema.ocrAnalyses.status, ['ready', 'rows_only']),
  );
  const [totalsResult, jobsResult] = await Promise.all([
    db.execute(sql`
      select
        count(*)::int as count,
        count(${modelTimeSql()})::int as timed_count,
        coalesce(sum(${modelTimeSql()}), 0)::int as total_duration_ms
      from ${schema.ocrAnalyses}
      where ${finished()}
    `),
    db.execute(sql`
      select
        ${schema.ocrAnalyses.id} as id,
        ${schema.ocrAnalyses.fileName} as file_name,
        ${schema.ocrAnalyses.status} as status,
        ${schema.ocrAnalyses.createdAt} as created_at,
        ${clockSql(schema.ocrAnalyses.workStartedAt, 'gpuStartedAt')} as work_started_at,
        ${clockSql(schema.ocrAnalyses.workFinishedAt, 'gpuFinishedAt')} as work_finished_at,
        ${modelTimeSql()} as duration_ms,
        case
          when jsonb_typeof(${schema.ocrAnalyses.pages}) = 'array'
          then jsonb_array_length(${schema.ocrAnalyses.pages})
          else 0
        end as page_count,
        case
          when jsonb_typeof(${schema.ocrAnalyses.pages}) = 'array' then coalesce((
            select sum(
              case
                when jsonb_typeof(elem->'rows') = 'array' then jsonb_array_length(elem->'rows')
                else 0
              end
            )
            from jsonb_array_elements(${schema.ocrAnalyses.pages}) as page(elem)
          ), 0)
          else 0
        end as row_count
      from ${schema.ocrAnalyses}
      where ${finished()}
      order by ${clockSql(schema.ocrAnalyses.workFinishedAt, 'gpuFinishedAt')} desc nulls last,
        ${schema.ocrAnalyses.createdAt} desc
      limit 20
    `),
  ]);
  const totals = resultRows(totalsResult)[0] ?? {};
  const count = asInt(totals.count);
  const timedCount = asInt(totals.timed_count);
  const jobs: AnalyticsOcrJob[] = [];
  for (const row of resultRows(jobsResult)) {
    const status = row.status === 'ready' || row.status === 'rows_only' ? row.status : null;
    if (!status || typeof row.id !== 'string') continue;
    const duration = row.duration_ms == null ? null : asInt(row.duration_ms);
    jobs.push({
      id: row.id,
      fileName: typeof row.file_name === 'string' ? row.file_name : 'document.pdf',
      status,
      pageCount: asInt(row.page_count),
      rowCount: asInt(row.row_count),
      createdAt: asIso(row.created_at) ?? new Date(0).toISOString(),
      workStartedAt: asIso(row.work_started_at),
      workFinishedAt: asIso(row.work_finished_at),
      durationMs: duration,
    });
  }
  return {
    count,
    timedCount,
    totalDurationMs: timedCount > 0 ? asInt(totals.total_duration_ms) : null,
    jobs,
  };
}

export async function selectOcrAnalysis(
  db: WorkspaceDb,
  workspaceId: string,
  id: string,
): Promise<OcrAnalysis | null> {
  await ensureOcrWorkColumns(db);
  const [row] = await db
    .select()
    .from(schema.ocrAnalyses)
    .where(eq(schema.ocrAnalyses.id, id))
    .limit(1);
  if (!row || row.workspaceId !== workspaceId) return null;
  return rowToAnalysis(row);
}
