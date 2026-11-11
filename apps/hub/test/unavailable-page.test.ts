import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { unavailablePageHtml } from '../lib/unavailable-page';

test('503 page follows the browser language and falls back to English', () => {
  assert.match(unavailablePageHtml('de-DE,de;q=0.9', '/'), /<html lang="de">[\s\S]*vorübergehend nicht verfügbar/);
  assert.match(unavailablePageHtml('sk', '/'), /dočasne nedostupný/);
  assert.match(unavailablePageHtml('fr-FR', '/'), /<html lang="en">[\s\S]*temporarily unavailable/);
  assert.match(unavailablePageHtml(null, '/'), /<html lang="en">/);
});

test('503 page retries the same path and never echoes unsafe input', () => {
  assert.match(unavailablePageHtml('en', '/apps/tasks'), /href="\/apps\/tasks"/);
  // Protocol-relative and non-path values fall back to the Hub root.
  assert.match(unavailablePageHtml('en', '//evil.example/x'), /class="btn" href="\/"/);
  assert.match(unavailablePageHtml('en', 'https://evil.example'), /class="btn" href="\/"/);
  const injected = unavailablePageHtml('en', '/a"><script>alert(1)</script>');
  assert.ok(!injected.includes('<script>'), 'markup in the path is escaped');
  assert.ok(!/<script/i.test(unavailablePageHtml('en', '/')), 'the page carries no script at all');
});

test('503 page is self-contained', () => {
  const html = unavailablePageHtml('en', '/');
  assert.ok(!/(src|href)="https?:/.test(html), 'no external assets');
  assert.match(html, /http-equiv="refresh" content="30"/);
  assert.match(html, /name="robots" content="noindex"/);
  // Optional: write the rendered pages for a visual check.
  const dir = process.env.SORYE_STATUS_PREVIEW_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '503-en.html'), unavailablePageHtml('en', '/apps/tasks'));
    writeFileSync(path.join(dir, '503-de.html'), unavailablePageHtml('de', '/'));
  }
});
