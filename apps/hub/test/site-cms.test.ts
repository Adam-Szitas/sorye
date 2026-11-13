import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { componentDefaults, DEFAULT_CONTACT_FIELDS, imageSize, type CmsPage, type SiteCollection, type SiteSettings } from '@sorye/site-sdk';
import { harnessConfigured, startRodrigo, type Harness } from './helpers/rodrigo-harness';

process.env.AUTH_SECRET ??= 'test-only-auth-secret-0123456789';

/**
 * Site CMS against the real Rodrigo binary, PostgreSQL and S3 (opt in, see
 * helpers/rodrigo-harness.ts): Hub validation, Rodrigo storage rules, atomic publish
 * and restore, public reads, media, submissions and the public renderer routes.
 */
const now = () => new Date().toISOString();
const run = randomUUID().slice(0, 8);
const wsA = `site-ws-a-${run}`;
const wsB = `site-ws-b-${run}`;
const ctxA = { userId: 'site-owner-a', workspaceId: wsA };
const ctxB = { userId: 'site-owner-b', workspaceId: wsB };
const slug = `acme-${run}`;

// 2x1 PNG
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000020000000108020000007b40e8dd0000000c4944415478da63f8cfc0f01f0005fe02fe0d4c5b8e0000000049454e44ae426082', 'hex');

type Action = { appId: 'site'; resourceType: string; operation: 'create' | 'update' | 'delete'; resourceId: string; payload: Record<string, unknown>; expectedRevision?: number };

