import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceFile } from '@sorye/types';
import { migrateFileBlobStream } from '../file-blobs';

const dataRoot = path.resolve(process.cwd(), '.data');
const sourceRoot = path.join(dataRoot, 'files');
const apply = process.argv.includes('--apply');

function isFileRow(value: unknown): value is WorkspaceFile {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<WorkspaceFile>;
  return typeof row.id === 'string' && /^[0-9a-f-]{36}$/i.test(row.id) &&
    typeof row.workspaceId === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(row.workspaceId) &&
    typeof row.mime === 'string' && Number.isSafeInteger(row.size) && Number(row.size) >= 0;
}

async function main() {
  const metadataPath = path.join(dataRoot, 'files-meta.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, unknown>;
  const rows = Object.values(metadata).flatMap((value) => Array.isArray(value) ? value : [])
    .filter(isFileRow);
  let bytes = 0;
  for (const row of rows) {
    const source = path.resolve(sourceRoot, row.workspaceId, row.id);
    if (!source.startsWith(`${sourceRoot}${path.sep}`)) throw new Error('Unsafe source path in Drive metadata');
    const info = await stat(source);
    if (!info.isFile() || info.size !== row.size) throw new Error(`Source size mismatch for ${row.id}`);
    bytes += info.size;
    if (apply) await migrateFileBlobStream({ workspaceId: row.workspaceId, id: row.id, sourcePath: source, size: row.size, mime: row.mime });
  }
  console.info(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', objects: rows.length, bytes, target: 'S3 files/{workspaceId}/{id}' }));
  if (!apply) console.info('No objects were written. Set FILE_STORE_DRIVER=s3 and FILE_S3_BUCKET, verify a backup, then rerun with --apply.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Drive blob migration failed');
  process.exitCode = 1;
});
