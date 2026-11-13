import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { COMPONENTS, componentDefaults } from '../src/registry';
import { isSafeLink, validateProps } from '../src/schema';
import { contrastRatio, resolveTheme, THEME_PRESET_IDS, themeContrastIssues, validateTheme } from '../src/theme';
import { validateCollection, validateItem, validatePage, validateSection, validateSettings } from '../src/validate';
import { negotiateLocale, normalizeLocale, textFor, missingLocales } from '../src/locales';
import { siteComponentContractJson } from '../src/contract';
import { ITEMS, NEWS, page, settings } from './fixtures';

test('every component has a version, a schema and defaults that validate', () => {
  assert.equal(COMPONENTS.length, 18);
  for (const c of COMPONENTS) {
    const issues = validateSection({ id: 's1', type: c.type, version: c.version, props: componentDefaults(c.type) });
    // Required media fields (image+text, gallery items) are allowed to start empty only where the defaults are lists.
    const allowed = issues.filter((i) => !(c.type === 'imageText' && i.path === 'section.props.image') && !(c.type === 'collectionList' && i.path === 'section.props.collection') && !(c.type === 'collectionItem' && i.path === 'section.props.collection'));
    assert.deepEqual(allowed, [], `${c.type}: ${JSON.stringify(allowed)}`);
  }
});

test('unknown types, versions, unknown and missing props fail', () => {
  assert.equal(validateSection({ id: 's', type: 'iframe', version: 1, props: {} })[0]?.code, 'unknown_component');
  assert.ok(validateSection({ id: 's', type: 'hero', version: 2, props: componentDefaults('hero') }).some((i) => i.code === 'unsupported_version'));
  assert.ok(validateSection({ id: 's', type: 'hero', version: 1, props: { ...componentDefaults('hero'), html: '<b>' } }).some((i) => i.code === 'unknown_prop'));
  const { heading: _h, ...missing } = componentDefaults('hero');
  assert.ok(validateSection({ id: 's', type: 'hero', version: 1, props: missing }).some((i) => i.code === 'missing_prop'));
  assert.ok(validateSection({ id: 'bad id', type: 'hero', version: 1, props: componentDefaults('hero') }).some((i) => i.code === 'invalid_id'));
});

test('text values are localized, bounded in code points and reject control characters', () => {
  const spec = { t: { kind: 'text' as const, label: '', max: 3, required: true } };
  const run = (v: unknown) => { const issues: { path: string; code: string }[] = []; validateProps(spec, { t: v }, '', issues); return issues.map((i) => i.code); };
  assert.deepEqual(run({ en: '😀😀😀' }), []);
  assert.deepEqual(run({ en: 'abcd' }), ['too_long']);
  assert.deepEqual(run({ fr: 'x' }), ['unknown_locale', 'required']);
  assert.deepEqual(run({ en: 'a\u0000' }), ['control_character']);
  assert.deepEqual(run({ en: 'a\nb' }), ['newline_not_allowed']);
  assert.deepEqual(run('plain'), ['expected_localized_text']);
  assert.deepEqual(run({ en: '  ' }), ['required']);
});

test('links allow https, mailto, site paths and anchors only', () => {
  for (const ok of ['https://example.com', 'https://example.com/a?b=c#d', 'mailto:hi@example.com', '/about', '/news/launch#top', '#contact']) assert.ok(isSafeLink(ok), ok);
  for (const bad of ['javascript:alert(1)', 'http://example.com', '//evil.com', 'data:text/html,x', 'https://user@evil.com', 'https://', 'mailto:x', '/About', 'https://exa mple.com', 'vbscript:x', 'https://localhost']) assert.ok(!isSafeLink(bad), bad);
});

test('images require alt text', () => {
  const props = { ...componentDefaults('imageText'), image: { id: 'm1', alt: {} } };
  assert.ok(validateSection({ id: 's', type: 'imageText', version: 1, props }).some((i) => i.path.endsWith('image.alt') && i.code === 'required'));
  props.image = { id: 'm1', alt: { en: 'Our workshop' } };
  assert.deepEqual(validateSection({ id: 's', type: 'imageText', version: 1, props }), []);
});

test('form fields validate kinds, unique ids and options', () => {
  const base = componentDefaults('contactForm');
  const withFields = (fields: unknown) => validateSection({ id: 'f', type: 'contactForm', version: 1, props: { ...base, fields } }).map((i) => i.code);
  assert.deepEqual(withFields(base.fields), []);
  assert.ok(withFields([{ id: 'a', kind: 'text', label: { en: 'A' }, help: {}, required: true, options: [] }, { id: 'a', kind: 'text', label: { en: 'B' }, help: {}, required: false, options: [] }]).includes('duplicate_id'));
  assert.ok(withFields([{ id: 'a', kind: 'select', label: { en: 'A' }, help: {}, required: true, options: [] }]).includes('required'));
  assert.ok(withFields([{ id: 'a', kind: 'file', label: { en: 'A' }, help: {}, required: true, options: [] }]).includes('invalid_option'));
  assert.ok(withFields([{ id: 'a', kind: 'text', label: { en: 'A' }, help: {}, required: true, options: [{ value: 'x', label: {} }] }]).includes('options_not_allowed'));
});

