import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadHubEnv, parseEnv } from '../lib/workers/load-hub-env';

test('parseEnv reads export and quoted values', () => {
  const parsed = parseEnv('A=1\r\nexport B="two words"\r\n# comment\r\nC=\'x\'\r\n');
  assert.equal(parsed.A, '1');
  assert.equal(parsed.B, 'two words');
  assert.equal(parsed.C, 'x');
  assert.equal(parsed['# comment'], undefined);
});

test('loadHubEnv applies .env.local over .env and keeps existing process values', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sorye-env-'));
  const previousKeep = process.env.SORYE_ENV_TEST_KEEP;
  const previousFile = process.env.SORYE_ENV_TEST_FILE;
  try {
    process.env.SORYE_ENV_TEST_KEEP = 'from-process';
    delete process.env.SORYE_ENV_TEST_FILE;
    writeFileSync(path.join(dir, '.env'), 'SORYE_ENV_TEST_FILE=base\nSORYE_ENV_TEST_KEEP=file\n');
    writeFileSync(path.join(dir, '.env.local'), 'SORYE_ENV_TEST_FILE=local\n');
    loadHubEnv(dir, 'development');
    assert.equal(process.env.SORYE_ENV_TEST_FILE, 'local');
    assert.equal(process.env.SORYE_ENV_TEST_KEEP, 'from-process');
  } finally {
    if (previousKeep === undefined) delete process.env.SORYE_ENV_TEST_KEEP;
    else process.env.SORYE_ENV_TEST_KEEP = previousKeep;
    if (previousFile === undefined) delete process.env.SORYE_ENV_TEST_FILE;
    else process.env.SORYE_ENV_TEST_FILE = previousFile;
    rmSync(dir, { recursive: true, force: true });
  }
});
