// Run from the repository root: node --test apps/hub/lib/ocr/ocr.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');

// Compile isolated modules without booting Next.js or reading credentials.
function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, file);
  const input = fs.readFileSync(filename, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href));
  const source = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (name) => {
    if (name in mocks) return mocks[name];
    if (name === '@sorye/types') return load('../../../../packages/types/src/ocr-ai.ts');
    if (name === '@/lib/store/json-file') return load('../store/json-file.ts', mocks);
    if (name === '@/lib/env') return mocks[name] ?? { getEnv: () => ({ OCR_LLM_PROVIDER: 'ollama', OCR_LLM_BASE_URL: 'http://127.0.0.1:8000', OCR_LLM_MODEL: 'qwen3:8b' }) };
    if (name === '@/lib/security') return load('../security.ts', mocks);
    if (name === '@/lib/security-limits') return load('../security-limits.ts', mocks);
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`), mocks);
    return require(name);
  };
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
}

const { layoutToRows } = load('./rows.ts');
const { chunkRowPages, MAX_TRANSCRIPT_BYTES } = load('./chunks.ts');
const { emptyPattern, normalizePattern, supplementFromRows } = load('./pattern.ts');
const run = (text, x = 0, math = false) => ({ text, x, y: 0, height: 12, width: text.length * 6, math });

test('matrix addresses normalize equivalent printed formats to the same key', () => {
  const { normalizeOcrMatrixId } = load('../../../../packages/types/src/ocr-ai.ts');
  const variants = ['01.11.05 A', '01.11.05A', '1.11.05A', '01.11.5A', '01.11.05.A'];
  assert.equal(new Set(variants.map(normalizeOcrMatrixId)).size, 1);
  assert.notEqual(normalizeOcrMatrixId('01.11.06 A'), normalizeOcrMatrixId(variants[0]));
});

test('reading export returns one normalized table and findings without duplicate matrices or private metadata', () => {
  const { buildOcrReadingDocument } = load('../../../../packages/types/src/ocr-ai.ts');
  const pages = [{ page: 1, rows: ['01.11.05 A\tService\t96 491,29'] }, { page: 2, rows: [] }];
  const pattern = { ...emptyPattern(), fields: { Total: '96 491,29' }, math: [{ page: 1, row: 2, text: 'x_y = 2  m²' }] };
  const source = { id: 'ocr-test', fileName: 'invoice.pdf', status: 'rows_only', error: 'Model unavailable', pages, pattern,
    workspaceId: 'private', createdBy: 'private', layout: { fontSize: 12 }, vector: { cursor: {} } };
  pattern.matrixRows = [{ page: 1, row: 1, id: '01.11.05 A', cells: ['01.11.05 A', 'Service', '96 491,29'] }];
  pattern.unclearFindings = [{ page: 2, finding: 'Last column is unreadable' }];
  pattern.normalizedColumns = ['Position / variable', 'Description / calculation', 'Period / result'];
  pattern.normalizedRows = [{ page: 1, row: 0, id: '01.11.05 A', cells: ['01.11.05 A', 'Service', '96 491,29'] }];
  const before = JSON.stringify(source);
  const document = buildOcrReadingDocument(source);
  assert.equal('matrixRows' in document, false);
  assert.deepEqual(document.unclearFindings, pattern.unclearFindings);
  assert.deepEqual(document.normalizedData.rows, pattern.normalizedRows);
  assert.deepEqual(document.normalizedData.columns, pattern.normalizedColumns);
  assert.equal(document.id, 'ocr-test');
  assert.equal('transcript' in document, false);
  assert.equal('records' in document, false);
  assert.equal(document.warning, 'Model unavailable');
  for (const key of ['workspaceId', 'createdBy', 'layout', 'fontSize', 'vector']) assert.equal(key in document, false);
  assert.equal(JSON.stringify(source), before, 'export must not mutate stored data');
  assert.equal(buildOcrReadingDocument({ ...source, pattern: null }).normalizedData.rows.length, 1);
});

test('normalized OCR output preserves every Node row and falls back when AI changes or omits data', () => {
  const pages = [{ page: 2, rows: ['08.01.05 A Widget -15,060 m²', 'continuation value 6,240 m²', '01.02.03.B Other 4,000 m'] }];
  const normalized = normalizePattern({
    documentKind: 'table',
    normalizedColumns: ['Position / ID', 'Description', 'Result', 'Unit'],
    normalizedRows: [
      { page: 2, row: 0, id: '08.01.05 A', cells: ['08.01.05 A', 'Widget', '-15,060 m²'] },
      { page: 2, row: 1, id: null, cells: ['continuation value', '6,240'] },
      { page: 2, row: 2, id: '01.02.04.B', cells: ['01.02.03.B', 'Other', '4,000', 'm'] },
    ],
  });
  const result = supplementFromRows(normalized, pages);
  assert.equal(result.normalizedRows.length, pages[0].rows.length);
  assert.deepEqual(result.normalizedRows[0], {
    page: 2, row: 0, id: '08.01.05 A', cells: ['08.01.05 A', 'Widget', '-15,060 m²'],
  });
  assert.deepEqual(result.normalizedRows[1], {
    page: 2, row: 1, id: null, cells: ['', 'continuation value', '6,240 m²'], sourceFallback: true,
  });
  assert.deepEqual(result.normalizedRows[2], {
    page: 2, row: 2, id: '01.02.03.B', cells: ['01.02.03.B', 'Other', '4,000 m'], sourceFallback: true,
  });
  assert.deepEqual(result.matrixRows.map((row) => row.id), ['08.01.05 A', '08.01.05 A', '01.02.03.B']);
});

const measurement = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/measurement-rows.json'), 'utf8'));
const measurementPages = (separator) => measurement.pages.map(({ page, rows }) => ({
  page, rows: rows.map((cells) => separator === '\t' ? cells.join(separator) : cells.filter(Boolean).join(separator)),
}));
// Expected body boundaries and the two long formulas come from the supplied PDF,
// independently of the normalization/classification functions under test.
const measurementExpected = measurement.pages.flatMap(({ page, rows }) => rows.flatMap((cells, row) => {
  if (row < (page === 1 ? 7 : 6) || row >= rows.length - 2) return [];
  const expected = [...cells];
  if (page === 2 && (row === 8 || row === 21)) { expected[1] = expected[0]; expected[0] = ''; }
  return [{ page, row, id: expected[0].includes('.') ? expected[0] : null, cells: expected }];
}));

test('supplied two-page measurement keeps all 66 body rows in three columns and removes only page furniture', () => {
  const { buildOcrReadingDocument } = load('../../../../packages/types/src/ocr-ai.ts');
  for (const separator of ['\t', ' ']) {
    const pages = measurementPages(separator);
    const before = JSON.stringify(pages);
    const ai = normalizePattern({ documentKind: 'table', pdfTypeId: '7.RH-TOP27-TOP23', normalizedRows: measurementExpected });
    const normalized = supplementFromRows(ai, pages);
    assert.equal(normalized.pdfTypeId, '7.RH-TOP27-TOP23');
    assert.equal(normalized.normalizedRows.length, 66);
    assert.deepEqual(normalized.normalizedRows, measurementExpected);
    assert.equal(JSON.stringify(pages), before);
    const crossPage = normalized.matrixRows.filter((row) => row.id === '08.01.01.A');
    assert.equal(crossPage.length, 7, 'position plus five calculations and a total across the page break');
    assert.equal(crossPage.at(-1).cells[2], '488,893 m²');
    assert.ok(crossPage.slice(1).every((row) => row.cells[0] === '' && row.page === 2));
    const exported = buildOcrReadingDocument({ id: 'ocr-measurement', fileName: measurement.fileName, pages, pattern: normalized, status: 'ready' });
    assert.equal(exported.id, 'ocr-measurement');
    assert.equal(exported.fileName, measurement.fileName);
    assert.equal(exported.pdfTypeId, '7.RH-TOP27-TOP23');
    assert.deepEqual(exported.normalizedData.rows, measurementExpected);
  }
});

test('missing, altered, misplaced and invented AI rows cannot lose body values or change the three-column layout', () => {
  const { buildOcrReadingDocument } = load('../../../../packages/types/src/ocr-ai.ts');
  const pages = measurementPages(' ');
  const badAi = normalizePattern({
    pdfTypeId: 'invented',
    normalizedRows: [
      { page: 2, row: 8, id: null, cells: ['', measurementExpected.find((row) => row.page === 2 && row.row === 8).cells[1], ''] },
      { page: 2, row: 21, id: null, cells: ['', 'invented formula', '15,060 m²'] },
      { page: 2, row: 11, id: null, cells: ['', '488,893 m²', ''] },
      { page: 9, row: 0, id: null, cells: ['', 'invented row', '999'] },
    ],
  });
  for (const pattern of [badAi, null]) {
    const document = buildOcrReadingDocument({ id: 'ocr-older', fileName: measurement.fileName, pages, pattern, status: 'ready' });
    assert.equal(document.pdfTypeId, '7.RH-TOP27-TOP23');
    assert.deepEqual(document.normalizedData.rows.map(({ sourceFallback, ...row }) => row), measurementExpected);
    assert.ok(document.normalizedData.rows.every((row) => row.sourceFallback && row.cells.length === 3));
  }
});

test('resuming inference replaces source fallback rows with complete validated AI cells', () => {
  const { mergePatterns } = load('./pattern.ts');
  const pages = measurementPages(' ');
  const prior = supplementFromRows(emptyPattern(), pages);
  const fresh = normalizePattern({ normalizedRows: measurementExpected });
  assert.deepEqual(supplementFromRows(mergePatterns([prior, fresh]), pages).normalizedRows, measurementExpected);
});

test('a saved cursor from an older prompt restarts inference instead of skipping revised chunks', async () => {
  let calls = 0;
  const { analyzeRowPages } = load('./analyze.ts', {
    './llm': {
      llmModelName: () => 'test', assertLlmAvailable: async () => {}, LlmUnavailableError: class extends Error {},
      completeJson: async () => { calls++; return { normalizedRows: measurementExpected }; },
    },
  });
  const result = await analyzeRowPages(measurementPages(' '), undefined, {
    start: 999, missed: 9, prior: { ...emptyPattern(), normalizationVersion: 1 },
  });
  assert.ok(calls > 0);
  assert.equal(result.status, 'ready');
  assert.equal(result.cursor.missed, 0);
  assert.deepEqual(result.pattern.normalizedRows, measurementExpected);
});

test('library table and searches include continuation results in older saved readings', () => {
  const { queryLibrary } = load('./library-query.ts');
  const source = [{ id: 'ocr-measurement', fileName: measurement.fileName, createdAt: '2026-10-27T00:00:00Z', status: 'ready',
    pages: measurementPages(' '), pattern: emptyPattern() }];
  const result = queryLibrary(source, { code: '7.RH-TOP27-TOP23' });
  assert.equal(result.length, 1);
  assert.equal(result[0].recordCount, 66);
  assert.ok(result[0].records.some((row) => row.c2 === '-15,060 m²'));
  assert.equal(queryLibrary(source, { code: '55,050' }).length, 1);
});

test('reading UIs render the complete continuous table and export the same rows', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const exported = [];
  const mocks = {
    '@sorye/sdk/react/document-reading': { JsonDocument: ({ value }) => { exported.push(value); return null; } },
    './hub-origin': { hubApiPath: (url) => url },
    './ocr-reading-print': { PrintReadingButton: () => null },
  };
  const components = [
    load('../../../ocr/src/reading-view.tsx', mocks).ReadingView,
    load('../../components/ocr-reading.tsx', mocks).OcrReading,
  ];
  for (const Component of components) {
    const html = renderToStaticMarkup(React.createElement(Component, { analysis: {
      id: 'ocr-measurement', fileName: measurement.fileName, status: 'ready',
      pages: measurementPages(' '), pattern: emptyPattern(),
    } }));
    const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)[1];
    assert.equal((body.match(/<tr\b/g) ?? []).length, 66);
    assert.equal((body.match(/<td\b/g) ?? []).length, 198);
    assert.match(body, /<td>-<\/td><td>1,00\/15<\/td><td>0,067 PA<\/td>/);
    assert.match(body, /<td>-15,060 m²<\/td>/);
    assert.match(body, /<td>55,050 m<\/td>/);
    assert.doesNotMatch(body, /colSpan|colspan|Seite:|Für den Auftrag|Sedlak/);
    assert.doesNotMatch(html, /<th[^>]*>(?:Page|Source row)<\/th>/);
    assert.ok(html.indexOf('</table>') < html.indexOf('Unclear findings'));
    assert.deepEqual(exported.at(-1).normalizedData.rows.map(({ sourceFallback, ...row }) => row), measurementExpected);
  }
});

test('LLM requires complete explicit configuration and a running server with the model', async () => {
  const oldFetch = global.fetch;
  const configured = { OCR_LLM_PROVIDER: 'ollama', OCR_LLM_BASE_URL: 'http://127.0.0.1:8000', OCR_LLM_MODEL: 'qwen3:8b' };
  let env = {};
  let calls = 0;
  const llm = load('./llm.ts', {
    '@/lib/env': { getEnv: () => env },
    '@/lib/security': { assertSafeLlmBaseUrl: (url) => url },
  });
  try {
    global.fetch = async () => { calls++; throw new Error('offline'); };
    for (const key of Object.keys(configured)) {
      env = { ...configured, [key]: undefined };
      await assert.rejects(llm.completeJson('document'), /LLM skipped/);
      await llm.releaseLoadedModel();
    }
    assert.equal(calls, 0, 'missing config must never cause network calls, including cleanup');
    env = configured;
    await assert.rejects(llm.completeJson('document'), /LLM skipped/);
    assert.equal(calls, 1, 'offline servers receive only a readiness probe');
    global.fetch = async () => Response.json({ models: [] });
    await assert.rejects(llm.assertLlmAvailable(), /LLM skipped/);
    global.fetch = async () => Response.json({ models: [{ name: 'qwen3:8b' }] });
    await llm.assertLlmAvailable();
    env = { ...configured, OCR_LLM_PROVIDER: 'vllm' };
    global.fetch = async (url, init) => {
      assert.equal(String(url), 'http://127.0.0.1:8000/v1/models');
      assert.equal(init.redirect, 'error');
      return Response.json({ data: [{ id: 'qwen3:8b' }] });
    };
    await llm.assertLlmAvailable();
    global.fetch = async () => Response.json({}, { status: 503 });
    await assert.rejects(llm.assertLlmAvailable(), /LLM skipped/);
  } finally { global.fetch = oldFetch; }
});

test('unavailable LLM is excluded while rows and prior results are retained', async () => {
  class Unavailable extends Error {}
  let calls = 0;
  const { analyzeRowPages } = load('./analyze.ts', {
    './llm': {
      llmModelName: () => 'test', LlmUnavailableError: Unavailable,
      assertLlmAvailable: async () => { throw new Unavailable('LLM skipped'); },
      completeJson: async () => { calls++; },
    },
  });
  const prior = { ...emptyPattern(), summary: 'Previously read section' };
  const result = await analyzeRowPages([{ page: 1, rows: ['retained text'] }], undefined, { prior });
  assert.equal(result.status, 'rows_only');
  assert.equal(result.pattern.summary, prior.summary);
  assert.equal(result.error, 'LLM skipped');
  assert.equal(calls, 0);
});

test('server stopping during work excludes remaining slices without retries', async () => {
  class Unavailable extends Error {}
  let calls = 0;
  const { analyzeRowPages } = load('./analyze.ts', {
    './llm': {
      llmModelName: () => 'test', LlmUnavailableError: Unavailable,
      assertLlmAvailable: async () => {},
      completeJson: async () => { calls++; throw new Unavailable('Server stopped'); },
    },
  });
  const result = await analyzeRowPages([{ page: 1, rows: Array(100).fill('text '.repeat(100)) }]);
  assert.equal(result.status, 'rows_only');
  assert.equal(result.error, 'Server stopped');
  assert.equal(calls, 1);
});

test('long source rows retain their middle and both ends', () => {
  const text = 'a'.repeat(10000) + 'MIDDLE' + 'b'.repeat(15000);
  assert.deepEqual(layoutToRows([run(text)], []), [text]);
});

test('same-line text stays in visual order without math tags or underscore gaps', () => {
  const row = layoutToRows([run('=2', 12, true), run('x', 0, true)], [])[0];
  assert.equal(row, 'x =2');
  assert.equal(row.includes('[MATH]'), false);
  assert.equal(row.includes('_'), false);
});

test('a unit price line keeps the space, the slash, and m²', () => {
  const row = layoutToRows([run('22,61 / m²')], [])[0];
  assert.equal(row, '22,61 / m²');
  assert.equal(row.includes('[MATH]'), false);
  assert.equal(row.includes('/MATH]'), false);
  assert.equal(row.includes('_'), false);
});

test('stacked lines stay separate and a figure with no text is [IMAGE]', () => {
  const upper = { text: '1', x: 10, y: 0, height: 12, width: 8 };
  const lower = { text: '2', x: 10, y: 20, height: 12, width: 8 };
  assert.deepEqual(layoutToRows([lower, upper], []), ['1', '2']);
  assert.deepEqual(layoutToRows([run('²')], []), ['²']);
  assert.deepEqual(
    layoutToRows([], [{ x: 0, y: 0, width: 40, height: 40 }]),
    ['[IMAGE]'],
  );
});

test('all source annotations survive beyond 100 entries, without invented model math', () => {
  const pages = [{ page: 1, rows: Array.from({ length: 150 }, (_, n) => `[MATH]x=${n}[/MATH]_[IMAGE]`) }];
  const pattern = emptyPattern();
  pattern.math.push({ page: 99, row: 0, text: '[MATH]invented[/MATH]' });
  const result = supplementFromRows(pattern, pages);
  assert.equal(result.math.length, 150);
  assert.equal(result.images.length, 150);
  assert.equal(result.math.at(-1).text, '[MATH]x=149[/MATH]');
  assert.ok(result.math.every((item) => item.page === 1));
});

test('oversized Unicode rows are chunked without losing characters or row references', () => {
  const text = '漢字🙂∑=2'.repeat(5000);
  const chunks = chunkRowPages([{ page: 7, rows: [text] }]);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk) <= MAX_TRANSCRIPT_BYTES));
  assert.ok(chunks.every((chunk) => chunk.startsWith('PAGE 7\n0|')));
  assert.equal(chunks.map((chunk) => chunk.slice('PAGE 7\n0|'.length, -1)).join(''), text);
});

test('dense pages retain original row numbering across chunks', () => {
  const rows = Array.from({ length: 1200 }, (_, index) => `row ${index}`);
  const chunks = chunkRowPages([{ page: 3, rows }]);
  assert.ok(chunks.length > 1);
  const expected = rows.map((row, index) => `PAGE 3\n${index}|${row}\n`).join('');
  assert.equal(chunks.join(''), expected);
});

test('library search keeps the UTC day window and the latest 50', () => {
  const { queryLibrary, parseAmount, parseLibraryQuery } = load('./library-query.ts');
  assert.equal(parseAmount('50 000'), 50000);
  assert.equal(parseAmount('1.250,50'), 1250.5);
  assert.throws(() => parseLibraryQuery({ from: '2026-02-31' }), /real/);
  assert.throws(() => parseLibraryQuery({ from: '2026-03-10', to: '2026-03-01' }), /reversed/);
  const pattern = (amount, code) => ({
    documentKind: 'invoice',
    summary: '',
    patterns: [],
    records: [{ amount, code, note: 'keep' }],
    fields: { Total: amount },
    math: [],
    images: [],
  });
  const rows = Array.from({ length: 55 }, (_, index) => ({
    id: `ocr-${String(index).padStart(4, '0')}`,
    fileName: index === 3 ? 'special-invoice.pdf' : `doc-${index}.pdf`,
    createdAt: `2026-03-${String((index % 27) + 1).padStart(2, '0')}T12:00:00.000Z`,
    status: 'ready',
    pattern: pattern(index === 3 ? '75 000' : '10 000', index === 3 ? '26-00168' : 'other'),
  }));
  const latest = queryLibrary(rows, {});
  assert.equal(latest.length, 50);
  const ranged = queryLibrary(rows, { from: '2026-03-01', to: '2026-03-05' });
  assert.ok(ranged.every((hit) => hit.createdAt.slice(0, 10) >= '2026-03-01' && hit.createdAt.slice(0, 10) <= '2026-03-05'));
  const coded = queryLibrary(rows, { code: '26-00168' });
  assert.deepEqual(coded.map((hit) => hit.fileName), ['special-invoice.pdf']);
  const rich = queryLibrary(rows, { amounts: [{ notation: 'amount', op: 'gt', value: 50000 }], scope: 'fields' });
  assert.equal(rich.length, 1);
  assert.equal(rich[0].records.length, 1);
  assert.deepEqual(Object.keys(rich[0].records[0]), ['amount']);
  assert.equal(rich[0].records[0].amount, '75 000');
  assert.deepEqual(rich[0].fields, {});
  const named = queryLibrary(rows, { name: 'special', notations: ['fields.Total'] });
  assert.equal(named.length, 1);
});

test('reading text turns gaps and markers into words', () => {
  const { ocrReadingText } = load('../../../../packages/types/src/ocr-ai.ts');
  assert.equal(
    ocrReadingText('Invoice_100_[IMAGE]_[MATH]E=mc2[/MATH]'),
    'Invoice 100 [figure] E=mc2',
  );
  assert.equal(ocrReadingText('22,61[MATH]/_m²[/MATH]'), '22,61 / m²');
  assert.equal(ocrReadingText('22,61/MATH]/_m²[/MATH]'), '22,61 / m²');
  assert.equal(ocrReadingText('22,61/MATH]/ m²'), '22,61 / m²');
  assert.equal(ocrReadingText('510,864[MATH]m²[/MATH]'), '510,864 m²');
  assert.equal(ocrReadingText('[MATH]22,61[/MATH] m²'), '22,61 m²');
  assert.equal(ocrReadingText('logo_[IMAGE'), 'logo [figure]');
});

const POSITION_ROWS = [
  '01.11.04.A\tBaustelle einrichten und räumen\t \t \t1',
  ' \t96 491,29/ PA\t59 543,90\t36 947,39\t ',
  ' \t0,067PA\t3 989,44\t2 475,48\t6 464,92',
];

test('model input keeps each amount on its own line', () => {
  const { OCR_PATTERN_SYSTEM_PROMPT, formatRowForModel } = load('./pattern.ts');
  assert.match(OCR_PATTERN_SYSTEM_PROMPT, /Return one normalizedRows entry for EVERY meaningful input line/);
  assert.match(OCR_PATTERN_SYSTEM_PROMPT, /Copy every source value exactly once/);
  assert.match(OCR_PATTERN_SYSTEM_PROMPT, /Do not return copied page text, a separate transcript/);
  const chunks = chunkRowPages([{ page: 1, rows: POSITION_ROWS }]);
  const text = chunks.join('');
  const rowLine = (index) => text.split('\n').find((line) => line.startsWith(`${index}|`));
  const description = rowLine(0);
  const grouped = rowLine(1);
  const total = rowLine(2);
  assert.equal(description, '0|01.11.04.A | Baustelle einrichten und räumen |  |  | 1');
  assert.equal(description.includes('6 464,92'), false);
  assert.equal(description.includes('491,29'), false);
  assert.equal(grouped, '1| | 96 491,29/ PA | 59 543,90 | 36 947,39 | ');
  assert.equal(grouped.includes('6 464,92'), false);
  assert.equal(total, '2| | 0,067PA | 3 989,44 | 2 475,48 | 6 464,92');
  assert.equal(total.includes('96 491,29'), false);
  assert.equal(formatRowForModel(POSITION_ROWS[1]).includes('96 491,29'), true);
  assert.equal(POSITION_ROWS[1], ' \t96 491,29/ PA\t59 543,90\t36 947,39\t ');
});

test('a scrambled model reply is put back on the listing lines', async () => {
  const { alignRecordsToRows, recordTableColumns } = load('../../../../packages/types/src/ocr-ai.ts');
  const pages = [{ page: 1, rows: POSITION_ROWS }];
  const scrambled = [{
    description: 'Baustelle einrichten und räumen',
    unitPrice: '491,29',
    quantity: '1',
    total: '6 464,92',
  }];
  const aligned = alignRecordsToRows(scrambled, pages);
  assert.deepEqual(recordTableColumns(aligned), ['c0', 'c1', 'c2', 'c3', 'c4']);
  assert.equal(aligned[0].c1, 'Baustelle einrichten und räumen');
  assert.equal(aligned[0].c4, '1');
  assert.equal(aligned[0].c2, undefined);
  assert.equal(Object.values(aligned[0]).includes('491,29'), false);
  assert.equal(Object.values(aligned[0]).some((value) => value.includes('6 464,92')), false);
  assert.equal(aligned[1].c1, '96 491,29/ PA');
  assert.equal(aligned[1].c2, '59 543,90');
  assert.equal(aligned[1].c3, '36 947,39');
  assert.equal(Object.values(aligned[1]).includes('491,29'), false);
  assert.equal(Object.values(aligned[1]).some((value) => value.includes('6 464,92')), false);
  assert.equal(aligned[2].c1, '0,067PA');
  assert.equal(aligned[2].c2, '3 989,44');
  assert.equal(aligned[2].c3, '2 475,48');
  assert.equal(aligned[2].c4, '6 464,92');
  assert.deepEqual(alignRecordsToRows(aligned, pages), aligned);

  const { analyzeRowPages } = load('./analyze.ts', {
    './llm': {
      llmModelName: () => 'test', assertLlmAvailable: async () => {}, LlmUnavailableError: class extends Error {},
      completeJson: async () => ({
        documentKind: 'table',
        summary: 'Position',
        patterns: [],
        records: scrambled,
        fields: {},
        math: [],
        images: [],
      }),
    },
  });
  const result = await analyzeRowPages(pages);
  assert.equal(pages[0].rows[1].includes('[MATH]'), false);
  assert.equal(pages[0].rows[1], POSITION_ROWS[1]);
  assert.deepEqual(layoutToRows([run('96 491,29/ PA')], []), ['96 491,29/ PA']);
  assert.deepEqual(layoutToRows([run('22,61 / m²')], []), ['22,61 / m²']);

  const { queryLibrary } = load('./library-query.ts');
  const source = {
    id: 'ocr-position-1',
    fileName: 'leistungsverzeichnis.pdf',
    createdAt: '2026-10-25T12:00:00.000Z',
    status: 'ready',
    pages,
    pattern: {
      documentKind: 'table',
      summary: '',
      patterns: [],
      records: scrambled,
      fields: {},
      math: [],
      images: [],
    },
  };
  const found = queryLibrary([source], { code: 'Baustelle' });
  assert.equal(found.length, 1);
  assert.equal(found[0].records[0].c1, 'Baustelle einrichten und räumen');
  assert.equal(found[0].records[0].c4, '1');
  assert.equal(found[0].records[1].c1, '96 491,29/ PA');
  assert.equal(found[0].records[2].c4, '6 464,92');
  const byAmount = queryLibrary([source], {
    amounts: [{ notation: 'unitPrice', op: 'gt', value: 400 }],
  });
  assert.equal(byAmount.length, 1);
  assert.equal(byAmount[0].records[1].c1, '96 491,29/ PA');
  const namedOnly = queryLibrary([source], {
    amounts: [{ notation: 'unitPrice', op: 'gt', value: 400 }],
    scope: 'fields',
  });
  assert.deepEqual(Object.keys(namedOnly[0].records[0]), ['unitPrice']);
  assert.equal(namedOnly[0].records[0].unitPrice, '491,29');
});

test('space-separated listing lines keep grouped amounts on their own row', async () => {
  const { alignRecordsToRows } = load('../../../../packages/types/src/ocr-ai.ts');
  const { formatRowForModel } = load('./pattern.ts');
  const rows = [
    '01.11.04.A Baustelle einrichten und räumen 1',
    '96 491,29/ PA 59 543,90 36 947,39',
    '0,067 PA 3 989,44 2 475,48 6 464,92',
    '01.11.05.A Baustelleneinrichtung vorhalten Baudauer 1',
    '29 415,62/ Mo 20 167,79 9 247,83',
  ];
  const pages = [{ page: 1, rows }];
  const scrambled = [{
    description: 'Baustelle einrichten und räumen',
    unit_price: '491,29',
    quantity: '1',
    total: '6 464,92',
  }];
  const aligned = alignRecordsToRows(scrambled, pages);
  assert.equal(aligned.length, 3);
  assert.equal(aligned[0].c0, '01.11.04.A Baustelle einrichten und räumen');
  assert.equal(aligned[0].c1, '1');
  assert.equal(Object.values(aligned[0]).some((value) => value.includes('6 464,92')), false);
  assert.equal(Object.values(aligned[0]).includes('491,29'), false);
  assert.equal(aligned[1].c0, '96 491,29/ PA');
  assert.equal(aligned[1].c1, '59 543,90');
  assert.equal(aligned[1].c2, '36 947,39');
  assert.equal(aligned[2].c0, '0,067 PA');
  assert.equal(aligned[2].c1, '3 989,44');
  assert.equal(aligned[2].c2, '2 475,48');
  assert.equal(aligned[2].c3, '6 464,92');
  assert.equal(aligned.some((record) => Object.values(record).some((value) => value.includes('29 415,62'))), false);
  assert.deepEqual(alignRecordsToRows(aligned, pages), aligned);
  assert.equal(formatRowForModel(rows[1]), rows[1]);
  assert.equal(formatRowForModel(rows[0]), rows[0]);
  assert.equal(rows[1], '96 491,29/ PA 59 543,90 36 947,39');

  const { analyzeRowPages } = load('./analyze.ts', {
    './llm': {
      llmModelName: () => 'test', assertLlmAvailable: async () => {}, LlmUnavailableError: class extends Error {},
      completeJson: async () => ({
        documentKind: 'table',
        summary: 'Position',
        patterns: [],
        records: scrambled,
        fields: {},
        math: [],
        images: [],
      }),
    },
  });
  const result = await analyzeRowPages(pages);
  assert.deepEqual(result.pattern.records, []);
  assert.equal(pages[0].rows[1], rows[1]);
});

test('pattern fields drop broken math markers while source rows stay marked', () => {
  const normalized = normalizePattern({
    records: [{ unitPrice: '22,61/MATH]/_m²[/MATH]', quantity: '510,864[MATH]m²[/MATH]' }],
    fields: { area: '510,864[MATH]m²[/MATH]' },
    math: [{ page: 1, row: 44, text: '[MATH]/_m²[/MATH]' }],
  });
  assert.deepEqual(normalized.records, []);
  assert.deepEqual(normalized.fields, {});

  const pages = [{ page: 1, rows: ['22,61[MATH]/_m²[/MATH]'] }];
  const supplemented = supplementFromRows(
    {
      ...emptyPattern(),
      records: [{ unitPrice: '22,61/MATH]/_m²[/MATH]' }],
    },
    pages,
  );
  assert.equal(pages[0].rows[0], '22,61[MATH]/_m²[/MATH]');
});

test('library search still matches stored marker text and hides it in the table', () => {
  const { queryLibrary } = load('./library-query.ts');
  const source = [
    {
      id: 'ocr-20fa4e7c-d26',
      fileName: '1.TR_RH7_TOP27-TOP23.pdf',
      createdAt: '2026-10-07T12:00:00.000Z',
      status: 'ready',
      pattern: {
        documentKind: 'invoice',
        summary: '',
        patterns: [],
        records: [{ unitPrice: '22,61/MATH]/_m²[/MATH]', quantity: '510,864[MATH]m²[/MATH]' }],
        fields: {},
        math: [],
        images: [],
      },
    },
  ];
  const hits = queryLibrary(source, { code: '22,61' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].records[0].unitPrice, '22,61 / m²');
  assert.equal(hits[0].records[0].quantity, '510,864 m²');
  assert.equal(hits[0].records[0].unitPrice.includes('MATH'), false);
  assert.equal(queryLibrary(source, { code: 'MATH' }).length, 1);
  assert.equal(queryLibrary(source, { code: 'no-such-code' }).length, 0);
});

test('document vector keeps page offsets and marks an image-only page incomplete', () => {
  const { buildVector, flattenLines } = load('./vector.ts');
  const pages = [
    { page: 1, rows: ['Invoice_100', '[MATH]E=mc2[/MATH]'] },
    { page: 2, rows: ['[IMAGE]'] },
  ];
  const vector = buildVector(pages);
  assert.equal(vector.version, 1);
  assert.deepEqual(vector.pageStarts, [0, 2]);
  assert.equal(vector.lineCount, 3);
  assert.equal(vector.notes[0].complete, true);
  assert.equal(vector.notes[1].complete, false);
  assert.match(vector.notes[1].warning, /does not perform OCR/);
  assert.deepEqual(flattenLines(pages), ['Invoice_100', '[MATH]E=mc2[/MATH]', '[IMAGE]']);
});

test('image-only pages are not reported ready even if the model succeeds', async () => {
  const { analyzeRowPages } = load('./analyze.ts', {
    './llm': { llmModelName: () => 'test', assertLlmAvailable: async () => {}, LlmUnavailableError: class extends Error {}, completeJson: async () => emptyPattern() },
  });
  const result = await analyzeRowPages([{ page: 2, rows: ['[IMAGE]'] }]);
  assert.equal(result.status, 'rows_only');
  assert.match(result.error, /Pages 2.*does not perform OCR/);
});

test('model failure preserves every source math annotation', async () => {
  const { analyzeRowPages } = load('./analyze.ts', {
    './llm': { llmModelName: () => 'test', assertLlmAvailable: async () => {}, LlmUnavailableError: class extends Error {}, completeJson: async () => { throw new Error('Unavailable'); } },
  });
  const result = await analyzeRowPages([{ page: 1, rows: ['[MATH]x=2[/MATH]'] }]);
  assert.equal(result.status, 'rows_only');
  assert.equal(result.pattern.math[0].text, '[MATH]x=2[/MATH]');
});

test('JSON file persistence round-trips long rows, Unicode and math after reopening', async () => {
  const { JsonFile } = load('../store/json-file.ts');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sorye-ocr-test-'));
  const filename = path.join(directory, 'analyses.json');
  const data = { pages: [{ page: 1, rows: ['[MATH]∑x²=4[/MATH]', '漢🙂'.repeat(15000)] }] };
  try {
    const store = new JsonFile(filename, () => ({ analyses: [] }));
    await store.update((value) => value.analyses.push(data));
    const reopened = new JsonFile(filename, () => ({ analyses: [] }));
    assert.deepEqual(await reopened.read(), { analyses: [data] });
  } finally {
    // Only exact files created by this test; never recursively delete a computed path.
    fs.unlinkSync(filename);
    fs.rmdirSync(directory);
  }
});

function pdfFixture(texts) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${texts.length} /Kids [${texts.map((_, n) => `${4 + n * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const entry of texts) {
    const { text, x = 72, y = 720 } = typeof entry === 'string' ? { text: entry } : entry;
    const streamId = objects.length + 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
    const stream = `BT /F1 12 Tf ${x} ${y} Td (${text}) Tj ET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, n) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${n + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf));
}

test('real PDF.js extraction retains page order and the visible text', async () => {
  const { readPdfAsRows } = load('./read-pdf.ts');
  const pages = await readPdfAsRows(pdfFixture(['First page line', 'x=2']));
  assert.deepEqual(pages, [
    { page: 1, rows: ['First page line'] },
    { page: 2, rows: ['x=2'] },
  ]);
});

test('real PDF.js extraction preserves right-edge values on the second page', async () => {
  const { readPdfAsRows } = load('./read-pdf.ts');
  const pages = await readPdfAsRows(pdfFixture([
    'First page values',
    { text: 'RIGHTMOST 987654.32', x: 465 },
  ]));
  assert.equal(pages.length, 2);
  assert.match(pages[1].rows.join(' '), /RIGHTMOST 987654\.32/);
});

test('matrix layout keeps repeated result columns separate from long calculations', () => {
  const { buildPageLayout } = load('../../../ocr/src/layout-matrix.ts', {
    '@sorye/types': {
      inferBoldFromFontName: () => false,
      inferItalicFromFontName: () => false,
      sizeRankFromFont: () => 'md',
    },
  });
  const words = [];
  for (let row = 0; row < 6; row += 1) {
    const y = 40 + row * 42;
    words.push(
      { text: `08.01.0${row}.A`, confidence: 100, x0: 190, y0: y, x1: 290, y1: y + 33, style: { fontSize: 33 } },
      { text: `long calculation ${row} 29.47*5.90// description`, confidence: 100, x0: 525, y0: y, x1: 1800, y1: y + 33, style: { fontSize: 33 } },
      { text: `${100 + row},873 m²`, confidence: 100, x0: 2130, y0: y, x1: 2275, y1: y + 33, style: { fontSize: 33 } },
    );
  }
  const layout = buildPageLayout(words, 2479);
  assert.equal(layout.cols, 3);
  assert.ok(layout.matrix.every((row) => row[2]?.includes('m²')));
  assert.ok(layout.matrix.some((row) => row[2]?.includes('105,873')));
});

