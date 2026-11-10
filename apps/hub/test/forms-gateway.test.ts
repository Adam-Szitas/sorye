import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compactFormAnswers,
  findFormAnswerIssue,
  formSlugFromTitle,
  isFormDefinition,
  isFormSlug,
  isFormSubmission,
  type FormDefinition,
} from '@sorye/types';
import { createPublicRateLimiter, publicClientKey } from '../lib/forms/public-rate-limit';
import { parsePublicSubmission, readBoundedText } from '../lib/forms/public-submission';
import { actionBatchSchema } from '../lib/rodrigo/action-validation';

const form = (): FormDefinition => ({
  id: 'form-1', slug: 'contact-us', title: 'Contact', description: '', published: true, accepting: true, version: 1,
  fields: [
    { id: 'name', kind: 'text', label: 'Name', required: true },
    { id: 'email', kind: 'email', label: 'Email', required: true },
    { id: 'topic', kind: 'select', label: 'Topic', required: false, options: ['Sales', 'Support'] },
    { id: 'tags', kind: 'multiselect', label: 'Tags', required: false, options: ['a', 'b'] },
    { id: 'agree', kind: 'consent', label: 'I agree', required: true },
  ],
  successMessage: 'Thanks', updatedAt: '2026-11-09T12:00:00Z',
});

const action = (overrides: Record<string, unknown> = {}) => ({
  actionId: 'e1055eb9-cdd7-4942-9a91-5ad3e609ca92', appId: 'forms', resourceType: 'form', operation: 'create',
  resourceId: 'form-1', payloadVersion: 1, payload: form(), occurredAt: '2026-11-09T12:00:00.000Z', ...overrides,
});
const accepts = (value: Record<string, unknown>) => actionBatchSchema.safeParse({ actions: [value] }).success;

test('form definitions follow the Rodrigo contract', () => {
  assert.equal(isFormDefinition(form(), 'form-1'), true);
  assert.equal(isFormDefinition(form(), 'other'), false);
  assert.equal(isFormDefinition({ ...form(), slug: 'Contact Us' }), false);
  assert.equal(isFormDefinition({ ...form(), fields: [] }), false);
  assert.equal(isFormDefinition({ ...form(), owner: 'browser' }), false);
  const duplicate = form();
  duplicate.fields[1]!.id = 'name';
  assert.equal(isFormDefinition(duplicate), false);
  const noOptions = form();
  delete noOptions.fields[2]!.options;
  assert.equal(isFormDefinition(noOptions), false);
  const strayOptions = form();
  strayOptions.fields[0]!.options = ['x'];
  assert.equal(isFormDefinition(strayOptions), false);
  assert.equal(isFormDefinition({ ...form(), fields: [{ id: 'a', kind: 'html', label: 'A', required: false }] }), false);
});

test('slugs are public path segments', () => {
  assert.equal(isFormSlug('contact-us'), true);
  for (const bad of ['', 'Contact', 'a--b', '-a', 'a-', 'a b', 'a'.repeat(65)]) assert.equal(isFormSlug(bad), false, bad);
  assert.equal(formSlugFromTitle('  Žiadosť o ponuku! '), 'ziadost-o-ponuku');
  assert.equal(formSlugFromTitle('!!!'), '');
  assert.equal(isFormSlug(formSlugFromTitle('x'.repeat(200))), true);
});

test('answers are checked in field order with the same codes as Rodrigo', () => {
  const { fields } = form();
  const good = { name: 'Ada', email: 'ada@example.com', topic: 'Sales', tags: ['a', 'b'], agree: true };
  assert.equal(findFormAnswerIssue(fields, good), null);
  assert.equal(findFormAnswerIssue(fields, { name: 'Ada', email: 'ada@example.com', agree: true }), null);
  const cases: Array<[Record<string, unknown>, string, string]> = [
    [{ email: 'ada@example.com', agree: true }, 'required_missing', 'name'],
    [{ name: '  ', email: 'ada@example.com', agree: true }, 'required_missing', 'name'],
    [{ name: 'Ada', email: 'ada@example.com', agree: false }, 'required_missing', 'agree'],
    [{ name: 'Ada', email: 'nope', agree: true }, 'invalid_answer', 'email'],
    [{ name: 'Ada', email: 'ada@example.com', agree: true, topic: 'Other' }, 'invalid_answer', 'topic'],
    [{ name: 'Ada', email: 'ada@example.com', agree: true, tags: ['a', 'a'] }, 'invalid_answer', 'tags'],
    [{ name: 7, email: 'ada@example.com', agree: true }, 'invalid_answer', 'name'],
    [{ name: 'x'.repeat(501), email: 'ada@example.com', agree: true }, 'invalid_answer', 'name'],
    [{ name: 'Ada', email: 'ada@example.com', agree: true, extra: 'x' }, 'unknown_field', 'extra'],
  ];
  for (const [answers, problem, fieldId] of cases) {
    assert.deepEqual(findFormAnswerIssue(fields, answers as never), { problem, fieldId });
  }
  assert.deepEqual(compactFormAnswers(fields, { name: ' Ada ', email: 'ada@example.com', topic: '', tags: [], agree: true }), {
    name: 'Ada', email: 'ada@example.com', agree: true,
  });
});

