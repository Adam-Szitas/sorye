'use strict';

/**
 * Playwright UI (`--ui-host` / `--ui-port`) calls `open(url)`, which on Windows
 * becomes the default browser — often Cursor Simple Browser / IDE Chromium.
 * Playwright UI is a single WebSocket client, so that tab steals Run.
 *
 * Loaded via `node -r e2e/pw-ui-no-open.cjs` from `pnpm test:e2e:ui`.
 * Stubs Playwright's bundled `open` unless `PW_TEST_UI_NO_OPEN=0`.
 */
const Module = require('module');

const flag = process.env.PW_TEST_UI_NO_OPEN;
const stub =
  flag !== '0' && flag !== 'false' && flag !== 'no';

function stubOpen(exported) {
  if (!exported || typeof exported !== 'object') return exported;
  if (typeof exported.open !== 'function') return exported;
  exported.open = async function noOpen(url) {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      console.log('');
      console.log('Playwright UI is ready. Do not open Cursor Simple Browser / IDE Chromium.');
      console.log(`In system Chrome or Edge:\n  ${url}`);
      console.log('');
    }
  };
  return exported;
}

if (stub) {
  const origLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    const exported = origLoad.apply(this, arguments);
    const id = String(request).replace(/\\/g, '/');
    if (id === 'open' || id === './utilsBundle' || /\/utilsBundle(?:\.js)?$/.test(id)) {
      return stubOpen(exported);
    }
    return exported;
  };
}