test('real PDF.js rejects documents over the page limit', async () => {
  const { readPdfAsRows } = load('./read-pdf.ts');
  await assert.rejects(readPdfAsRows(pdfFixture(Array(501).fill('page'))), /too many pages/);
});

test('output limit is split until every slice finishes', async () => {
  const calls = [];
  const { analyzeRowPages } = load('./analyze.ts', {
    './llm': {
      llmModelName: () => 'test', assertLlmAvailable: async () => {}, LlmUnavailableError: class extends Error {},
      completeJson: async (text) => {
        calls.push(text);
        const blocks = text.split('\n').filter((line) => line.startsWith('PAGE ')).length;
        if (blocks > 1) {
          throw new Error('Qwen reached its output limit. The extracted rows are retained; this summary is incomplete.');
        }
        return { documentKind: 'form', summary: 'Section read', patterns: [], records: [{ row: text }], fields: { kind: 'form' }, math: [], images: [] };
      },
    },
  });
  const result = await analyzeRowPages([{ page: 1, rows: ['alpha', 'beta', 'gamma', 'delta'] }]);
  assert.equal(result.status, 'ready');
  assert.equal(result.error, null);
  assert.equal(result.cursor.next, result.cursor.total);
  assert.deepEqual(result.pattern.records, []);
  assert.ok(calls.length > 1);
});

