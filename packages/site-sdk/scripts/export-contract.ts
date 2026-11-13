import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { siteComponentContractJson } from '../src/contract';

const targets = [resolve(import.meta.dirname, '../../types/contracts/site-components.json'), ...process.argv.slice(2)];
for (const target of targets) {
  writeFileSync(target, siteComponentContractJson());
  console.log(`wrote ${target}`);
}
