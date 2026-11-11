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

test('editor helpers produce payloads Rodrigo accepts', async () => {
  const { formForSave, formIsSavable, newField, newFormDraft, optionsFromText, submissionsCsv, withFieldKind } = await import('../lib/forms/forms-client');
  assert.deepEqual(optionsFromText(' A \n\nB\r\nA\n'), ['A', 'B']);

  const draft = newFormDraft('  Contact  ');
  assert.equal(formIsSavable(formForSave(draft, null)), false, 'no slug and no fields yet');
  draft.slug = 'contact';
  const name = { ...newField('text'), label: ' Name ', help: '  ' };
  const topic = { ...newField('select'), label: 'Topic', options: ['Sales', 'Sales', ' Support '] };
  draft.fields = [name, topic];
  const first = formForSave(draft, null, new Date('2026-11-09T12:00:00Z'));
  assert.equal(formIsSavable(first), true);
  assert.equal(first.title, 'Contact');
  assert.equal(first.version, 1);
  assert.deepEqual(first.fields[0], { id: name.id, kind: 'text', label: 'Name', required: false });
  assert.deepEqual(first.fields[1]?.options, ['Sales', 'Support']);
  assert.equal(JSON.stringify(first).includes('undefined'), false);

  // Only a field change raises the version a submission is recorded against.
  assert.equal(formForSave({ ...first, title: 'Contact us' }, first).version, 1);
  assert.equal(formForSave({ ...first, fields: [first.fields[0]!] }, first).version, 2);

  const asText = withFieldKind(first.fields[1]!, 'text');
  assert.equal('options' in asText, false);
  assert.deepEqual(withFieldKind(asText, 'multiselect').options, []);
  assert.equal(newField('consent').required, true);
  assert.match(newField('text').id, /^f_[0-9a-f]{12}$/);

  const csv = submissionsCsv(first, [{
    revision: 1,
    submission: {
      id: 's1', formId: first.id, formVersion: 1, submittedAt: '2026-11-09T12:00:00Z', status: 'new', source: 'public',
      answers: { [name.id]: '=HYPERLINK("http://x")', [topic.id]: 'Sales' },
    },
  }], { received: 'Received', status: 'Status', yes: 'Yes' });
  const [header, row] = csv.split('\r\n');
  assert.equal(header, 'Received,Status,Name,Topic');
  assert.equal(row, `2026-11-09T12:00:00Z,new,"'=HYPERLINK(""http://x"")",Sales`);
});

test('text limits are counted in UTF-8 bytes, as Rodrigo counts them', () => {
  const withLabel = (label: string) => ({ ...form(), fields: [{ id: 'a', kind: 'text', label, required: false }] });
  assert.equal(isFormDefinition(withLabel('x'.repeat(200))), true);
  assert.equal(isFormDefinition(withLabel('x'.repeat(201))), false);
  assert.equal(isFormDefinition(withLabel('é'.repeat(100))), true, '100 two-byte characters are 200 bytes');
  assert.equal(isFormDefinition(withLabel('é'.repeat(101))), false);
  assert.equal(isFormDefinition(withLabel('😀'.repeat(50))), true, '50 four-byte characters are 200 bytes');
  assert.equal(isFormDefinition(withLabel('😀'.repeat(51))), false);
  const fields = [{ id: 'a', kind: 'text' as const, label: 'A', required: false }];
  assert.equal(findFormAnswerIssue(fields, { a: 'é'.repeat(250) }), null);
  assert.deepEqual(findFormAnswerIssue(fields, { a: 'é'.repeat(251) }), { problem: 'invalid_answer', fieldId: 'a' });
});