describe('Site CMS against real Rodrigo', { skip: !harnessConfigured, concurrency: false }, () => {
  let rodrigo: Harness;
  const revisions = new Map<string, number>();
  let client: typeof import('../lib/rodrigo/service-client');
  let site: typeof import('../lib/site-cms/public-client');

  async function commit(ctx: { userId: string; workspaceId: string }, action: Action) {
    const key = `${ctx.workspaceId}:${action.resourceType}:${action.resourceId}`;
    const expected = revisions.get(key);
    const op = action.operation === 'create' && expected ? 'update' : action.operation;
    const result = await client.submitRodrigoActionBatch(ctx, { actions: [{
      actionId: randomUUID(), payloadVersion: 1, occurredAt: now(), ...action, operation: op,
      ...(op === 'create' ? {} : { expectedRevision: expected ?? action.expectedRevision }),
    } as never] });
    const outcome = result.results[0]!;
    if (outcome.status === 'committed') revisions.set(key, outcome.revision!);
    return outcome;
  }

  /** Bypasses Hub's validation to prove Rodrigo enforces the same rules. */
  async function raw(ctx: { userId: string; workspaceId: string }, action: Action) {
    const { signedFetch, readJson } = await import('../lib/rodrigo/transport');
    const { z } = await import('zod');
    const body = JSON.stringify({ actions: [{ actionId: randomUUID(), payloadVersion: 1, occurredAt: now(), ...action }] });
    const response = await signedFetch({ context: ctx, method: 'POST', path: '/v2/actions/batch', scope: 'actions:write', appScopes: ['site'],
      actionScopes: [`action:site.${action.resourceType}.${action.operation}`], body });
    const result = await readJson(response, z.object({ results: z.array(z.object({ status: z.string(), error: z.object({ code: z.string() }).optional() }).passthrough()) }).passthrough());
    return result.results[0]!;
  }

  const settings = (overrides: Partial<SiteSettings> = {}): SiteSettings => ({
    id: 'site', slug, name: 'Acme', theme: { preset: 'forest', overrides: {} }, logo: null, favicon: null, socialImage: null,
    defaultLocale: 'en', locales: ['en', 'de'], seo: { title: {}, description: { en: 'Acme builds benches.', de: 'Acme baut Bänke.' } }, homePageId: 'home', updatedAt: now(), ...overrides,
  });
  const page = (id: string, pageSlug: string, sections: CmsPage['sections'], nav: CmsPage['nav'] = 'header'): CmsPage => ({
    id, slug: pageSlug, title: { en: id === 'home' ? 'Home' : 'About', de: id === 'home' ? 'Start' : 'Über uns' }, nav, order: id === 'home' ? 0 : 1,
    seo: { title: {}, description: {} }, sections, updatedAt: now(),
  });
  const news: SiteCollection = {
    id: 'news', slug: 'news', name: { en: 'News' }, titleField: 'title', sort: 'dateDesc', sortField: 'date', detailPages: true, updatedAt: now(),
    fields: [
      { key: 'title', label: { en: 'Title' }, kind: 'text', required: true, options: [] },
      { key: 'date', label: { en: 'Date' }, kind: 'date', required: true, options: [] },
      { key: 'body', label: { en: 'Body' }, kind: 'richtext', required: false, options: [] },
    ],
  };
  const objectId = randomUUID();

  before(async () => {
    rodrigo = await startRodrigo();
    client = await import('../lib/rodrigo/service-client');
    site = await import('../lib/site-cms/public-client');
  });
  after(async () => {
    const { stopRodrigoChangeStream } = await import('../lib/rodrigo/changes');
    stopRodrigoChangeStream();
    await rodrigo?.stop();
  });

  test('media entries need a ready site object of the same workspace', async () => {
    const { uploadObject } = await import('../lib/rodrigo/objects-client');
    await uploadObject(ctxA, { objectId, purpose: 'site', contentType: 'image/png', size: PNG.length, sha256: createHash('sha256').update(PNG).digest('hex') },
      (async function* () { yield PNG; })());
    const size = imageSize(PNG)!;
    assert.deepEqual(size, { width: 2, height: 1 });
    const media = { id: 'logo', objectId, name: 'logo.png', contentType: 'image/png', sizeBytes: PNG.length, width: 2, height: 1, alt: { en: 'Acme logo', de: 'Acme-Logo' }, updatedAt: now() };
    // Another workspace cannot claim A's object.
    const stolen = await commit(ctxB, { appId: 'site', resourceType: 'media', operation: 'create', resourceId: 'logo', payload: media });
    assert.equal(stolen.status, 'rejected');
    assert.equal(stolen.error?.code, 'media_object_missing');
    const wrongSize = await raw(ctxA, { appId: 'site', resourceType: 'media', operation: 'create', resourceId: 'logo', payload: { ...media, sizeBytes: 99 } });
    assert.equal(wrongSize.error?.code, 'media_object_missing');
    assert.equal((await commit(ctxA, { appId: 'site', resourceType: 'media', operation: 'create', resourceId: 'logo', payload: media })).status, 'committed');
    const moved = await raw(ctxA, { appId: 'site', resourceType: 'media', operation: 'update', resourceId: 'logo', expectedRevision: 1, payload: { ...media, objectId: randomUUID() } });
    assert.equal(moved.error?.code, 'media_object_immutable');
  });

  test('settings claim the slug; another workspace cannot take it', async () => {
    assert.equal((await commit(ctxA, { appId: 'site', resourceType: 'settings', operation: 'create', resourceId: 'site', payload: { ...settings(), logo: { id: 'logo', alt: { en: 'Acme' } } } as never })).status, 'committed');
    const taken = await commit(ctxB, { appId: 'site', resourceType: 'settings', operation: 'create', resourceId: 'site', payload: settings() as never });
    assert.equal(taken.status, 'rejected');
    assert.equal(taken.error?.code, 'slug_unavailable');
    const lowContrast = await raw(ctxB, { appId: 'site', resourceType: 'settings', operation: 'create', resourceId: 'site', payload: { ...settings({ slug: `other-${run}` }), theme: { preset: 'paper', overrides: { colors: { text: '#eeeeee' } } } } });
    assert.equal(lowContrast.error?.code, 'invalid_domain_payload');
  });

  test('pages, collections and items follow the shared rules', async () => {
    const hero = { id: 'hero', type: 'hero', version: 1, props: { ...componentDefaults('hero'), heading: { en: 'Benches that last', de: 'Bänke, die halten' }, image: { id: 'logo', alt: { en: 'Bench' } } } };
    const list = { id: 'news-list', type: 'collectionList', version: 1, props: { ...componentDefaults('collectionList'), heading: { en: 'News' }, collection: 'news', summaryField: 'body', dateField: 'date' } };
    const form = { id: 'contact', type: 'contactForm', version: 1, props: { ...componentDefaults('contactForm'), fields: DEFAULT_CONTACT_FIELDS, notifyChannelId: 'channel-sales', notifyRelay: true } };
    const header = { id: 'header', type: 'header', version: 1, props: componentDefaults('header') };
    const footer = { id: 'footer', type: 'footer', version: 1, props: componentDefaults('footer') };
    assert.equal((await commit(ctxA, { appId: 'site', resourceType: 'cmsPage', operation: 'create', resourceId: 'home', payload: page('home', 'home', [header, hero, list, footer] as never) as never })).status, 'committed');
    assert.equal((await commit(ctxA, { appId: 'site', resourceType: 'cmsPage', operation: 'create', resourceId: 'about', payload: page('about', 'about', [header, form, footer] as never) as never })).status, 'committed');
    const missingMedia = await commit(ctxA, { appId: 'site', resourceType: 'cmsPage', operation: 'create', resourceId: 'x', payload: page('x', 'x', [{ ...hero, props: { ...hero.props, image: { id: 'nope', alt: { en: 'x' } } } }] as never) as never });
    assert.equal(missingMedia.error?.code, 'media_missing');
    const dupSlug = await commit(ctxA, { appId: 'site', resourceType: 'cmsPage', operation: 'create', resourceId: 'about2', payload: page('about2', 'about', []) as never });
    assert.equal(dupSlug.error?.code, 'slug_taken');
    const script = await raw(ctxA, { appId: 'site', resourceType: 'cmsPage', operation: 'create', resourceId: 'y', payload: page('y', 'y', [{ ...hero, props: { ...hero.props, html: '<script>' } }] as never) as never });
    assert.equal(script.error?.code, 'invalid_domain_payload');
    const unsafeLink = await raw(ctxA, { appId: 'site', resourceType: 'cmsPage', operation: 'create', resourceId: 'z', payload: page('z', 'z', [{ ...hero, props: { ...hero.props, ctaHref: 'javascript:alert(1)' } }] as never) as never });
    assert.equal(unsafeLink.error?.code, 'invalid_domain_payload');

    assert.equal((await commit(ctxA, { appId: 'site', resourceType: 'collection', operation: 'create', resourceId: 'news', payload: news as never })).status, 'committed');
    const item = (id: string, itemSlug: string, status: 'draft' | 'published', title: string) => ({ id, collectionId: 'news', slug: itemSlug, status, order: 0, values: { title: { en: title, de: `${title} (de)` }, date: '2026-11-01', body: { en: 'We **launched**.' } }, updatedAt: now() });
    assert.equal((await commit(ctxA, { appId: 'site', resourceType: 'item', operation: 'create', resourceId: 'n1', payload: item('n1', 'launch', 'published', 'Launch') })).status, 'committed');
    assert.equal((await commit(ctxA, { appId: 'site', resourceType: 'item', operation: 'create', resourceId: 'n2', payload: item('n2', 'secret', 'draft', 'Secret') })).status, 'committed');
    const badValues = await commit(ctxA, { appId: 'site', resourceType: 'item', operation: 'create', resourceId: 'n3', payload: { ...item('n3', 'bad', 'draft', 'Bad'), values: { title: { en: 'x' }, date: '2026-13-40', body: {} } } });
    assert.equal(badValues.error?.code, 'invalid_domain_payload');
    const deleteBusy = await commit(ctxA, { appId: 'site', resourceType: 'collection', operation: 'delete', resourceId: 'news', payload: {} });
    assert.equal(deleteBusy.error?.code, 'collection_not_empty');
  });

  test('nothing is public before the first publish', async () => {
    assert.equal(await site.readSiteManifest(slug), null);
  });

  test('publish is an atomic snapshot; restore moves the live pointer back', async () => {
    const first = await commit(ctxA, { appId: 'site', resourceType: 'publish', operation: 'create', resourceId: 'r1', payload: { id: 'r1', note: 'first', restoreOf: null, createdAt: now() } });
    assert.equal(first.status, 'committed');
    const manifest = (await site.readSiteManifest(slug))!;
    assert.equal(manifest.revisionId, 'r1');
    assert.equal(manifest.pages.length, 2);
    assert.deepEqual(manifest.media.map((m) => [m.id, m.width, m.height]), [['logo', 2, 1]]);
    assert.ok(!JSON.stringify(manifest).includes(wsA), 'no workspace id in public data');
    const about = (await site.readSitePage(slug, 'r1', 'about'))!;
    assert.equal(JSON.stringify(about).includes('channel-sales'), false, 'notification targets stay private');
    const items = await site.readSiteItems(slug, 'r1', news);
    assert.deepEqual(items.map((i) => i.slug), ['launch'], 'draft items are not published');

    // A draft edit is invisible until the next publish.
    const edited = page('home', 'home', [{ id: 'hero', type: 'hero', version: 1, props: { ...componentDefaults('hero'), heading: { en: 'Changed draft' } } }] as never);
    assert.equal((await commit(ctxA, { appId: 'site', resourceType: 'cmsPage', operation: 'update', resourceId: 'home', payload: edited as never })).status, 'committed');
    assert.ok(!JSON.stringify(await site.readSitePage(slug, 'r1', 'home')).includes('Changed draft'));
    assert.equal((await commit(ctxA, { appId: 'site', resourceType: 'publish', operation: 'create', resourceId: 'r2', payload: { id: 'r2', note: '', restoreOf: null, createdAt: now() } })).status, 'committed');
    await assert.rejects(site.readSitePage(slug, 'r1', 'home'), site.RevisionChangedError);
    assert.ok(JSON.stringify(await site.readSitePage(slug, 'r2', 'home')).includes('Changed draft'));
    const restore = await commit(ctxA, { appId: 'site', resourceType: 'publish', operation: 'create', resourceId: 'r3', payload: { id: 'r3', note: 'undo', restoreOf: 'r1', createdAt: now() } });
    assert.equal(restore.status, 'committed');
    assert.equal((await site.readSiteManifest(slug))!.revisionId, 'r1');
    assert.ok(!JSON.stringify(await site.readSitePage(slug, 'r1', 'home')).includes('Changed draft'));
    const missing = await commit(ctxA, { appId: 'site', resourceType: 'publish', operation: 'create', resourceId: 'r4', payload: { id: 'r4', note: '', restoreOf: 'nope', createdAt: now() } });
    assert.equal(missing.error?.code, 'revision_missing');
    const noSettings = await commit(ctxB, { appId: 'site', resourceType: 'publish', operation: 'create', resourceId: 'r1', payload: { id: 'r1', note: '', restoreOf: null, createdAt: now() } });
    assert.equal(noSettings.error?.code, 'site_settings_missing');
  });

  test('public media streams only for the live revision, with ETag and 304', async () => {
    const response = (await site.openSiteMedia(slug, 'logo', {}))!;
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, PNG);
    const etag = response.headers.get('etag')!;
    assert.equal(etag, `"${createHash('sha256').update(PNG).digest('hex')}"`);
    const again = (await site.openSiteMedia(slug, 'logo', { ifNoneMatch: etag }))!;
    assert.equal(again.status, 304);
    assert.equal(await site.openSiteMedia(slug, 'not-there', {}), null);
    assert.equal(await site.openSiteMedia(`nobody-${run}`, 'logo', {}), null);
  });

  test('anonymous submissions are validated, idempotent and immutable for members', async () => {
    const id = randomUUID();
    const answers = { name: 'Ana', email: 'ana@example.com', message: 'Hello' };
    assert.equal(await site.submitSiteForm(slug, 'about', 'contact', { submissionId: id, locale: 'de', answers }), 'accepted');
    assert.equal(await site.submitSiteForm(slug, 'about', 'contact', { submissionId: id, locale: 'de', answers }), 'duplicate');
    assert.equal(await site.submitSiteForm(slug, 'about', 'contact', { submissionId: id, locale: 'de', answers: { ...answers, message: 'Other' } }), 'conflict');
    assert.equal(await site.submitSiteForm(slug, 'about', 'contact', { submissionId: randomUUID(), locale: 'en', answers: { name: 'Bo' } }), 'invalid');
    assert.equal(await site.submitSiteForm(slug, 'about', 'contact', { submissionId: randomUUID(), locale: 'en', answers: { ...answers, extra: 'x' } }), 'invalid');
    assert.equal(await site.submitSiteForm(slug, 'about', 'nope', { submissionId: randomUUID(), locale: 'en', answers }), 'not_found');
    const stored = await client.getRodrigoResource(ctxA, 'site', 'submission', id);
    const row = stored.resource as Record<string, unknown>;
    assert.equal(row.status, 'new');
    assert.deepEqual(row.delivery, { messenger: { channelId: 'channel-sales', state: 'pending' }, relay: { state: 'pending' } });
    assert.equal((await client.getRodrigoResource(ctxB, 'site', 'submission', id)).resource, null, 'other workspaces cannot read it');
    revisions.set(`${wsA}:submission:${id}`, stored.revision);
    assert.equal((await commit(ctxA, { appId: 'site', resourceType: 'submission', operation: 'update', resourceId: id, payload: { ...row, status: 'handled' } })).status, 'committed');
    const tampered = await commit(ctxA, { appId: 'site', resourceType: 'submission', operation: 'update', resourceId: id, payload: { ...row, status: 'handled', answers: { name: 'Eve' } } });
    assert.equal(tampered.error?.code, 'submission_immutable');
  });

  test('public renderer: locale URLs, hreflang, CSP, sitemap, detail pages and form POST', async () => {
    const route = await import('../app/s/[slug]/[...path]/route');
    const call = async (path: string[], init: RequestInit = {}) => route[init.method === 'POST' ? 'POST' : 'GET'](
      new Request(`http://localhost:3301/s/${slug}/${path.join('/')}${path.length === 1 && path[0] !== 'sitemap.xml' ? '/' : ''}`, { headers: { host: 'localhost:3301', ...(init.headers as Record<string, string> ?? {}) }, ...init }),
      { params: Promise.resolve({ slug, path }) },
    );
    const de = await call(['de']);
    assert.equal(de.status, 200);
    const html = await de.text();
    assert.match(html, /<html lang="de">/);
    assert.match(html, /Start|Bänke/);
    assert.match(html, /hreflang="en" href="http:\/\/localhost:3301\/s\/[^"]+\/en\/"/);
    assert.match(html, /<link rel="canonical" href="http:\/\/localhost:3301\/s\/[^"]+\/de\/"/);
    assert.ok(!/<script/i.test(html));
    const csp = de.headers.get('content-security-policy')!;
    assert.match(csp, /script-src 'none'/);
    assert.ok(!csp.includes('unsafe-inline'));
    assert.match(html, new RegExp(`src="/s/${slug}/media/logo" alt="[^"]+" width="2" height="1"`));
    const detail = await call(['en', 'news', 'launch']);
    assert.equal(detail.status, 200);
    assert.match(await detail.text(), /Launch/);
    assert.equal((await call(['en', 'news', 'secret'])).status, 404);
    assert.equal((await call(['fr'])).status, 404);
    const sitemap = await (await call(['sitemap.xml'])).text();
    assert.match(sitemap, /\/en\/about<\/loc>/);
    assert.match(sitemap, /\/de\/news\/launch<\/loc>/);
    assert.ok(!sitemap.includes('secret'));

    const aboutResponse = await call(["en", "about"]);
    const aboutHtml = await aboutResponse.text();
    assert.equal(aboutResponse.status, 200, aboutHtml.slice(-600));
    const token = /name="_t" value="([^"]+)"/.exec(aboutHtml)![1]!;
    const post = (fields: Record<string, string>) => call(['_form', 'about', 'contact'], {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 200)}` }, body: new URLSearchParams(fields).toString(),
    });
    const fast = await post({ _t: token, _l: 'en', f_name: 'Ana', f_email: 'ana@example.com', f_message: 'Hi' });
    assert.equal(fast.status, 303, 'too fast is answered like success but not stored');
    const { issueFormToken } = await import('../lib/site-cms/form-guard');
    const aged = issueFormToken(slug, Date.now() - 10_000);
    const ok = await post({ _t: aged, _l: 'en', f_name: 'Ana', f_email: 'ana@example.com', f_message: 'Hi', website: '' });
    assert.equal(ok.status, 303);
    assert.match(ok.headers.get('location')!, /\/en\/about\?sent=contact#contact$/);
    const forged = await post({ _t: `${Date.now() - 10_000}.${'A'.repeat(43)}`, _l: 'en', f_name: 'Ana', f_email: 'ana@example.com', f_message: 'Hi' });
    assert.match(forged.headers.get('location')!, /form_error=contact/);
    const sent = await call(['en', 'about'], { headers: {} });
    assert.equal(sent.status, 200);
  });

  test('Rodrigo down: public reads fail closed', async () => {
    await rodrigo.stop();
    await assert.rejects(site.readSiteManifest(`down-${run}`));
    const route = await import('../app/s/[slug]/[...path]/route');
    const response = await route.GET(new Request(`http://localhost:3301/s/down-${run}/en/`, { headers: { host: 'localhost:3301' } }), { params: Promise.resolve({ slug: `down-${run}`, path: ['en'] }) });
    assert.equal(response.status, 503);
    rodrigo = await startRodrigo();
  });
});
