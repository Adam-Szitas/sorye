// OCR dev server on :3011; Hub transport mocked to exercise cold-start delivery.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let uploads = 0;
    let consumed = 0;
    let deleted = false;
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/files' && request.method() === 'POST') uploads++;
      if (url.pathname === '/api/handoffs' && request.method() === 'PATCH') consumed++;
      if (url.pathname === '/api/files/test-pdf') {
        return route.fulfill(deleted ? { status: 404, body: 'Not found' } : {
          status: 200, contentType: 'application/pdf',
          headers: { 'Content-Disposition': "attachment; filename*=UTF-8''renamed.pdf" },
          body: fs.readFileSync('test-documents/sorye-ocr-qwen-test.pdf'),
        });
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(
        url.pathname === '/api/handoffs' ? { handoff: { id: 'handoff-test', targetAppId: 'ocr', kind: 'workspace-file', title: 'old.pdf', payload: { fileId: 'test-pdf' } } } : { hits: [] }
      ) });
    });
    await page.goto('http://localhost:3011/?handoff=handoff-test');
    await page.getByRole('button', { name: 'Analyze with Qwen', exact: true }).waitFor({ timeout: 60000 });
    assert.equal(await page.getByRole('heading', { name: 'renamed.pdf', exact: true }).count(), 1);
    await page.waitForFunction(() => document.querySelector('.ocr-table-panel')?.textContent.includes('Layout matrix'));
    assert.equal(uploads, 0, 'opening a Drive file must not upload a duplicate');
    await page.waitForTimeout(200);
    assert.equal(consumed, 1);
    deleted = true;
    await page.reload();
    await page.getByText('This file is no longer available in Drive', { exact: true }).waitFor();
    assert.equal(uploads, 0);
    assert.deepEqual(errors, []);
    console.log('PASS: cold-start handoff, renamed original PDF, no duplicate upload, consumed delivery, deleted-file error');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
