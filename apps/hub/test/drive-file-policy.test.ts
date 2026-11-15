import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveWorkspaceFileMime } from '../lib/files-policy';

test('general storage accepts ordinary binary, archives, media and data as downloads', () => {
  for (const name of ['backup.zip', 'recording.mp4', 'song.mp3', 'data.parquet', 'design.bin', 'config.yaml']) {
    assert.equal(resolveWorkspaceFileMime(Buffer.from([0, 1, 2, 3, 4]), name), 'application/octet-stream');
  }
});
test('executable extensions and renamed executable signatures are rejected', () => {
  for (const name of ['tool.EXE', 'tool.exe.', 'tool.exe ', 'run.ps1', 'setup.msi', 'link.lnk']) {
    assert.throws(() => resolveWorkspaceFileMime(Buffer.from('ordinary text'), name));
  }
  for (const bytes of [Buffer.from('MZ'), Buffer.from([127, 69, 76, 70]), Buffer.from('#!/bin/sh\necho hi'), Buffer.from([0xce, 0xfa, 0xed, 0xfe])]) {
    assert.throws(() => resolveWorkspaceFileMime(bytes, 'safe.txt'));
  }
});