test('pages, settings, collections and items validate as whole documents', () => {
  assert.deepEqual(validatePage(page([{ id: 'hero', type: 'hero', version: 1, props: componentDefaults('hero') }])), []);
  assert.ok(validatePage({ ...page([]), slug: 'sitemap' }).some((i) => i.code === 'invalid_slug'));
  const many = Array.from({ length: 41 }, (_, i) => ({ id: `s${i}`, type: 'richText', version: 1, props: componentDefaults('richText') }));
  assert.ok(validatePage(page(many)).some((i) => i.code === 'too_many'));
  assert.deepEqual(validateSettings(settings()), []);
  assert.ok(validateSettings(settings({ defaultLocale: 'sk' })).some((i) => i.code === 'default_locale_not_enabled'));
  assert.deepEqual(validateCollection(NEWS), []);
  assert.ok(validateCollection({ ...NEWS, titleField: 'date' }).some((i) => i.code === 'title_must_be_text_field'));
  for (const item of ITEMS) assert.deepEqual(validateItem(item, NEWS), []);
  assert.ok(validateItem({ ...ITEMS[0], values: { ...ITEMS[0]!.values, date: '2026-13-01x' } }, NEWS).some((i) => i.code === 'invalid_date'));
  assert.ok(validateItem({ ...ITEMS[0], values: { ...ITEMS[0]!.values, extra: 1 } }, NEWS).some((i) => i.code === 'unknown_prop'));
});

test('every theme preset meets WCAG AA; failing overrides are rejected', () => {
  for (const id of THEME_PRESET_IDS) assert.deepEqual(themeContrastIssues(resolveTheme({ preset: id, overrides: {} })), [], id);
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
  assert.deepEqual(validateTheme({ preset: 'paper', overrides: { colors: { text: '#dddddd' } } }), ['contrast:text/background', 'contrast:text/surface']);
  assert.deepEqual(validateTheme({ preset: 'paper', overrides: { colors: { text: 'red' } } }), ['invalid_color:text']);
  assert.deepEqual(validateTheme({ preset: 'paper', overrides: { font: 'comic' } }), ['invalid_font']);
  assert.deepEqual(validateTheme({ preset: 'paper', overrides: { css: 'x' } }), ['unknown_override:css']);
});

test('locale negotiation honours quality weights, regions and the esp alias', () => {
  assert.equal(negotiateLocale('de-AT,de;q=0.9,en;q=0.8', ['en', 'de'], 'en'), 'de');
  assert.equal(negotiateLocale('fr;q=1, sk;q=0.5', ['en', 'sk'], 'en'), 'sk');
  assert.equal(negotiateLocale('es;q=0, en;q=0.1', ['es', 'en'], 'es'), 'en');
  assert.equal(negotiateLocale(undefined, ['en'], 'en'), 'en');
  assert.equal(normalizeLocale('esp'), 'es');
  assert.equal(textFor({ en: 'Hi' }, 'de', 'en'), 'Hi');
  assert.deepEqual(missingLocales({ en: 'Hi' }, ['en', 'de', 'sk']), ['de', 'sk']);
});

test('the reviewed contract snapshot matches the SDK (and Rodrigo when checked out next to Sorye)', () => {
  const generated = siteComponentContractJson();
  const snapshot = resolve(import.meta.dirname, '../../types/contracts/site-components.json');
  // Git may check the snapshots out with CRLF line endings; compare content only.
  const lf = (text: string) => text.replace(/\r\n/g, '\n');
  assert.equal(lf(readFileSync(snapshot, 'utf8')), generated, 'run pnpm --filter @sorye/site-sdk contract:export');
  const rodrigo = process.env.RODRIGO_CONTRACTS_DIR ? resolve(process.env.RODRIGO_CONTRACTS_DIR, 'site-components.json') : '';
  if (rodrigo && existsSync(rodrigo)) assert.equal(lf(readFileSync(rodrigo, 'utf8')), generated, 'Rodrigo contract snapshot differs');
});

test('media records, publish requests and image sizes', async () => {
  const { validateMedia, validatePublish, mediaRefs, imageSize } = await import('../src/library');
  const media = { id: 'm1', objectId: '0b0e2f6c-6a1e-4c55-8c1e-2f1a4b7c9d10', name: 'team.jpg', contentType: 'image/jpeg', sizeBytes: 1000, width: 1200, height: 800, alt: { en: 'Team' }, updatedAt: '2026-11-13T10:00:00Z' };
  assert.deepEqual(validateMedia(media), []);
  assert.ok(validateMedia({ ...media, contentType: 'image/svg+xml' }).some((i) => i.code === 'unsupported_type'));
  assert.ok(validateMedia({ ...media, sizeBytes: 10 * 1024 * 1024 + 1 }).some((i) => i.code === 'too_large'));
  assert.ok(validateMedia({ ...media, contentType: 'application/pdf' }).some((i) => i.code === 'invalid_dimension'));
  assert.deepEqual(validateMedia({ ...media, contentType: 'application/pdf', width: 0, height: 0 }), []);
  assert.deepEqual(validatePublish({ id: 'r1', note: '', restoreOf: null, createdAt: '2026-11-13T10:00:00Z' }), []);
  assert.deepEqual(mediaRefs({ sections: [{ props: { image: { id: 'm1', alt: {} }, items: [{ photo: { id: 'm2', alt: { en: 'x' } } }], heading: { en: 'id' } } }], logo: null }), ['m1', 'm2']);
  const png = new Uint8Array(24); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 0xb0, 0, 0, 3, 0x20]);
  assert.deepEqual(imageSize(png), { width: 1200, height: 800 });
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00, 0x20, 0x00]);
  assert.deepEqual(imageSize(gif), { width: 16, height: 32 });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0x01]);
  assert.deepEqual(imageSize(jpeg), { width: 800, height: 600 });
  assert.equal(imageSize(new Uint8Array([1, 2, 3])), null);
});
