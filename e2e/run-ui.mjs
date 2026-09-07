import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.PLAYWRIGHT_UI_HOST ?? '127.0.0.1';
const port = process.env.PLAYWRIGHT_UI_PORT ?? '9323';
const url = `http://${host}:${port}`;
const uiConfig = 'playwright.ui.config.ts';
const cli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const noOpenHook = path.join(root, 'e2e', 'pw-ui-no-open.cjs');

const extra = process.argv.slice(2).filter((arg, i, arr) => {
  if (arg === '--project' || arg.startsWith('--project=')) return false;
  if (i > 0 && arr[i - 1] === '--project') return false;
  return true;
});

console.log('');
console.log('Playwright UI (single client — Cursor must not own this tab)');
console.log(`  ${url}`);
console.log('');
console.log('1. Close any Cursor Simple Browser / IDE Chromium tab on 9323.');
console.log('2. Open that URL in system Chrome or Edge (not Cursor).');
console.log('3. Press Run there. Tests open Playwright-owned Chromium, not Cursor.');
console.log('');
console.log('If Run is greyed / tests already ran in Cursor:');
console.log('  close the Cursor tab on 9323 → Ctrl+C this command → pnpm test:e2e:ui');
console.log('  then open the URL in Chrome again.');
console.log('');
console.log('No UI server (watch a Chromium window only):  pnpm test:e2e:headed');
console.log('');
console.log('Local apps (defaults — not Vercel):');
console.log('  Hub   hub.spec.ts   http://localhost:3000     pnpm dev');
console.log('  SUSM  susm.spec.ts  http://localhost:4201     start SUSM on :4201');
console.log('  ESPM  espm.spec.ts  http://localhost:4200     cd D:\\MyESPM\\ESPM && npm start');
console.log('');
console.log('In Playwright UI:');
console.log('  1. Left tree must list hub.spec.ts, susm.spec.ts, and espm.spec.ts.');
console.log('  2. If you only see Hub: open Filters (chevron by the search box),');
console.log('     check hub / susm / espm (or “hub · susm · espm”), clear the search box.');
console.log('  3. Click the green Play on the Tests toolbar (Run all — F5),');
console.log('     not the play button on a single file.');
console.log('');

const listed = spawnSync(
  process.execPath,
  [cli, 'test', '--list', '-c', uiConfig],
  { cwd: root, encoding: 'utf8', env: process.env, windowsHide: true },
);

if (listed.stdout) process.stdout.write(listed.stdout);
if (listed.stderr) process.stderr.write(listed.stderr);
if (listed.status) {
  console.error('Could not list tests. Is @playwright/test installed? Are URLs localhost (or ALLOW_LIVE_E2E=true)?');
  process.exit(listed.status);
}

const child = spawn(
  process.execPath,
  [
    '-r',
    noOpenHook,
    cli,
    'test',
    '--ui',
    `--ui-host=${host}`,
    `--ui-port=${port}`,
    '-c',
    uiConfig,
    ...extra,
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PW_TEST_UI_NO_OPEN: '1' },
    windowsHide: false,
  },
);

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