test('a long document pauses with a cursor instead of failing the rest', async () => {
  const { analyzeRowPages } = load('./analyze.ts', {
    './llm': {
      llmModelName: () => 'test', assertLlmAvailable: async () => {}, LlmUnavailableError: class extends Error {},
      completeJson: async () => ({ documentKind: 'article', summary: 'Part', patterns: [], records: [], fields: {}, math: [], images: [] }),
    },
  });
  const pages = [{ page: 1, rows: Array.from({ length: 400 }, (_, index) => `line ${index} ${'x'.repeat(40)}`) }];
  const first = await analyzeRowPages(pages, undefined, { budgetMs: 0 });
  assert.equal(first.status, 'extracting');
  assert.equal(first.cursor.next, 1);
  assert.ok(first.cursor.total > 1);
  assert.equal(first.error, null);
  const second = await analyzeRowPages(pages, undefined, {
    start: first.cursor.next,
    budgetMs: 0,
    prior: first.pattern,
    missed: first.cursor.missed,
  });
  assert.equal(second.cursor.next, 2);
});

test('real PDF.js retains every page at the supported 40-page limit', async () => {
  const { readPdfAsRows } = load('./read-pdf.ts');
  const texts = Array.from({ length: 40 }, (_, n) => `Document page ${n + 1}`);
  const pages = await readPdfAsRows(pdfFixture(texts));
  assert.deepEqual(pages, texts.map((text, n) => ({ page: n + 1, rows: [text] })));
});

