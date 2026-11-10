import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderSettingsMatrix } from '../admin/settings-inventory';

const target = path.resolve(process.cwd(), '../../docs/admin/SETTINGS-MATRIX.md');
writeFileSync(target, renderSettingsMatrix());
console.log(`Wrote ${path.relative(process.cwd(), target)}`);
