import assert from 'node:assert/strict';
import { preferredLocale } from '../lib/preferred-locale';
for (const [header, expected] of [
 ['sk-SK, en;q=0.8', 'sk'], ['de-AT,de;q=0.9', 'de'],
 ['hu-HU', 'hu'], ['es-MX', 'es'], ['esp', 'es'],
 ['fr-FR,es;q=0.8,en;q=0.5', 'es'], ['de;q=0,hu;q=0.5','hu'],
 ['de;q=0.3,sk;q=0.9','sk'], ['de;q=oops,es;q=0.8','es'],
 ['fr', 'en'], ['', 'en'], [null, 'en'],
] as const) assert.equal(preferredLocale(header), expected);
console.log('12 locale negotiation cases passed');
