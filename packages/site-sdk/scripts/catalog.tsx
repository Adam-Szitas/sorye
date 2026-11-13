// Explicit React keeps classic-runtime JSX transforms (tests under Hub tsconfig) working.
import React from 'react';
void React;
/**
 * Writes `CATALOG.html`: every component rendered with sample props next to its
 * props table. Run `pnpm --filter @sorye/site-sdk docs:catalog`.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RenderContext } from '../src/context';
import { COMPONENTS, componentDefaults } from '../src/registry';
import { renderDocument } from '../src/render';
import type { FieldSpec, PropsSpec } from '../src/schema';
import type { SiteSection } from '../src/model';

const svg = (w: number, h: number, hue: number) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="hsl(${hue} 45% 70%)"/></svg>`)}`;
const media = { id: 'sample', alt: { en: 'Sample image' } };
const ctx: RenderContext = {
  settings: { id: 'site', slug: 'catalog', name: 'Component catalog', theme: { preset: 'paper', overrides: {} }, logo: null, favicon: null, socialImage: null, defaultLocale: 'en', locales: ['en'], seo: { title: {}, description: {} }, homePageId: 'home', updatedAt: new Date(0).toISOString() },
  locale: 'en', basePath: '#', page: null,
  nav: { header: [{ href: '#about', label: 'About', current: false }, { href: '#news', label: 'News', current: false }], footer: [{ href: '#imprint', label: 'Imprint', current: false }] },
  media: (id) => ({ id, url: svg(1200, 800, id.length * 40), width: 1200, height: 800, mimeType: 'image/svg+xml', name: 'sample.svg' }),
  collections: [{ id: 'news', slug: 'news', name: { en: 'News' }, titleField: 'title', sort: 'manual', sortField: '', detailPages: true, updatedAt: '', fields: [{ key: 'title', label: { en: 'Title' }, kind: 'text', required: true, options: [] }, { key: 'summary', label: { en: 'Summary' }, kind: 'text', required: false, options: [] }] }],
  items: () => [{ id: 'n1', collectionId: 'news', slug: 'hello', status: 'published', order: 0, values: { title: { en: 'Hello world' }, summary: { en: 'A first collection item.' } }, updatedAt: '' }],
  products: [{ id: 'p', title: 'Starter kit', summary: 'Everything to begin.', priceCents: 4900, category: 'Kits', accent: '' }],
  formatPrice: (c) => `€${(c / 100).toFixed(2)}`,
  form: { action: () => '#', token: 'sample' }, preview: false,
};

const samples: Record<string, Record<string, unknown>> = {
  hero: { subheading: { en: 'A short offer that says what you do.' }, ctaLabel: { en: 'Get in touch' }, ctaHref: '#contact', image: media },
  imageText: { heading: { en: 'Image and text' }, body: { en: 'Text **beside** an image.' }, image: media },
  gallery: { heading: { en: 'Gallery' }, images: [1, 2, 3].map(() => ({ image: media, caption: { en: 'Caption' } })) },
  team: { members: [{ name: { en: 'Ana Novak' }, role: { en: 'Founder' }, bio: {}, photo: media, href: '' }] },
  testimonials: { heading: { en: 'What people say' }, items: [{ quote: { en: 'Clear and fast.' }, author: { en: 'Bo' }, role: { en: 'Customer' }, photo: null }] },
  faq: { items: [{ question: { en: 'Is there JavaScript?' }, answer: { en: 'No. Pages are static HTML.' } }] },
  pricing: { plans: [{ name: { en: 'Basic' }, price: { en: '€9' }, period: { en: '/month' }, features: [{ text: { en: 'One site' } }], highlighted: false, ctaLabel: {}, ctaHref: '' }, { name: { en: 'Pro' }, price: { en: '€29' }, period: { en: '/month' }, features: [{ text: { en: 'Five sites' } }], highlighted: true, ctaLabel: { en: 'Choose' }, ctaHref: '#contact' }] },
  collectionList: { heading: { en: 'News' }, collection: 'news', summaryField: 'summary' },
  collectionItem: { collection: 'news', itemSlug: { en: 'hello' } },
  logoStrip: { heading: { en: 'Trusted by' }, logos: [1, 2, 3].map(() => ({ image: media, href: '' })) },
  linkList: { links: [{ label: { en: 'Documentation' }, href: 'https://example.com' }] },
  footer: { text: { en: 'Made with Sorye Site.' }, copyright: { en: '© Example' } },
};

function describe(spec: FieldSpec): string {
  switch (spec.kind) {
    case 'text': return `text ≤ ${spec.max}${spec.multiline ? ', multiline' : ''}, localized`;
    case 'richtext': return `Markdown subset ≤ ${spec.max}, localized`;
    case 'select': return `one of ${spec.options.join(' | ')}`;
    case 'number': return `number ${spec.min}–${spec.max}`;
    case 'media': return `${spec.accept} from the media library + alt text`;
    case 'list': return `list ≤ ${spec.max} of { ${Object.keys(spec.item).join(', ')} }`;
    default: return spec.kind;
  }
}

function table(props: PropsSpec): string {
  const rows = Object.entries(props).map(([key, spec]) => `<tr><td><code>${key}</code></td><td>${spec.label}</td><td>${describe(spec)}</td><td>${'required' in spec && spec.required ? 'yes' : ''}</td></tr>`);
  return `<table><thead><tr><th>Prop</th><th>Label</th><th>Value</th><th>Required</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

const parts = COMPONENTS.map((c) => {
  const section: SiteSection = { id: `sample-${c.type}`, type: c.type, version: c.version, props: { ...componentDefaults(c.type), ...(samples[c.type] ?? {}) } };
  const body = renderDocument(ctx, [section], { title: c.label, description: '', canonical: '#', alternates: [] }).html.replace(/^.*<body>/s, '').replace(/<\/body>.*$/s, '');
  return `<article class="cat"><h2 id="${c.type}">${c.label} <code>${c.type}@${c.version}</code></h2><p>${c.description}</p>${table(c.props)}<div class="frame">${body}</div></article>`;
});
const head = renderDocument(ctx, [], { title: 'Site SDK component catalog', description: '', canonical: '#', alternates: [] }).html.match(/<head>.*<\/head>/s)?.[0] ?? '';
const extra = '<style>.cat{max-width:72rem;margin:2rem auto;padding:0 1rem}.cat table{border-collapse:collapse;font-size:.9rem;margin:1rem 0}.cat td,.cat th{border:1px solid #ccd;padding:.25rem .5rem;text-align:left}.frame{border:1px dashed #99a;margin:1rem 0}</style>';
const nav = `<nav class="cat"><h1>@sorye/site-sdk components</h1><ul>${COMPONENTS.map((c) => `<li><a href="#${c.type}">${c.label}</a></li>`).join('')}</ul></nav>`;
writeFileSync(resolve(import.meta.dirname, '../CATALOG.html'), `<!doctype html><html lang="en">${head.replace('</head>', `${extra}</head>`)}<body>${nav}${parts.join('')}</body></html>`);
console.log('wrote CATALOG.html');
