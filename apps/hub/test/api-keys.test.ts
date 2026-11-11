import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API_KEY_APPS, API_KEY_SCOPES, isApiKeyId, isApiKeyName, isApiKeyScope, isApiKeyScopeList } from '@sorye/types';
import { publicApiBaseUrl, readSmallJson } from '../lib/api-keys';

test('scopes are read and write for each exposed app, nothing else', () => {
  assert.deepEqual([...API_KEY_SCOPES].sort(), ['calendar:read', 'calendar:write', 'forms:read', 'forms:write', 'notes:read', 'notes:write', 'tasks:read', 'tasks:write']);
  assert.equal(API_KEY_SCOPES.length, API_KEY_APPS.length * 2);
  for (const bad of ['tasks', 'tasks:admin', 'messenger:read', 'storefront:write', '*:read', 'tasks:read ', 'TASKS:READ', '', null, 1]) {
    assert.equal(isApiKeyScope(bad), false, String(bad));
  }
  assert.equal(isApiKeyScopeList(['tasks:read', 'forms:write']), true);
  assert.equal(isApiKeyScopeList([]), false);
  assert.equal(isApiKeyScopeList(['tasks:read', 'tasks:read']), false);
  assert.equal(isApiKeyScopeList(['tasks:read', 'mail:read']), false);
  assert.equal(isApiKeyScopeList('tasks:read'), false);
});

test('key names and ids follow the Rodrigo rules', () => {
  assert.equal(isApiKeyName('Nightly export'), true);
  assert.equal(isApiKeyName('é'.repeat(40)), true, '80 bytes');
  for (const bad of ['', ' ', ' padded', 'padded ', 'line\nbreak', 'tab\there', 'x'.repeat(81), 'é'.repeat(41), 7, null]) {
    assert.equal(isApiKeyName(bad), false, JSON.stringify(bad));
  }
  assert.equal(isApiKeyId('0123456789abcdef'), true);
  for (const bad of ['0123456789ABCDEF', '0123456789abcde', '0123456789abcdef0', '../0123456789ab', '', 16]) {
    assert.equal(isApiKeyId(bad), false, String(bad));
  }
});

test('the published API address must be https, or loopback http, with no secrets or query', () => {
  const url = (value?: string) => publicApiBaseUrl({ RODRIGO_PUBLIC_API_URL: value });
  assert.equal(url('https://api.sorye.app'), 'https://api.sorye.app');
  assert.equal(url(' https://api.sorye.app/ '), 'https://api.sorye.app');
  assert.equal(url('https://sorye.app/rodrigo/'), 'https://sorye.app/rodrigo');
  assert.equal(url('http://127.0.0.1:8088'), 'http://127.0.0.1:8088');
  for (const bad of [undefined, '', 'http://api.sorye.app', 'https://user:pass@api.sorye.app', 'https://api.sorye.app?x=1', 'https://api.sorye.app#x', 'not a url', 'ftp://api.sorye.app']) {
    assert.equal(url(bad), null, String(bad));
  }
});

test('create bodies are small JSON objects', async () => {
  const body = (text: string) => readSmallJson(new Request('http://hub.test/api/backend/api-keys', { method: 'POST', body: text }));
  assert.deepEqual(await body('{"name":"CI","scopes":["tasks:read"]}'), { name: 'CI', scopes: ['tasks:read'] });
  assert.equal(await body('[]'), null);
  assert.equal(await body('null'), null);
  assert.equal(await body('nope'), null);
  assert.equal(await body(JSON.stringify({ name: 'x'.repeat(5000) })), null);
});

test('Rodrigo client validates key requests before signing', async () => {
  const { createRodrigoApiKey, revokeRodrigoApiKey } = await import('../lib/rodrigo/service-client');
  const context = { userId: 'u1', workspaceId: 'w1' };
  assert.throws(() => createRodrigoApiKey(context, { name: '', scopes: ['tasks:read'] }), /Invalid API key request/);
  assert.throws(() => createRodrigoApiKey(context, { name: 'CI', scopes: [] }), /Invalid API key request/);
  assert.throws(() => createRodrigoApiKey(context, { name: 'CI', scopes: ['messenger:read'] }), /Invalid API key request/);
  await assert.rejects(revokeRodrigoApiKey(context, '../v2/platform'), /Invalid API key id/);
  // With no Rodrigo configured a valid request fails closed rather than pretending to succeed.
  for (const key of ['RODRIGO_BASE_URL', 'RODRIGO_KEY_ID', 'RODRIGO_PRIVATE_KEY_FILE']) delete process.env[key];
  await assert.rejects(createRodrigoApiKey(context, { name: 'CI', scopes: ['tasks:read'] }), /unavailable/);
});

test('API key text exists in every language with matching placeholders', async () => {
  const { apikeys } = await import('../../../packages/platform/src/messages/apikeys');
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');
  const english = apikeys.en as Record<string, string>;
  const keys = Object.keys(english).sort();
  assert.ok(keys.length >= 30);
  for (const locale of ['de', 'sk', 'hu', 'es'] as const) {
    const translated = apikeys[locale] as Record<string, string>;
    assert.deepEqual(Object.keys(translated).sort(), keys, locale);
    for (const key of keys) assert.equal(placeholders(translated[key]!), placeholders(english[key]!), `${locale} ${key}`);
  }
});
