import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enqueueUploads, getUploadSnapshot } from '../lib/upload-queue';

test('folder selections exceed the advisory batch while retaining quota bounds', () => {
  const quota = { maxFileBytes: 1024, maxFiles: 200, fileCount: 0, usedBytes: 0, limitBytes: 50, target: 'sorye' as const, maxBatchFiles: 10, maxConcurrentUploads: 2, throttleBytesPerSecond: null };
  const files = Array.from({ length: 40 }, (_, i) => {
    const file = new File(['xx'], `file-${i}.txt`);
    Object.defineProperty(file, 'webkitRelativePath', { value: `Folder/Nested/${file.name}` });
    return file;
  });
  const result = enqueueUploads(files, { workspaceId: 'queue-test', quota, folderPath: 'Parent' });
  assert.equal(result.queued, 25, 'queue beyond batch=10 until cumulative byte quota is full');
  assert.equal(result.skipped.length, 15);
  assert.ok(result.skipped.every((file) => file.reason.includes('Not enough space')));
  assert.equal(getUploadSnapshot().totals.bytes, 50);
});
