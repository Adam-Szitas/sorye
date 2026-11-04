import assert from 'node:assert/strict';
import { readProtocolioTemplate } from '../lib/protocolio-input';
async function main() {
  assert.deepEqual(await readProtocolioTemplate(new Request('http://localhost', {method:'POST',body:'{"blocks":[]}'})), {blocks:[]});
  await assert.rejects(readProtocolioTemplate(new Request('http://localhost', {method:'POST',body:'invalid'})));
  await assert.rejects(readProtocolioTemplate(new Request('http://localhost', {method:'POST',body:'x'.repeat(2_000_001)})), /2 MB/);
  console.log('Protocolio bounded-input checks passed');
}
void main();
