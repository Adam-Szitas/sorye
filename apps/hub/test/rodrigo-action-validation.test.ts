import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionBatchSchema, hasDuplicateActionIds, readBoundedActionBatchJson, RODRIGO_ACTION_BATCH_MAX_BYTES } from '../lib/rodrigo/action-validation';
import { classifyTaskActionOutcome } from '../../tasks/src/tasks-action-queue';

const action = (overrides: Record<string, unknown> = {}) => ({
  actionId: 'e1055eb9-cdd7-4942-9a91-5ad3e609ca92', appId: 'tasks', resourceType: 'taskBoard',
  operation: 'create', resourceId: 'main', payloadVersion: 1,
  payload: { statuses: [{ id: 'todo', name: 'To do', color: '#aabbcc', order: 0 }], tasks: [] },
  occurredAt: '2026-11-09T12:00:00.000Z', ...overrides,
});

test('Hub action validator accepts a valid task board aggregate and enforces board invariants', () => {
  assert.equal(actionBatchSchema.safeParse({ actions: [action()] }).success, true);
  const invalidBoards = [
    { statuses: [], tasks: [] },
    { statuses: [{ id: 'todo', name: 'Todo', color: 'red', order: 0 }], tasks: [] },
    { statuses: [{ id: 'todo', name: 'Todo', color: '#aabbcc', order: 0 }], tasks: [{ id: 't1', title: 'x', body: '', statusId: 'missing', createdAt: '2026-11-09T12:00:00Z', updatedAt: '2026-11-09T12:00:00Z' }] },
    { statuses: [{ id: 'todo', name: 'Todo', color: '#aabbcc', order: 0, admin: true }], tasks: [] },
    { statuses: [{ id: 'todo', name: 'Todo', color: '#aabbcc', order: 0 }], tasks: [], owner: 'browser' },
  ];
  for (const payload of invalidBoards) assert.equal(actionBatchSchema.safeParse({ actions: [action({ payload })] }).success, false);
  const board = { statuses: [{ id: 'todo', name: 'To do', color: '#aabbcc', order: 0 }], tasks: [] };
  assert.equal(actionBatchSchema.safeParse({ actions: [action({ operation: 'update', expectedRevision: 1, payload: board })] }).success, true);
  assert.equal(actionBatchSchema.safeParse({ actions: [action({ appId: 'canvas', resourceType: 'board', operation: 'delete', expectedRevision: 1, payload: {} })] }).success, true, 'Canvas board deletion is a revision-checked tombstone');
});

test('Hub action validator enforces revision, identity, operation, and exact payload shapes', () => {
  const cases = [
    action({ operation: 'create', expectedRevision: 1 }),
    action({ operation: 'update' }),
    action({ operation: 'update', expectedRevision: 0 }),
    action({ appId: 'notes', resourceType: 'taskBoard' }),
    action({ appId: 'tasks', resourceType: 'event' }),
    action({ appId: 'tasks', resourceType: 'taskBoard', payloadVersion: 2 }),
    action({ unexpected: true }),
    action({ actionId: 'not-a-uuid' }),
  ];
  for (const invalid of cases) assert.equal(actionBatchSchema.safeParse({ actions: [invalid] }).success, false);

  const task = { id: 't1', title: 'Task', body: '', statusId: 'todo', createdAt: '2026-11-09T12:00:00Z', updatedAt: '2026-11-09T12:00:00Z' };
  assert.equal(actionBatchSchema.safeParse({ actions: [action({ resourceType: 'task', resourceId: 't1', payload: task })] }).success, true);
  assert.equal(actionBatchSchema.safeParse({ actions: [action({ resourceType: 'task', resourceId: 'other', payload: task })] }).success, false);
  assert.equal(actionBatchSchema.safeParse({ actions: [action({ resourceType: 'task', payload: { ...task, injected: true } })] }).success, false);
  const deleteTask = action({ resourceType: 'task', operation: 'delete', expectedRevision: 1, payload: {} });
  assert.equal(actionBatchSchema.safeParse({ actions: [deleteTask] }).success, true);
  assert.equal(actionBatchSchema.safeParse({ actions: [action({ resourceType: 'task', operation: 'delete', expectedRevision: 1, payload: { id: 'x' } })] }).success, false);
});

