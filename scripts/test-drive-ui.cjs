// Hub dev server on :3000; authenticated API responses mocked.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    let rows = [
      { id: 'pdf', sourceAppId: 'ocr', displayName: 'invoice.pdf', mime: 'application/pdf' },
      { id: 'note', sourceAppId: 'files', displayName: 'note.txt', mime: 'text/plain' },
    ].map((row) => ({ ...row, workspaceId: 'test', relativePath: `test/${row.id}`, size: 123, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    let opened = false;
    await page.route('**/api/**', async (route) => {
      const request = route.request(); const url = new URL(request.url());
      let data = {};
      if (url.pathname === '/api/workspace') data = { user: { id: 'test' }, workspace: { id: 'test', selectedAppIds: ['ocr', 'files'] } };
      if (url.pathname === '/api/files') data = { files: rows, maxBytes: 67108864, maxFiles: 200 };
      if (url.pathname === '/api/files/pdf' && request.method() === 'PATCH') {
        rows[0].displayName = request.postDataJSON().displayName; data = { file: rows[0] };
      }
      if (url.pathname === '/api/files/note' && request.method() === 'DELETE') rows = rows.filter((row) => row.id !== 'note');
      if (url.pathname === '/api/files/pdf/open') {
        assert.equal(request.postDataJSON().targetAppId, 'ocr'); opened = true;
        data = { href: '/apps/ocr?handoff=test-delivery' };
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.route('**/apps/ocr?handoff=*', (route) => route.fulfill({ contentType: 'text/html', body: '<p>OCR destination</p>' }));
    await page.goto('http://localhost:3000/apps/files');
    await page.getByRole('navigation', { name: 'App folders' }).getByRole('button', { name: 'OCR', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'note.txt', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Rename invoice.pdf', exact: true }).click();
    await page.getByLabel('Display name', { exact: true }).fill('renamed.pdf');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Open renamed.pdf in OCR', exact: true }).waitFor();
    await page.getByRole('button', { name: 'All files', exact: true }).click();
    await page.getByRole('button', { name: 'Delete note.txt', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'note.txt', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Open renamed.pdf in OCR', exact: true }).click();
    await page.waitForURL('**/apps/ocr?handoff=test-delivery');
    assert.equal(opened, true); assert.deepEqual(errors, []);
    console.log('PASS: Drive app folders, rename, delete, compatible app icon and Relay redirect');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
