// Full browser -> OCR -> Hub -> local Qwen test. Suppress workspace events
// during this synthetic test so configured Relay rules cannot forward them.
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.data/ocr-local');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.route('**/api/events', (route) => route.request().method() === 'POST'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      : route.continue());
    await page.goto('http://localhost:3000/apps/ocr');
    await page.locator('input[type=file]').setInputFiles(path.join(root, 'test-documents/sorye-ocr-qwen-test.pdf'));
    const analyze = page.getByRole('button', { name: 'Analyze with Qwen', exact: true });
    await analyze.waitFor({ timeout: 60_000 });
    assert.equal(await page.getByText(/all pages read/).count(), 1);
    const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/ocr/analyze') && response.request().method() === 'POST', { timeout: 270_000 });
    await analyze.click();
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    const { analysis } = await response.json();
    assert.equal(analysis.status, 'ready', analysis.error);
    assert.equal(analysis.pages.length, 3);
    const panel = page.getByRole('region', { name: 'Qwen pattern' });
    await panel.waitFor();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'ocr-qwen-result.png') });
    console.log(JSON.stringify({ status: analysis.status, pages: analysis.pages.length, math: analysis.pattern.math.length, summary: analysis.pattern.summary, screenshot: '.data/ocr-local/ocr-qwen-result.png' }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
