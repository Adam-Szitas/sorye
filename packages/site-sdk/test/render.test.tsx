import assert from 'node:assert/strict';
import { test } from 'node:test';
import { componentDefaults } from '../src/registry';
import { renderDocument, siteCsp } from '../src/render';
import { migrateLegacySite } from '../src/legacy';
import { validatePage, validateSettings } from '../src/validate';
import type { SiteSection } from '../src/model';
import { ctx, page } from './fixtures';

const meta = { title: 'Acme', description: 'Acme makes things', canonical: 'https://hub.example/s/acme/en/', alternates: [{ locale: 'en' as const, href: 'https://hub.example/s/acme/en/' }, { locale: 'de' as const, href: 'https://hub.example/s/acme/de/' }] };

function render(sections: SiteSection[], overrides = {}) {
  const c = ctx({ page: page(sections), ...overrides });
  return renderDocument(c, sections, meta);
}

const all: SiteSection[] = [
  { id: 'header', type: 'header', version: 1, props: componentDefaults('header') },
  { id: 'hero', type: 'hero', version: 1, props: { ...componentDefaults('hero'), heading: { en: '<script>alert(1)</script>' }, image: { id: 'm1', alt: { en: 'Workshop' } }, ctaLabel: { en: 'Go' }, ctaHref: '/about' } },
  { id: 'about', type: 'richText', version: 1, props: { heading: { en: 'About' }, body: { en: '## Story\n\nWe **build** [things](https://example.com) and [bad](javascript:alert(1)).\n\n- one\n- two' } } },
  { id: 'feat', type: 'features', version: 1, props: componentDefaults('features') },
  { id: 'img', type: 'imageText', version: 1, props: { ...componentDefaults('imageText'), image: { id: 'm1', alt: { en: 'Team photo' } } } },
  { id: 'gal', type: 'gallery', version: 1, props: { heading: { en: 'Gallery' }, images: [{ image: { id: 'm1', alt: { en: 'Bench' } }, caption: { en: 'Bench' } }] } },
  { id: 'team', type: 'team', version: 1, props: { ...componentDefaults('team'), members: [{ name: { en: 'Ana' }, role: {}, bio: {}, photo: null, href: '' }] } },
  { id: 'quotes', type: 'testimonials', version: 1, props: { heading: {}, items: [{ quote: { en: 'Great' }, author: { en: 'Bo' }, role: {}, photo: null }] } },
  { id: 'faq', type: 'faq', version: 1, props: { heading: { en: 'FAQ' }, items: [{ question: { en: 'Why?' }, answer: { en: 'Because.' } }] } },
  { id: 'price', type: 'pricing', version: 1, props: { heading: {}, intro: {}, plans: [{ name: { en: 'Basic' }, price: { en: '€9' }, period: {}, features: [{ text: { en: 'One' } }], highlighted: true, ctaLabel: {}, ctaHref: '' }] } },
  { id: 'cta', type: 'cta', version: 1, props: componentDefaults('cta') },
  { id: 'contact', type: 'contactForm', version: 1, props: componentDefaults('contactForm') },
  { id: 'list', type: 'collectionList', version: 1, props: { ...componentDefaults('collectionList'), collection: 'news', summaryField: 'body', dateField: 'date' } },
  { id: 'logos', type: 'logoStrip', version: 1, props: { heading: {}, logos: [{ image: { id: 'm1', alt: { en: 'Partner' } }, href: 'https://example.com' }] } },
  { id: 'links', type: 'linkList', version: 1, props: { heading: { en: 'Links' }, links: [{ label: { en: 'Docs' }, href: 'https://docs.example.com' }] } },
  { id: 'shop', type: 'productShowcase', version: 1, props: componentDefaults('productShowcase') },
  { id: 'footer', type: 'footer', version: 1, props: componentDefaults('footer') },
];

test('renders every component to static HTML with no script and escaped text', () => {
  const { html, skipped, styleHashes } = render(all);
  assert.deepEqual(skipped, []);
  assert.ok(!/<script/i.test(html.replace('&lt;script&gt;', '')), 'no script tags');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(!/ on[a-z]+=/i.test(html), 'no inline event handlers');
  assert.ok(!/ style=/i.test(html), 'no inline style attributes (CSP)');
  assert.equal(styleHashes.length, 2);
  assert.match(siteCsp(styleHashes), /script-src 'none'/);
  assert.ok(!siteCsp(styleHashes).includes('unsafe-inline'));
});