test('Hub action validator admits form writes and refuses member-created submissions', () => {
  assert.equal(accepts(action()), true);
  assert.equal(accepts(action({ operation: 'update', expectedRevision: 1 })), true);
  assert.equal(accepts(action({ operation: 'delete', expectedRevision: 1, payload: {} })), true);
  assert.equal(accepts(action({ resourceId: 'other' })), false);
  assert.equal(accepts(action({ payload: { ...form(), updatedAt: 'yesterday' } })), false);

  const submission = {
    id: 'sub-1', formId: 'form-1', formVersion: 1, answers: { name: 'Ada', agree: true },
    submittedAt: '2026-11-09T12:00:00Z', status: 'handled', source: 'public',
  };
  const submissionAction = (overrides: Record<string, unknown> = {}) =>
    action({ resourceType: 'submission', resourceId: 'sub-1', operation: 'update', expectedRevision: 1, payload: submission, ...overrides });
  assert.equal(isFormSubmission(submission, 'sub-1'), true);
  assert.equal(accepts(submissionAction()), true);
  assert.equal(accepts(submissionAction({ operation: 'delete', payload: {} })), true);
  assert.equal(accepts(submissionAction({ operation: 'create', expectedRevision: undefined })), false);
  assert.equal(accepts(submissionAction({ payload: { ...submission, status: 'archived' } })), false);
  assert.equal(accepts(submissionAction({ payload: { ...submission, answers: { name: { html: '<b>' } } } })), false);
  assert.equal(accepts(submissionAction({ payload: { ...submission, source: 'member' } })), false);
});

test('public submission bodies are exact, bounded and trap-aware', async () => {
  const id = '4f0c1f0e-6f0a-4a57-9a55-0d3a6c0e9b11';
  assert.deepEqual(parsePublicSubmission(JSON.stringify({ submissionId: id.toUpperCase(), answers: { name: 'Ada' } })), {
    submissionId: id, answers: { name: 'Ada' }, trap: false,
  });
  assert.equal(parsePublicSubmission(JSON.stringify({ submissionId: id, answers: {}, website: 'http://spam' }))?.trap, true);
  assert.equal(parsePublicSubmission(JSON.stringify({ submissionId: id, answers: {}, website: '' }))?.trap, false);
  for (const bad of [
    'not json', '[]', 'null',
    JSON.stringify({ submissionId: 'nope', answers: {} }),
    JSON.stringify({ submissionId: id }),
    JSON.stringify({ submissionId: id, answers: [] }),
    JSON.stringify({ submissionId: id, answers: {}, workspaceId: 'w1' }),
    JSON.stringify({ submissionId: id, answers: {}, website: 1 }),
  ]) assert.equal(parsePublicSubmission(bad), null, bad);

  const request = (body: string) => new Request('http://hub.test/api/forms/public/x/submissions', { method: 'POST', body });
  assert.equal(await readBoundedText(request('{"a":1}'), 16), '{"a":1}');
  await assert.rejects(readBoundedText(request('x'.repeat(17)), 16), /too_large/);
});

test('public limiter counts per key, resets after the window and stays bounded', () => {
  const limiter = createPublicRateLimiter(3);
  assert.equal(limiter.hit('a', 2, 1000, 0), 0);
  assert.equal(limiter.hit('a', 2, 1000, 10), 0);
  assert.equal(limiter.hit('a', 2, 1000, 20), 1);
  assert.equal(limiter.hit('b', 2, 1000, 20), 0, 'another key is unaffected');
  assert.equal(limiter.hit('a', 2, 1000, 1001), 0, 'window reset');
  for (const key of ['c', 'd', 'e', 'f']) limiter.hit(key, 2, 1000, 1002);
  assert.ok(limiter.size() <= 3);

  assert.equal(publicClientKey(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })), '203.0.113.7');
  assert.equal(publicClientKey(new Headers({ 'x-forwarded-for': '2001:DB8::1' })), '2001:db8::1');
  assert.equal(publicClientKey(new Headers({ 'x-forwarded-for': '<script>' })), 'unknown');
  assert.equal(publicClientKey(new Headers()), 'unknown');
});
