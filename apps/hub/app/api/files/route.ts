import { boundedBodyStream, withUploadSlot, UploadLimitError } from '@/lib/bounded-upload';
import { MultipartError, parseMultipartUpload } from '@/lib/multipart-stream';
import { ensureHubUser } from '@/lib/ensure-user';
import { publishWorkspaceEvent } from '@/lib/events';
import {
  createWorkspaceFileFromStream,
  FileAccessError,
  getFileQuota,
  listWorkspaceFiles,
  parseClientSha256,
  sanitizeDisplayName,
} from '@/lib/files';
import { noteUploadFailed, noteUploadStored, parseQueueId } from '@/lib/upload-notices';
import {
  effectiveBytesPerSecond,
  quotaLimits,
  readUploadThrottleConfig,
  uploadBuckets,
  uploadTimeoutMs,
  UserUploadBusyError,
  withUserUploadSlot,
  type UploadThrottleConfig,
} from '@/lib/upload-throttle';
import {
  FILE_MAX_BYTES,
  FILE_MAX_PER_WORKSPACE,
  TASK_PHOTO_MAX_BYTES,
  isCorruptUploadCode,
  type FileUploadErrorBody,
  type FileUploadErrorCode,
} from '@sorye/types';
import { readPartitionedLoad, sessionWorkspace } from '@/lib/user-load-read';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type Session = NonNullable<Awaited<ReturnType<typeof ensureHubUser>>>;

function errorResponse(err: unknown) {
  if (err instanceof FileAccessError) {
    const body: FileUploadErrorBody = { error: err.message, ...(err.code ? { code: err.code, corrupted: isCorruptUploadCode(err.code) } : {}) };
    return NextResponse.json(body, { status: err.status });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'Could not process files' },
    { status: 400 },
  );
}