test('Hub calendar validation rejects impossible dates and malformed times before signing', () => {
  const event = { id: 'event-1', title: 'Event', kind: 'timed', dates: ['2024-02-29'], startTime: '23:59', endTime: '00:00' };
  const build = (payload: Record<string, unknown>) => action({ appId: 'calendar', resourceType: 'event', resourceId: 'event-1', payload });
  assert.equal(actionBatchSchema.safeParse({ actions: [build(event)] }).success, true);
  for (const bad of [
    { ...event, dates: ['2023-02-29'] }, { ...event, dates: ['2024-13-01'] },
    { ...event, dates: ['2024-04-31'] }, { ...event, startTime: '24:00' },
    { ...event, endTime: '' }, { ...event, extra: true },
  ]) assert.equal(actionBatchSchema.safeParse({ actions: [build(bad)] }).success, false);
});

test('Hub validates each advertised v2 family with its exact typed payload shape', () => {
  const now = '2026-11-09T12:00:00.000Z';
  const rows: Array<[string, string, Record<string, unknown>]> = [
    ['workspace','settings',{name:'Workspace',locale:'en',timezone:'UTC',updatedAt:now}],
    ['messenger','channel',{id:'c1',name:'General',kind:'public',updatedAt:now}],
    ['messenger','message',{id:'m1',channelId:'c1',body:'Hello',mentionUserIds:[],attachmentIds:[],createdAt:now,updatedAt:now}],
    ['messenger','reaction',{id:'r1',messageId:'m1',emoji:'👍',createdAt:now}],
    ['files','fileMetadata',{id:'f1',name:'readme.txt',mimeType:'text/plain',sizeBytes:12,blobId:'blob-1',version:1,updatedAt:now}],
    ['canvas','board',{id:'b1',title:'Board',document:{nodes:[]},updatedAt:now}],
    ['mail','account',{id:'a1',provider:'imap',address:'mail@example.test',secretRef:'mail-secret-1',status:'connected',updatedAt:now}],
    ['mail','draft',{id:'d1',accountId:'a1',to:[],cc:[],bcc:[],subject:'',body:'',attachmentIds:[],updatedAt:now}],
    ['relay','config',{id:'relay-main',enabled:true,rules:[],updatedAt:now}],
    ['site','page',{id:'p1',slug:'home',title:'Home',published:false,blocks:[{id:'hero-1',kind:'hero',content:{headline:'Welcome'}}],updatedAt:now}],
      ['storefront','product',{id:'prod1',name:'Product',title:'Product',summary:'Short',description:'Long',currency:'EUR',priceMinor:100,priceCents:100,category:'General',accent:'#f472b6',active:true,updatedAt:now}],
    ['storefront','order',{id:'ord1',status:'requested',customerName:'Customer',customerEmail:'buyer@example.test',note:'Leave it at the dock',items:[{productId:'prod1',quantity:1,unitPriceMinor:100}],createdAt:now,updatedAt:now}],
    ['ocr','analysis',{id:'o1',status:'queued',documentRef:'blob-1',pageCount:1,createdAt:now,updatedAt:now}],
    ['ocr','pattern',{id:'pat1',analysisId:'o1',pattern:{},updatedAt:now}],
    ['studio','project',{id:'s1',name:'Project',assetRefs:[],state:{},updatedAt:now}],
    ['notifications','notification',{id:'n1',kind:'info',title:'Title',body:'',createdAt:now,readAt:null}],
    ['events','event',{id:'e1',name:'app.opened',appId:'tasks',entityId:'',payload:{},createdAt:now}],
    ['embed','widget',{id:'w1',name:'Widget',enabled:true,config:{},updatedAt:now}],
    ['protocolio','artifact',{id:'art1',kind:'template',content:{},updatedAt:now}],
  ];
  for (const [appId, resourceType, payload] of rows) {
    const candidate = action({ actionId: crypto.randomUUID(), appId, resourceType, operation:'create', resourceId:String(payload.id ?? 'settings-main'), payload });
    assert.equal(actionBatchSchema.safeParse({actions:[candidate]}).success, true, `${appId}.${resourceType}`);
    assert.equal(actionBatchSchema.safeParse({actions:[{...candidate,payload:{...payload,unexpectedField:true}}]}).success, false, `${appId}.${resourceType} rejects unknown fields`);
  }
});