test('landmarks, one h1, alt text, intrinsic sizes and lazy loading', () => {
  const { html } = render(all);
  assert.equal(html.match(/<h1[ >]/g)?.length, 1);
  assert.match(html, /<header class="s-header">/);
  assert.match(html, /<main id="main"/);
  assert.match(html, /<footer class="s-footer">/);
  assert.match(html, /<a class="s-skip" href="#main">/);
  for (const img of html.match(/<img [^>]+>/g) ?? []) {
    assert.match(img, / alt="[^"]+"/, img);
    assert.match(img, / width="\d+"/, img);
    assert.match(img, / height="\d+"/, img);
  }
  assert.match(html, /fetchpriority="high"/i);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /popover="auto"/);
  assert.match(html, /<details class="s-nav-narrow">/);
  assert.match(html, /prefers-reduced-motion/);
});

test('internal links get the site base path; external links get rel', () => {
  const { html } = render(all);
  assert.match(html, /href="\/s\/acme\/en\/about"/);
  assert.match(html, /href="https:\/\/example.com" rel="noopener noreferrer"/);
});

test('collection lists show published items only, linking to detail pages', () => {
  const { html } = render(all);
  assert.match(html, /href="\/s\/acme\/en\/news\/launch"/);
  assert.ok(!html.includes('Secret draft'));
});

test('localized values fall back to the default locale', () => {
  const sections = all.filter((s) => s.id === 'list');
  const { html } = render(sections, { locale: 'de', basePath: '/s/acme/de' });
  assert.match(html, /Start/);
  assert.match(html, /<html lang="de">/);
  assert.match(html, /hreflang="de"/);
});

test('without a leading hero the page title becomes a hidden h1', () => {
  const { html } = render(all.filter((s) => s.id === 'feat'));
  assert.match(html, /<h1 class="s-sr">Acme<\/h1>/);
  assert.equal(html.match(/<h1[ >]/g)?.length, 1);
});

test('contact form has a honeypot, signed time token and no JavaScript', () => {
  const { html } = render(all.filter((s) => s.id === 'contact'));
  assert.match(html, /<form [^>]*action="\/s\/acme\/_form\/contact"/);
  assert.match(html, /<form [^>]*method="post"/);
  assert.match(html, /name="_t" value="tok"/);
  const honeypot = /<input id="contact-website"[^>]*>/.exec(html)?.[0] ?? "";
  assert.match(honeypot, / tabindex="-1"/);
  assert.match(honeypot, / name="website"/);
  assert.match(honeypot, / autocomplete="off"/);
  assert.match(html, /type="email"[^>]*autoComplete="email"|autocomplete="email"/i);
  const sent = renderDocument(ctx({ form: { action: () => '/x', token: 't', state: { sectionId: 'contact', kind: 'sent' } } }), all.filter((s) => s.id === 'contact'), meta).html;
  assert.match(sent, /Thank you/);
  assert.ok(!sent.includes('<form'));
});

test('invalid stored sections are skipped, never rendered', () => {
  const bad = [{ id: 'x', type: 'hero', version: 1, props: { heading: { en: 'x' } } }] as SiteSection[];
  const { html, skipped } = render(bad);
  assert.deepEqual(skipped, ['x']);
  assert.ok(!html.includes('>x<'));
});

test('the HTML stays small for a typical page', () => {
  const { html } = render(all);
  assert.ok(Buffer.byteLength(html) < 60_000, `${Buffer.byteLength(html)} bytes`);
});

test('legacy one-page sites migrate without losing content', () => {
  const result = migrateLegacySite({
    slug: 'acme-1234', displayName: 'Acme',
    blocks: [
      { id: 'b1', type: 'hero', heading: 'Acme', offer: 'We build', ctaLabel: 'Talk', ctaHref: '/contact', imageUrl: 'https://cdn.example/img.jpg' },
      { id: 'b2', type: 'about', text: 'Long story' },
      { id: 'b3', type: 'links', heading: 'Links', links: [{ label: 'Docs', url: 'https://docs.example' }] },
      { id: 'b4', type: 'storefront', heading: 'Shop' },
      { id: 'b5', type: 'contact', heading: 'Contact', ctaLabel: 'Write', href: '/contact' },
      { id: 'b6', type: 'contact', heading: 'Mail', ctaLabel: 'Email us', href: 'mailto:hi@acme.example' },
    ],
  }, 'en', '2026-11-13T10:00:00.000Z');
  assert.deepEqual(validateSettings(result.settings), []);
  assert.deepEqual(validatePage(result.page), []);
  const types = result.page.sections.map((s) => s.type);
  assert.deepEqual(types, ['header', 'hero', 'richText', 'linkList', 'productShowcase', 'contactForm', 'cta', 'footer']);
  const hero = result.page.sections[1]!;
  assert.equal(hero.props.ctaHref, '#contact');
  assert.deepEqual(hero.props.subheading, { en: 'We build' });
  assert.deepEqual(result.notes.find((n) => n.kind === 'externalImage'), { kind: 'externalImage', sectionId: 'b1', url: 'https://cdn.example/img.jpg' });
  assert.equal(result.page.sections[5]!.id, 'contact');
  assert.equal(result.page.sections[6]!.props.ctaHref, 'mailto:hi@acme.example');
});