test('admission is shared across module reloads and rejects competing documents', () => {
  const first = load('./admission.ts');
  const second = load('./admission.ts');
  const release = first.acquireOcrSlot();
  assert.equal(typeof release, 'function');
  assert.equal(second.acquireOcrSlot(), null);
  release();
  release();
  assert.equal(first.acquireOcrSlot(), null, 'cooldown must also reject immediate restarts');
});

test('Ollama requests enforce context, output, thinking and batch limits', async () => {
  const oldFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, init) => {
    if (String(url).endsWith('/api/tags')) return Response.json({ models: [{ name: 'qwen3:8b' }] });
    requests.push({ url, ...init, body: JSON.parse(init.body) });
    return Response.json({ message: { content: JSON.stringify(emptyPattern()) }, done_reason: 'stop' });
  };
  try {
    const { completeJson, releaseLoadedModel } = load('./llm.ts', {
      '@/lib/env': { getEnv: () => ({ OCR_LLM_PROVIDER: 'ollama', OCR_LLM_BASE_URL: 'http://127.0.0.1:8000', OCR_LLM_MODEL: 'qwen3:8b' }) },
      '@/lib/security': { assertSafeLlmBaseUrl: (url) => url },
    });
    await completeJson('PAGE 1\n0|x=2');
    await releaseLoadedModel();
    assert.equal(requests[1].url, 'http://127.0.0.1:8000/api/generate');
    assert.equal(requests[1].body.keep_alive, 0);
    assert.equal(requests[0].url, 'http://127.0.0.1:8000/api/chat');
    assert.equal(requests[0].body.keep_alive, '30s');
    assert.equal(requests[0].body.options.num_ctx, 8192);
    assert.equal(requests[0].body.options.num_predict, 1800);
    assert.equal(requests[0].body.options.num_batch, 128);
    assert.equal(requests[0].body.think, false);
    assert.equal(requests[0].redirect, 'error');
    await assert.rejects(completeJson('x'.repeat(6001)), /safe context budget/);
    await assert.rejects(completeJson('cancelled', AbortSignal.abort()), /abort/i);
    assert.equal(requests.length, 2, 'oversized or cancelled work must never reach the GPU');
  } finally { global.fetch = oldFetch; }
});