test('every field kind accepts its own shape and refuses the others', () => {
  const one = (kind: FormDefinition['fields'][number]['kind'], required = false) =>
    [kind === 'select' || kind === 'multiselect' ? { id: 'a', kind, label: 'A', required, options: ['x', 'y'] } : { id: 'a', kind, label: 'A', required }];
  const ok = (kind: Parameters<typeof one>[0], value: unknown) => findFormAnswerIssue(one(kind), { a: value } as never) === null;
  assert.ok(ok('phone', '+421 (2) 123-456.7'));
  assert.ok(!ok('phone', 'call me'));
  assert.ok(!ok('phone', '+-()'), 'a phone number needs a digit');
  assert.ok(ok('number', 0));
  assert.ok(ok('number', -12.5));
  assert.ok(!ok('number', '12'));
  assert.ok(!ok('number', Number.POSITIVE_INFINITY));
  assert.ok(!ok('number', Number.NaN));
  assert.ok(ok('date', '2028-02-29'));
  assert.ok(!ok('date', '2026-02-29'));
  assert.ok(!ok('date', '29.02.2028'));
  assert.ok(ok('email', 'a@b.sk'));
  for (const bad of ['a@b', '@b.sk', 'a b@c.sk', 'a@b@c.sk']) assert.ok(!ok('email', bad), bad);
  assert.ok(ok('select', 'x'));
  assert.ok(!ok('select', ['x']));
  assert.ok(ok('multiselect', ['y', 'x']));
  assert.ok(!ok('multiselect', 'x'));
  assert.ok(ok('checkbox', true));
  assert.ok(!ok('checkbox', 'yes'));
  assert.ok(ok('textarea', 'line one\nline two'));
  // Optional fields may be left empty in every representation a browser sends.
  for (const empty of [undefined, null, '', '   ', [], false]) {
    assert.equal(findFormAnswerIssue(one('checkbox'), (empty === undefined ? {} : { a: empty }) as never), null);
  }
  assert.deepEqual(findFormAnswerIssue(one('checkbox', true), { a: false }), { problem: 'required_missing', fieldId: 'a' });
});

test('answer maps are bounded before they are forwarded', async () => {
  const { isFormAnswers } = await import('@sorye/types');
  assert.equal(isFormAnswers({ a: 'x', b: 1, c: true, d: ['x'], e: null }), true);
  assert.equal(isFormAnswers([]), false);
  assert.equal(isFormAnswers(null), false);
  assert.equal(isFormAnswers({ 'bad key': 'x' }), false);
  assert.equal(isFormAnswers({ a: { nested: true } }), false);
  assert.equal(isFormAnswers({ a: 'x'.repeat(5001) }), false);
  assert.equal(isFormAnswers({ a: Array.from({ length: 51 }, () => 'x') }), false);
  assert.equal(isFormAnswers({ a: [1] }), false);
  assert.equal(isFormAnswers(Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`f${index}`, 'x']))), false);
});

test('anonymous routes bound, trap and rate-limit before anything reaches Rodrigo', async () => {
  // No Rodrigo is configured here, so any forwarded request must fail closed with 503.
  for (const key of ['RODRIGO_BASE_URL', 'RODRIGO_KEY_ID', 'RODRIGO_PRIVATE_KEY_FILE']) delete process.env[key];
  const read = await import('../app/api/forms/public/[slug]/route');
  const submit = await import('../app/api/forms/public/[slug]/submissions/route');
  const id = '4f0c1f0e-6f0a-4a57-9a55-0d3a6c0e9b11';
  const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
  const post = (ip: string, body: string, slug = 'contact-us') =>
    submit.POST(new Request(`http://hub.test/api/forms/public/${slug}/submissions`, { method: 'POST', body, headers: { 'x-forwarded-for': ip } }), params(slug));
  const code = async (response: Response) => ((await response.json()) as { error?: { code?: string } }).error?.code;

  const badSlug = await read.GET(new Request('http://hub.test/x', { headers: { 'x-forwarded-for': '198.51.100.1' } }), params('Bad Slug'));
  assert.equal(badSlug.status, 404);
  const unavailable = await read.GET(new Request('http://hub.test/x', { headers: { 'x-forwarded-for': '198.51.100.1' } }), params('contact-us'));
  assert.equal(unavailable.status, 503);
  assert.equal(await code(unavailable), 'forms_unavailable');
  assert.equal(unavailable.headers.get('cache-control'), 'no-store');

  assert.equal((await post('198.51.100.2', 'not json')).status, 400);
  assert.equal((await post('198.51.100.2', JSON.stringify({ submissionId: id, answers: {}, workspaceId: 'w1' }))).status, 400);
  assert.equal((await post('198.51.100.2', 'x'.repeat(70_000))).status, 413);
  const nested = await post('198.51.100.2', JSON.stringify({ submissionId: id, answers: { a: { b: 1 } } }));
  assert.equal(nested.status, 422);
  assert.equal(await code(nested), 'invalid_answer');
  assert.equal((await post('198.51.100.2', '{}', 'Bad Slug')).status, 404);
  const forwarded = await post('198.51.100.2', JSON.stringify({ submissionId: id, answers: { a: 'x' } }));
  assert.equal(forwarded.status, 503, 'a valid submission is forwarded and fails closed without Rodrigo');
  assert.equal(await code(forwarded), 'forms_unavailable');

  // A filled trap is acknowledged without contacting Rodrigo, then the client limit applies.
  const trapped = JSON.stringify({ submissionId: id, answers: { a: 'x' }, website: 'http://spam.example' });
  for (let attempt = 0; attempt < 10; attempt += 1) assert.equal((await post('198.51.100.3', trapped)).status, 201, `attempt ${attempt}`);
  const limited = await post('198.51.100.3', trapped);
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get('retry-after') ?? '', /^[1-9]\d*$/);
  assert.equal((await post('198.51.100.4', trapped)).status, 201, 'another client is not affected');
});

