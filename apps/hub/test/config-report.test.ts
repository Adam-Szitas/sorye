import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configFindings } from '../lib/config-report';

const base = {
  NODE_ENV: 'production', STORE_DRIVER: 'postgres', DATABASE_URL: 'postgresql://x', AUTH_SECRET: 'a'.repeat(32), ADMIN_SECRET: 'b'.repeat(32),
} as NodeJS.ProcessEnv;

test('names the settings the current server is missing, never their values', () => {
  const findings = configFindings(base);
  const names = findings.map((f) => f.setting);
  for (const expected of ['AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET', 'AUTH_TRUST_HOST', 'SORYE_PUBLIC_HOST', 'FILE_STORE_DRIVER', 'STORAGE_SECRET_KEY']) {
    assert.ok(names.includes(expected), expected);
  }
  assert.ok(names.some((name) => name.includes('RODRIGO_BASE_URL')));
  assert.ok(!JSON.stringify(findings).includes('postgresql://x'), 'values are never reported');
  assert.equal(findings.find((f) => f.setting === 'AUTH_GOOGLE_ID')?.level, 'error');
  assert.equal(findings.find((f) => f.setting.includes('RODRIGO'))?.level, 'warn', 'Rodrigo can come later');
});

test('a complete single-server production configuration has no errors', () => {
  const findings = configFindings({
    ...base, AUTH_GOOGLE_ID: 'id', AUTH_GOOGLE_SECRET: 'secret', AUTH_TRUST_HOST: 'true', SORYE_PUBLIC_HOST: 'sorye.app',
    ADMIN_EMAILS: 'a@b.c', FILE_STORE_DRIVER: 's3', FILE_S3_BUCKET: 'files', STORAGE_SECRET_KEY: 'k'.repeat(32),
    RODRIGO_BASE_URL: 'https://r', RODRIGO_KEY_ID: 'hub-1', RODRIGO_PRIVATE_KEY_FILE: '/run/secrets/k',
  });
  assert.deepEqual(findings, []);
});

test('development-only switches are flagged in production', () => {
  const findings = configFindings({ ...base, AUTH_DEV_BYPASS: 'true', AUTH_URL: 'https://x', NEXTAUTH_URL: 'https://x', AUTH_TRUST_HOST: 'false' });
  assert.ok(findings.some((f) => f.setting === 'AUTH_DEV_BYPASS' && f.level === 'error'));
  assert.ok(findings.some((f) => f.setting === 'AUTH_URL' && f.level === 'error'));
  assert.ok(findings.some((f) => f.setting === 'NEXTAUTH_URL' && f.level === 'error'));
  assert.ok(findings.some((f) => f.setting === 'AUTH_TRUST_HOST' && f.level === 'error'));
});