test('generated sample PDFs retain every body line and fit model input budgets', async () => {
  const { readPdfAsRows } = load('./read-pdf.ts');
  const { OCR_PATTERN_SYSTEM_PROMPT } = load('./pattern.ts');
  for (const name of ['sorye-ocr-qwen-test', 'sorye-ocr-qwen-12-pages']) {
    const base = path.resolve(__dirname, '../../../../test-documents', name);
    const expected = JSON.parse(fs.readFileSync(`${base}.expected.json`, 'utf8'));
    const pages = await readPdfAsRows(new Uint8Array(fs.readFileSync(`${base}.pdf`)));
    assert.equal(pages.length, expected.pages.length);
    for (let p = 0; p < pages.length; p += 1) {
      const text = pages[p].rows.join('\n').replaceAll('[MATH]', '').replaceAll('[/MATH]', '').replaceAll('_', ' ').replace(/\s+/g, ' ');
      for (const line of expected.pages[p].lines.filter(Boolean)) {
        assert.ok(text.includes(line.replace(/\s+/g, ' ')), `Missing page ${p + 1}: ${line}`);
      }
    }
    const chunks = chunkRowPages(pages);
    assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk) + Buffer.byteLength(OCR_PATTERN_SYSTEM_PROMPT) <= 6000));
    if (name.endsWith('12-pages')) assert.ok(chunks.length > 1);
  }
});