test('Rodrigo client refuses malformed slugs before signing anything', async () => {
  const { readPublishedForm, submitPublicForm } = await import('../lib/rodrigo/service-client');
  for (const slug of ['', 'Contact', '../x', 'a/b', 'a--b', 'a'.repeat(65)]) {
    await assert.rejects(readPublishedForm(slug), /Invalid public form slug/, slug);
    assert.throws(() => submitPublicForm(slug, { submissionId: '4f0c1f0e-6f0a-4a57-9a55-0d3a6c0e9b11', answers: {} }), /Invalid public form slug/, slug);
  }
});

test('Forms is registered consistently: catalog, landing copy in five languages, settings inventory', async () => {
  const { APP_CATALOG, isHubNativeApp } = await import('@sorye/types');
  const { landingLocales, localizedLandings } = await import('../lib/app-landing-translations');
  const { SETTINGS_INVENTORY } = await import('../lib/admin/settings-inventory');
  const entry = APP_CATALOG.find((app) => app.id === 'forms');
  assert.ok(entry);
  assert.equal(entry.slug, 'forms');
  assert.equal(entry.mountPath, '/apps/forms');
  assert.equal(isHubNativeApp(entry), true);
  assert.equal(APP_CATALOG.filter((app) => app.slug === 'forms').length, 1);
  const summaries = new Set<string>();
  for (const locale of landingLocales) {
    const landing = (localizedLandings as Record<string, Record<string, { summary: string; steps: string[] }>>)[locale]?.forms;
    assert.ok(landing, `landing copy for ${locale}`);
    assert.ok(landing.summary.length > 10, locale);
    assert.equal(landing.steps.length, 3, locale);
    summaries.add(landing.summary);
  }
  assert.equal(summaries.size, landingLocales.length, 'each language has its own text');
  const area = SETTINGS_INVENTORY.find((item) => item.id === 'forms');
  assert.deepEqual(area?.settings.map((setting) => setting.key), ['forms.form', 'forms.submission', 'forms.publicRateLimit']);
});

test('Forms text exists in every language with matching placeholders', async () => {
  const { forms: messages } = await import('../../../packages/platform/src/messages/forms');
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');
  const english = messages.en as Record<string, string>;
  const keys = Object.keys(english).sort();
  assert.ok(keys.length >= 70);
  for (const locale of ['de', 'sk', 'hu', 'es'] as const) {
    const translated = messages[locale] as Record<string, string>;
    assert.deepEqual(Object.keys(translated).sort(), keys, locale);
    for (const key of keys) {
      assert.ok(translated[key]!.trim().length > 0, `${locale} ${key}`);
      assert.equal(placeholders(translated[key]!), placeholders(english[key]!), `${locale} ${key}`);
    }
  }
  for (const kind of ['text', 'textarea', 'email', 'phone', 'number', 'date', 'select', 'multiselect', 'checkbox', 'consent']) {
    assert.ok(english[`forms.kind.${kind}`], kind);
  }
});
