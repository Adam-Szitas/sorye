import { NextResponse } from 'next/server';
import { WorkspaceDocConflict } from './store/workspace-doc-conflict';
import { WorkspaceDatabaseUnavailableError } from './workspace-db';
import { DocumentOwnershipError } from './rodrigo/document-ownership';
import { DocumentWritesFrozenError } from './rodrigo/document-router';
import { RodrigoResponseError, RodrigoUnavailableError } from './rodrigo/client';

export function documentRouteError(error: unknown) {
  const headers = { 'Cache-Control': 'no-store' };
  if (error instanceof WorkspaceDocConflict) {
    return NextResponse.json({ error: error.message }, { status: 409, headers });
  }
  if (error instanceof DocumentWritesFrozenError) {
    return NextResponse.json({ error: error.message, code: 'DOCUMENT_WRITES_FROZEN' }, { status: 503, headers });
  }
  if (error instanceof RodrigoResponseError || error instanceof RodrigoUnavailableError || error instanceof DocumentOwnershipError) {
    return NextResponse.json({ error: 'Document storage is unavailable. Your draft has been kept.', code: 'DOCUMENT_STORAGE_UNAVAILABLE',
      ...(error instanceof RodrigoResponseError ? { backendCode: error.code, requestId: error.requestId } : {}),
    }, { status: 503, headers });
  }
  if (error instanceof WorkspaceDatabaseUnavailableError) {
    return NextResponse.json({ error: error.message }, { status: 503, headers });
  }
  throw error;
}