test('GPU headroom guard rejects low memory, overheating and missing telemetry', () => {
  const { checkGpuSample } = load('./gpu-guard.ts');
  assert.doesNotThrow(() => checkGpuSample('4096, 12227, 55'));
  assert.throws(() => checkGpuSample('1024, 12227, 55'), /pressure/);
  assert.throws(() => checkGpuSample('4096, 12227, 85'), /pressure/);
  assert.throws(() => checkGpuSample('N/A, 12227, N/A'), /verified/);
  assert.throws(() => checkGpuSample('4096, 12227'), /verified/);
});

test('GPU pressure during a document stops before the next model call and keeps rows', async () => {
  let gpuChecks = 0;
  let modelCalls = 0;
  class CapacityError extends Error {}
  const { analyzeRowPages } = load('./analyze.ts', {
    './gpu-guard': {
      GpuCapacityError: CapacityError,
      assertGpuHeadroom: async () => {
        gpuChecks += 1;
        if (gpuChecks === 3) throw new CapacityError('GPU is under memory pressure.');
      },
    },
    './llm': {
      llmModelName: () => 'test',
      assertLlmAvailable: async () => {},
      LlmUnavailableError: class extends Error {},
      completeJson: async () => { modelCalls += 1; return {}; },
    },
  });
  const pages = [{ page: 1, rows: Array.from({ length: 12 }, (_, index) => `${index}|${'x'.repeat(800)}`) }];
  const result = await analyzeRowPages(pages);
  assert.equal(modelCalls, 1, 'the second model slice must not start after headroom is lost');
  assert.equal(result.status, 'rows_only');
  assert.match(result.error, /memory pressure/);
  assert.equal(result.cursor.next, 1);
  assert.ok(result.pattern.matrixRows.length > 0 || result.pattern.records.length === 0);
});

test('model output truncation is reported as incomplete rather than accepted JSON', async () => {
  const oldFetch = global.fetch;
  global.fetch = async (url) => String(url).endsWith('/api/tags')
    ? Response.json({ models: [{ name: 'qwen3:8b' }] })
    : Response.json({ message: { content: '{}' }, done_reason: 'length' });
  try {
    const { completeJson } = load('./llm.ts', {
      '@/lib/env': { getEnv: () => ({ OCR_LLM_PROVIDER: 'ollama', OCR_LLM_BASE_URL: 'http://127.0.0.1:8000', OCR_LLM_MODEL: 'qwen3:8b' }) },
      '@/lib/security': { assertSafeLlmBaseUrl: (url) => url },
    });
    await assert.rejects(completeJson('PAGE 1\n0|test'), /output limit/);
  } finally { global.fetch = oldFetch; }
});
