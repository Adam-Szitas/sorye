import { readFile, stat, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { parseArgs } from 'node:util';
import { closeDb } from '@sorye/db';
import { getWorkspaceDoc } from '../store/workspace-docs';
import { getDocumentOwner } from '../rodrigo/document-ownership';
import { importDocument, validateMigrationExport } from '../rodrigo/document-migration';
import { getRodrigoSnapshot, putRodrigoDocument } from '../rodrigo/service-client';

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    user: { type: 'string' }, workspace: { type: 'string' }, kind: { type: 'string' },
    file: { type: 'string' }, receipt: { type: 'string' }, apply: { type: 'boolean', default: false },
    'writers-stopped': { type: 'boolean', default: false },
  } });
  const [command] = positionals;
  if (positionals.length !== 1 || !['export', 'import'].includes(command) || !values.file) {
    throw new Error('Use export --user ID --workspace ID --kind tasks|calendar --file FILE, or import --file FILE [--apply --writers-stopped --receipt FILE].');
  }
  let source;
  if (command === 'export') {
    source = validateMigrationExport({ format: 'sorye-rodrigo-document-v1', userId: values.user,
      workspaceId: values.workspace, kind: values.kind, document: null });
  } else {
    if ((await stat(values.file)).size > 1048576) throw new Error('Export file exceeds the safety limit.');
    source = validateMigrationExport(JSON.parse(await readFile(values.file, 'utf8')));
  }
  if (getDocumentOwner(source.workspaceId, source.kind).owner !== 'frozen') {
    throw new Error('Configure this workspace/kind as frozen on every Hub replica and drain in-flight writes first.');
  }
  const current = await getWorkspaceDoc(source.userId, source.workspaceId, source.kind);
  if (current.access === 'denied') throw new Error('The export user must be a workspace member with this app enabled.');
  const currentDocument = current.doc ? { revision: current.doc.revision, payload: current.doc.payload } : null;
  if (command === 'export') {
    source = validateMigrationExport({ ...source, document: currentDocument });
    await writeFile(values.file, JSON.stringify(source), { flag: 'wx', mode: 0o600 });
    console.info('Export created. Contains workspace data; keep it with the migration backup.');
    return;
  }
  if (!isDeepStrictEqual(currentDocument, source.document)) throw new Error('Source differs from the export. Keep writes frozen and export again.');
  if (values.apply && (!values['writers-stopped'] || !values.receipt)) {
    throw new Error('--apply requires --writers-stopped and a new --receipt path.');
  }
  const result = await importDocument(source, { snapshot: getRodrigoSnapshot, write: putRodrigoDocument }, values.apply);
  if (result.verified) {
    const finalSource = await getWorkspaceDoc(source.userId, source.workspaceId, source.kind);
    const finalDocument = finalSource.access === 'ok' && finalSource.doc
      ? { revision: finalSource.doc.revision, payload: finalSource.doc.payload } : null;
    if (finalSource.access === 'denied' || !isDeepStrictEqual(finalDocument, source.document)) {
      throw new Error('Source changed during import. Keep writes frozen; no cutover receipt was issued.');
    }
    await writeFile(values.receipt!, JSON.stringify({ ...result, backendOrigin: process.env.RODRIGO_BASE_URL }, null, 2), { flag: 'wx', mode: 0o600 });
    console.info('Import verified. Receipt contains the owner entry for deployment. No ownership setting was changed.');
  } else console.info('Dry run passed. No target write or ownership change was made.');
}

main().catch((error: unknown) => {
  // Do not print source records, schema errors with values, or provider credentials.
  console.error(error instanceof Error && error.name !== 'ZodError' ? error.message : 'Invalid migration input.');
  process.exitCode = 1;
}).finally(async () => { await closeDb(); });
