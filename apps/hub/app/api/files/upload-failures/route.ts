import { ensureHubUser } from '@/lib/ensure-user';
import { sanitizeDisplayName } from '@/lib/files';
import { allowClientFailureReport, noteUploadFailed, parseQueueId } from '@/lib/upload-notices';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * The browser reports an upload that never reached the upload route (network
 * drop, aborted request), so the member still gets a Hub notice with a retry.
 * The notice is addressed only to the reporting member, the text is fixed by
 * the server from a short list of reasons, and reports are rate limited.
 */
const REASONS = {
  network: 'The connection dropped during the upload. Retry when you are back online.',
  aborted: 'The upload was stopped before it finished. Retry to upload it.',
  workspace_changed: 'You switched workspace before this file was uploaded. Switch back and retry.',
} as const;

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const uploadId = parseQueueId(body.uploadId);
  const batchId = parseQueueId(body.batchId);
  const reason = typeof body.reason === 'string' && body.reason in REASONS ? (body.reason as keyof typeof REASONS) : null;
  if (!uploadId || !reason || typeof body.fileName !== 'string') {
    return NextResponse.json({ error: 'uploadId, fileName and a known reason are required' }, { status: 400 });
  }
  if (!allowClientFailureReport(session.user.id)) {
    return NextResponse.json({ error: 'Too many reports' }, { status: 429, headers: { 'Retry-After': '60' } });
  }
  await noteUploadFailed({
    workspaceId: session.workspace.id, userId: session.user.id, uploadId, batchId,
    fileName: sanitizeDisplayName(body.fileName.slice(0, 400)), reason: REASONS[reason], corrupted: false,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