test('Hub rejects unsupported v2 operation tuples before signing', () => {
  const base = action({ appId:'messenger', resourceType:'reaction', operation:'create', resourceId:'r1', payload:{id:'r1',messageId:'m1',emoji:'x',createdAt:'2026-11-09T12:00:00Z'} });
  assert.equal(actionBatchSchema.safeParse({actions:[base]}).success,true);
  for (const operation of ['update','delete']) {
    assert.equal(actionBatchSchema.safeParse({actions:[{...base,operation,expectedRevision:1}]}).success,false);
  }
});

test('Hub batch limits and duplicate IDs are bounded independently of network transport', () => {
  const actions = Array.from({ length: 100 }, (_, index) => action({ actionId: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`, resourceId: `board-${index}` }));
  assert.equal(actionBatchSchema.safeParse({ actions }).success, true);
  assert.equal(actionBatchSchema.safeParse({ actions: [...actions, action({ actionId: '123e4567-e89b-42d3-a456-426614174000' })] }).success, false);
  assert.equal(hasDuplicateActionIds([action(), action()]), true);
  assert.equal(hasDuplicateActionIds([action(), action({ actionId: '123e4567-e89b-42d3-a456-426614174000' })]), false);
  assert.equal(RODRIGO_ACTION_BATCH_MAX_BYTES, 256 * 1024);
});

test('Hub bounded JSON reader enforces declared and streamed byte limits', async () => {
  const small = new Request('http://hub.test/api/backend/actions/batch', { method: 'POST', body: '{"actions":[]}' });
  assert.deepEqual(await readBoundedActionBatchJson(small), { actions: [] });
  const exactText = `{"p":"${'x'.repeat(RODRIGO_ACTION_BATCH_MAX_BYTES - 8)}"}`;
  assert.equal(Buffer.byteLength(exactText), RODRIGO_ACTION_BATCH_MAX_BYTES);
  const exactBoundary = new Request('http://hub.test/api/backend/actions/batch', { method: 'POST', body: exactText });
  assert.equal((await readBoundedActionBatchJson(exactBoundary) as { p: string }).p.length, RODRIGO_ACTION_BATCH_MAX_BYTES - 8);
  const declaredLarge = new Request('http://hub.test/api/backend/actions/batch', {
    method: 'POST', headers: { 'content-length': String(RODRIGO_ACTION_BATCH_MAX_BYTES + 1) }, body: '{}',
  });
  await assert.rejects(() => readBoundedActionBatchJson(declaredLarge), /too_large/);
  const streamedLarge = new Request('http://hub.test/api/backend/actions/batch', {
    method: 'POST', body: `{"payload":"${'x'.repeat(RODRIGO_ACTION_BATCH_MAX_BYTES)}"}`,
  });
  await assert.rejects(() => readBoundedActionBatchJson(streamedLarge), /too_large/);
  const malformed = new Request('http://hub.test/api/backend/actions/batch', { method: 'POST', body: '{' });
  await assert.rejects(() => readBoundedActionBatchJson(malformed), SyntaxError);
});

test('Tasks only clears durable acknowledgements and keeps ambiguous provider outcomes retryable', () => {
  assert.equal(classifyTaskActionOutcome({ status: 'committed' }), 'acknowledged');
  assert.equal(classifyTaskActionOutcome({ status: 'duplicate' }), 'acknowledged');
  assert.equal(classifyTaskActionOutcome({ status: 'conflict' }), 'conflict');
  assert.equal(classifyTaskActionOutcome({ status: 'rejected', error: { code: 'provider_unavailable', message: 'unknown commit outcome' } }), 'failed');
  assert.equal(classifyTaskActionOutcome({ status: 'rejected', error: { code: 'invalid_domain_payload', message: 'invalid' } }), 'rejected');
});