function uploadError(status: number, error: string, code: FileUploadErrorCode, headers?: HeadersInit) {
  const body: FileUploadErrorBody = { error, code, corrupted: isCorruptUploadCode(code) };
  return NextResponse.json(body, { status, headers });
}

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const actor = { userId: session.user.id, workspaceId: session.workspace.id };
    const files = await listWorkspaceFiles(actor);
    const [load, quota] = await Promise.all([
      readPartitionedLoad(session, async (scope) => {
        const rows = await listWorkspaceFiles({ userId: session.user.id, workspaceId: scope.id });
        return rows.map((file) => ({ workspaceId: scope.id, value: file }));
      }, {
        itemAppId: (file) => (file.sourceAppId === 'studio' ? 'studio' : 'files'),
        personalApps: ['files', 'studio'],
      }),
      getFileQuota(actor, quotaLimits(readUploadThrottleConfig())),
    ]);
    return NextResponse.json({
      files,
      maxBytes: FILE_MAX_BYTES,
      maxFiles: FILE_MAX_PER_WORKSPACE,
      quota,
      load,
      workspace: sessionWorkspace(session),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = readUploadThrottleConfig();
  try {
    return await withUserUploadSlot(session.user.id, () => withUploadSlot(() => uploadFile(req, session, config)), config);
  } catch (err) {
    if (err instanceof UserUploadBusyError) return uploadError(429, err.message, 'busy', { 'Retry-After': '2' });
    if (err instanceof UploadLimitError) {
      if (err.status === 429) return uploadError(429, err.message, 'busy', { 'Retry-After': '3' });
      if (err.status === 413) return uploadError(413, `File is too large (max ${Math.floor(FILE_MAX_BYTES / (1024 * 1024))} MB)`, 'too_large');
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

async function uploadFile(req: Request, session: Session, config: UploadThrottleConfig) {
  const scope = { userId: session.user.id, workspaceId: session.workspace.id };
  const declared = Number(req.headers.get('content-length')) || FILE_MAX_BYTES;
  // Streamed: the multipart body is parsed as it arrives and the file part flows through
  // to Rodrigo in 8 MiB parts. Hub never holds the whole file.
  let upload;
  try {
    const body = boundedBodyStream(req, FILE_MAX_BYTES + 1_000_000, {
      buckets: uploadBuckets(scope, config),
      timeoutMs: uploadTimeoutMs(declared, effectiveBytesPerSecond(config)),
    });
    upload = await parseMultipartUpload(body, req.headers.get('content-type'));
  } catch (err) {
    if (err instanceof UploadLimitError) throw err;
    if (err instanceof MultipartError && err.reason === 'no_file') return NextResponse.json({ error: 'file is required' }, { status: 400 });
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  }
  const form = { get: (name: string) => upload.fields.get(name) ?? null };

  const sourceAppId = typeof form.get('sourceAppId') === 'string' ? String(form.get('sourceAppId')) : 'files';
  if (sourceAppId === 'tasks' && (!session.workspace.memberIds.includes(session.user.id) || !session.workspace.selectedAppIds.includes('tasks'))) {
    await upload.cancel();
    return NextResponse.json({ error: 'Tasks is not enabled for this workspace' }, { status: 403 });
  }

  // Queue fields from the Hub upload manager. All optional, so other callers keep working.
  const uploadId = parseQueueId(form.get('uploadId'));
  const batchId = parseQueueId(form.get('batchId'));
  const expectedWorkspaceId = form.get('expectedWorkspaceId');
  const expectedSha256 = parseClientSha256(form.get('sha256'));
  if (expectedSha256 === null) {
    await upload.cancel();
    return NextResponse.json({ error: 'sha256 must be 64 hexadecimal characters' }, { status: 400 });
  }
  // A guard only: the workspace always comes from the session. It stops a queued
  // file from landing in a workspace the member switched to after queueing it.
  if (typeof expectedWorkspaceId === 'string' && expectedWorkspaceId && expectedWorkspaceId !== session.workspace.id) {
    await upload.cancel();
    return uploadError(409, 'The active workspace changed after this file was queued. Switch back and retry.', 'workspace_changed');
  }
  if (upload.fileField !== 'file') {
    await upload.cancel();
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  const displayName = sanitizeDisplayName(upload.fileName);

  const fail = async (response: NextResponse, reason: string, code?: FileUploadErrorCode) => {
    if (uploadId) {
      await noteUploadFailed({
        workspaceId: session.workspace.id, userId: session.user.id, uploadId, batchId, fileName: displayName,
        reason, corrupted: isCorruptUploadCode(code),
      }).catch(() => undefined);
    }
    return response;
  };

  // Upper bound for the session; the exact size is known once the stream ends.
  const maxBytes = sourceAppId === 'tasks' ? TASK_PHOTO_MAX_BYTES : FILE_MAX_BYTES;
  let file;
  try {
    file = await createWorkspaceFileFromStream({
      workspaceId: session.workspace.id,
      displayName: upload.fileName,
      folderPath: new URL(req.url).searchParams.get('folderPath') ?? '',
      sourceAppId,
      source: upload.file,
      maxBytes: Math.min(maxBytes, declared),
      expectedSha256,
      // The browser digest may follow the file in the form.
      finalSha256: async () => parseClientSha256((await upload.fieldsAfterFile()).get('sha256')) ?? undefined,
      uploader: { userId: session.user.id },
    });
  } catch (err) {
    await upload.cancel();
    if (err instanceof UploadLimitError) throw err;
    const code = err instanceof FileAccessError ? err.code ?? (err.status >= 500 ? 'storage_unavailable' : 'rejected') : 'storage_unavailable';
    const reason = err instanceof FileAccessError ? err.message : 'Could not process files';
    return fail(errorResponse(err), reason, code);
  }

  await publishWorkspaceEvent({
    userId: session.user.id,
    workspaceId: session.workspace.id,
    name: 'sorye.files.uploaded',
    payload: {
      title: 'File uploaded',
      summary: `${session.user.displayName} uploaded ${file.displayName}`,
      appId: 'files',
      entityId: file.id,
      meta: {
        mime: file.mime,
        size: file.size,
      },
    },
  });
  if (batchId) {
    await noteUploadStored({
      workspaceId: session.workspace.id, userId: session.user.id, batchId, fileName: file.displayName, size: file.size,
    }).catch(() => undefined);
  }

  return NextResponse.json({ file, verified: Boolean(expectedSha256) }, { status: 201 });
}
