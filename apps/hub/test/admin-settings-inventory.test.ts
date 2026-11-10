import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { APP_CATALOG, RETIRED_APP_IDS } from '@sorye/types';
import { SETTINGS_INVENTORY, renderSettingsMatrix } from '../lib/admin/settings-inventory';

const root = resolve(process.cwd(), '../..');

test('every catalog app and every retired app has an inventory area', () => {
  const ids = new Set(SETTINGS_INVENTORY.map((area) => area.id));
  assert.equal(ids.size, SETTINGS_INVENTORY.length, 'duplicate area id');
  for (const app of APP_CATALOG) assert.ok(ids.has(app.id), `missing inventory for ${app.id}`);
  for (const id of RETIRED_APP_IDS) assert.equal(SETTINGS_INVENTORY.find((area) => area.id === id)?.kind, 'retired');
  for (const area of SETTINGS_INVENTORY.filter((entry) => entry.kind === 'app')) {
    assert.ok(APP_CATALOG.some((app) => app.id === area.id), `${area.id} is not in the catalog`);
  }
});

test('inventory sources exist and console links point at real sections', () => {
  const sections = ['/admin', '/admin/workspaces', '/admin/applications', '/admin/ai', '/admin/integrations', '/admin/releases', '/admin/history'];
  for (const area of SETTINGS_INVENTORY) {
    assert.ok(area.settings.length > 0, `${area.id} has no settings`);
    for (const setting of area.settings) {
      assert.ok(existsSync(resolve(root, setting.source)), `${area.id}/${setting.key}: ${setting.source}`);
      if (setting.consoleHref) assert.ok(sections.includes(setting.consoleHref), setting.consoleHref);
      if (setting.status === 'console') assert.ok(setting.consoleHref, `${setting.key} is console-editable without a section`);
    }
  }
});

test('docs/admin/SETTINGS-MATRIX.md is the generated inventory', async () => {
  const matrix = (await readFile(resolve(root, 'docs/admin/SETTINGS-MATRIX.md'), 'utf8')).replace(/\r\n/g, '\n');
  assert.equal(matrix, renderSettingsMatrix(), 'run pnpm --filter @sorye/hub docs:settings-matrix');
});
