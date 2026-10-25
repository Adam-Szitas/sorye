// Real Hub -> Qwen -> storage smoke test using synthetic PDF data only.
// Run after the model is installed and Hub is listening on 127.0.0.1:3000.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.data/ocr-local');
fs.mkdirSync(output, { recursive: true });
const name = process.argv.includes('--large') ? 'sorye-ocr-qwen-12-pages' : 'sorye-ocr-qwen-test';

function upload() {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(path.join(root, 'test-documents', `${name}.pdf`))], { type: 'application/pdf' }), `${name}.pdf`);
  return fetch('http://127.0.0.1:3000/api/ocr/analyze', { method: 'POST', body: form, signal: AbortSignal.timeout(270_000) });
}

(async () => {
  const telemetry = [];
  const timer = setInterval(() => {
    try {
      telemetry.push(execFileSync('nvidia-smi', ['--query-gpu=memory.used,memory.total,utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 3000, windowsHide: true }).trim());
    } catch { /* GPU telemetry is optional; inference assertions are not. */ }
  }, 2000);
  try {
    const started = Date.now();
    const first = upload();
    // A competing upload must be rejected, not queued for GPU execution.
    await new Promise((resolve) => setTimeout(resolve, 750));
    const second = upload();
    const responses = await Promise.all([first, second]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 429]);
    const busy = responses.find((r) => r.status === 429);
    assert.equal(busy.headers.get('retry-after'), '3');
    const success = responses.find((r) => r.status === 200);
    const { analysis } = await success.json();
    fs.writeFileSync(path.join(output, `${name}.analysis.json`), JSON.stringify(analysis, null, 2));
    assert.equal(analysis.status, 'ready', analysis.error || 'Model did not finish');
    const expected = JSON.parse(fs.readFileSync(path.join(root, 'test-documents', `${name}.expected.json`), 'utf8'));
    assert.equal(analysis.pages.length, expected.pages.length);
    for (let p = 0; p < analysis.pages.length; p += 1) {
      const text = analysis.pages[p].rows.join(' ').replaceAll('[MATH]', '').replaceAll('[/MATH]', '').replaceAll('_', ' ').replace(/\s+/g, ' ');
      for (const line of expected.pages[p].lines.filter(Boolean)) assert.ok(text.includes(line.replace(/\s+/g, ' ')), `Missing page ${p + 1}: ${line}`);
    }
    assert.ok(analysis.pattern.math.length >= (name.endsWith('12-pages') ? 12 : 7));
    assert.ok(analysis.pattern.summary.length > 0);
    const stored = await fetch(`http://127.0.0.1:3000/api/ocr/analyses/${encodeURIComponent(analysis.id)}`);
    assert.equal(stored.status, 200);
    assert.equal(stored.headers.get('cache-control'), 'private, no-store');
    const retrieved = await stored.json();
    assert.deepEqual(retrieved.analysis.pages, analysis.pages);
    assert.deepEqual(retrieved.analysis.pattern, analysis.pattern);
    const report = {
      file: `${name}.pdf`, elapsedSeconds: (Date.now() - started) / 1000,
      status: analysis.status, pages: analysis.pages.length,
      rows: analysis.pages.reduce((sum, page) => sum + page.rows.length, 0),
      math: analysis.pattern.math.length, summary: analysis.pattern.summary,
      competingUploadStatus: busy.status, storedReadBackMatches: true,
      gpuSamples: telemetry,
    };
    fs.writeFileSync(path.join(output, `${name}.report.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { clearInterval(timer); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
