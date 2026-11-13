// Explicit React keeps classic-runtime JSX transforms (tests under Hub tsconfig) working.
import React from 'react';
void React;
/**
 * Component definitions: one typed definition per section type.
 * `props` is the shared validation schema, `defaults` the starting props, `render`
 * the server renderer. Renderers only ever receive validated props.
 */
import type { ReactElement } from 'react';
import { itemHref, resolveHref, t, ui, type RenderContext } from './context';
import type { LText } from './locales';
import { externalRel, markdownToText } from './markdown';
import type { CollectionField, SiteCollection, SiteCollectionItem } from './model';
import { emptyProps, isMediaRef, type FieldSpec, type MediaRef, type PropsSpec, type SiteFormField } from './schema';
import { Button, Heading, Img, Rich, SubHeading, Text, type HeadingLevel } from './components/shared';

export type ComponentCategory = 'layout' | 'content' | 'media' | 'people' | 'data' | 'forms';

export interface RenderArgs<P> {
  props: P;
  ctx: RenderContext;
  sectionId: string;
  /** 1 for the page's leading heading, otherwise 2. */
  level: HeadingLevel;
}

export interface ComponentDefinition<P = Record<string, unknown>> {
  type: string;
  version: number;
  label: string;
  description: string;
  category: ComponentCategory;
  /** Interactive island, if any. All current components work without client JavaScript. */
  island: null;
  /** Whether the component can carry the page's h1. */
  leadsPage: boolean;
  props: PropsSpec;
  defaults: () => P;
  render: (args: RenderArgs<P>) => ReactElement | null;
}

// ---- field spec helpers -------------------------------------------------------
const text = (label: string, max: number, extra: Partial<Extract<FieldSpec, { kind: 'text' }>> = {}): FieldSpec => ({ kind: 'text', label, max, ...extra });
const rich = (label: string, max: number, required = false): FieldSpec => ({ kind: 'richtext', label, max, required });
const link = (label: string, required = false): FieldSpec => ({ kind: 'link', label, required, help: 'https://…, mailto:…, a page path like /about, or #section' });
const image = (label: string, required = false): FieldSpec => ({ kind: 'media', accept: 'image', label, required });
const select = (label: string, options: readonly string[]): FieldSpec => ({ kind: 'select', label, options });
const bool = (label: string): FieldSpec => ({ kind: 'boolean', label });
const list = (label: string, max: number, item: PropsSpec, itemLabel?: string): FieldSpec => ({ kind: 'list', label, max, item, ...(itemLabel ? { itemLabel } : {}) });

const L = (en: string): LText => ({ en });

type Props = Record<string, unknown>;
const lt = (v: unknown) => (v ?? {}) as LText;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const media = (v: unknown) => (isMediaRef(v) ? v : null);
const arr = (v: unknown) => (Array.isArray(v) ? (v as Props[]) : []);

function def<P extends Props>(d: Omit<ComponentDefinition<P>, 'island'>): ComponentDefinition<P> {
  return { ...d, island: null };
}

function headingId(sectionId: string) {
  return `${sectionId}-h`;
}

// ---- layout ----------------------------------------------------------------------
const header = def({
  type: 'header', version: 1, label: 'Header & navigation', category: 'layout', leadsPage: false,
  description: 'Logo or site name, the pages placed in the header, and an optional button. The mobile menu works without JavaScript.',
  props: { brand: text('Brand text', 80, { help: 'Shown when the site has no logo.' }), ctaLabel: text('Button label', 40), ctaHref: link('Button link') },
  defaults: () => ({ brand: {}, ctaLabel: {}, ctaHref: '' }),
  render: ({ props, ctx }) => {
    const brand = t(ctx, lt(props.brand)) || ctx.settings.name;
    const links = ctx.nav.header;
    const navList = (
      <ul className="s-nav-list">
        {links.map((l) => <li key={l.href}><a href={l.href} {...(l.current ? { 'aria-current': 'page' as const } : {})}>{l.label}</a></li>)}
      </ul>
    );
    return (
      <header className="s-header">
        <div className="s-wrap s-header-row">
          <a className="s-brand" href={`${ctx.basePath}/`}>
            {ctx.settings.logo ? <Img ctx={ctx} media={ctx.settings.logo} sizes="160px" className="s-logo" priority /> : brand}
            {ctx.settings.logo ? <span className="s-sr">{brand}</span> : null}
          </a>
          {links.length > 0 ? (
            <nav aria-label={brand} className="s-nav">
              <div className="s-nav-wide">{navList}</div>
              <details className="s-nav-narrow">
                <summary>{ui(ctx.locale, 'menu')}</summary>
                {navList}
              </details>
            </nav>
          ) : null}
          <Button ctx={ctx} label={lt(props.ctaLabel)} href={str(props.ctaHref)} />
        </div>
      </header>
    );
  },
});

const footer = def({
  type: 'footer', version: 1, label: 'Footer', category: 'layout', leadsPage: false,
  description: 'Closing text, footer pages, extra links and a copyright line.',
  props: { text: text('Text', 500, { multiline: true }), links: list('Links', 12, { label: text('Label', 60, { required: true }), href: link('Link', true) }, 'Link'), copyright: text('Copyright line', 120) },
  defaults: () => ({ text: {}, links: [], copyright: {} }),
  render: ({ props, ctx }) => {
    const extra = arr(props.links);
    const pages = ctx.nav.footer;
    return (
      <footer className="s-footer">
        <div className="s-wrap s-footer-row">
          <Text ctx={ctx} value={lt(props.text)} className="s-footer-text" />
          {pages.length + extra.length > 0 ? (
            <nav aria-label="Footer">
              <ul className="s-footer-links">
                {pages.map((l) => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}
                {extra.map((l, i) => <li key={i}><a href={resolveHref(ctx, str(l.href))} {...externalRel(str(l.href))}>{t(ctx, lt(l.label))}</a></li>)}
              </ul>
            </nav>
          ) : null}
          <Text ctx={ctx} value={lt(props.copyright)} className="s-muted s-small" />
        </div>
      </footer>
    );
  },
});

// ---- content ---------------------------------------------------------------------
const hero = def({
  type: 'hero', version: 1, label: 'Hero', category: 'content', leadsPage: true,
  description: 'Opening heading, a short offer, up to two buttons and an optional image.',
  props: {
    heading: text('Heading', 120, { required: true }), subheading: text('Offer', 300, { multiline: true }),
    ctaLabel: text('Button label', 40), ctaHref: link('Button link'),
    secondaryLabel: text('Second button label', 40), secondaryHref: link('Second button link'),
    image: image('Image'), align: select('Alignment', ['start', 'center']),
  },
  defaults: () => ({ heading: L('Welcome'), subheading: {}, ctaLabel: {}, ctaHref: '', secondaryLabel: {}, secondaryHref: '', image: null, align: 'start' }),
  render: ({ props, ctx, level, sectionId }) => (
    <section id={sectionId} className={`s-section s-hero s-align-${str(props.align)}`}>
      <div className={`s-wrap ${props.image ? 's-split' : ''}`}>
        <div className="s-hero-copy">
          <Heading level={level} text={t(ctx, lt(props.heading))} className="s-hero-title" />
          <Text ctx={ctx} value={lt(props.subheading)} className="s-lead" />
          <div className="s-actions">
            <Button ctx={ctx} label={lt(props.ctaLabel)} href={str(props.ctaHref)} />
            <Button ctx={ctx} label={lt(props.secondaryLabel)} href={str(props.secondaryHref)} variant="secondary" />
          </div>
        </div>
        <Img ctx={ctx} media={media(props.image)} sizes="(min-width: 900px) 50vw, 100vw" priority className="s-hero-img" />
      </div>
    </section>
  ),
});

const richText = def({
  type: 'richText', version: 1, label: 'Rich text', category: 'content', leadsPage: true,
  description: 'Heading and formatted text: paragraphs, subheadings, lists, bold, italic and links. No HTML.',
  props: { heading: text('Heading', 120), body: rich('Text', 20000, true) },
  defaults: () => ({ heading: {}, body: L('Write something here.') }),
  render: ({ props, ctx, level, sectionId }) => (
    <section id={sectionId} className="s-section s-rich"><div className="s-wrap s-narrow">
      <Heading level={level} text={t(ctx, lt(props.heading))} />
      <Rich ctx={ctx} value={lt(props.body)} />
    </div></section>
  ),
});

const features = def({
  type: 'features', version: 1, label: 'Features / services', category: 'content', leadsPage: false,
  description: 'A grid of short items, each with a title, text and an optional link.',
  props: {
    heading: text('Heading', 120), intro: text('Intro', 500, { multiline: true }), columns: select('Columns', ['2', '3', '4']),
    items: list('Items', 12, { title: text('Title', 80, { required: true }), body: text('Text', 500, { multiline: true }), href: link('Link') }, 'Item'),
  },
  defaults: () => ({ heading: L('What we do'), intro: {}, columns: '3', items: [{ title: L('First service'), body: {}, href: '' }] }),
  render: ({ props, ctx, level, sectionId }) => (
    <section id={sectionId} className="s-section"><div className="s-wrap">
      <Heading level={level} text={t(ctx, lt(props.heading))} />
      <Text ctx={ctx} value={lt(props.intro)} className="s-lead" />
      <ul className={`s-grid s-cols-${str(props.columns)}`}>
        {arr(props.items).map((item, i) => (
          <li key={i} className="s-card">
            <SubHeading level={level} text={t(ctx, lt(item.title))} />
            <Text ctx={ctx} value={lt(item.body)} />
            {str(item.href) ? <a className="s-more" href={resolveHref(ctx, str(item.href))} {...externalRel(str(item.href))}>{ui(ctx.locale, 'readMore')}<span className="s-sr">: {t(ctx, lt(item.title))}</span></a> : null}
          </li>
        ))}
      </ul>
    </div></section>
  ),
});

const imageText = def({
  type: 'imageText', version: 1, label: 'Image + text', category: 'media', leadsPage: true,
  description: 'An image beside formatted text, with an optional button.',
  props: { heading: text('Heading', 120), body: rich('Text', 5000), image: image('Image', true), imageSide: select('Image side', ['start', 'end']), ctaLabel: text('Button label', 40), ctaHref: link('Button link') },
  defaults: () => ({ heading: {}, body: {}, image: null, imageSide: 'start', ctaLabel: {}, ctaHref: '' }),
  render: ({ props, ctx, level, sectionId }) => (
    <section id={sectionId} className="s-section"><div className={`s-wrap s-split s-image-${str(props.imageSide)}`}>
      <Img ctx={ctx} media={media(props.image)} sizes="(min-width: 900px) 50vw, 100vw" className="s-media" />
      <div>
        <Heading level={level} text={t(ctx, lt(props.heading))} />
        <Rich ctx={ctx} value={lt(props.body)} />
        <div className="s-actions"><Button ctx={ctx} label={lt(props.ctaLabel)} href={str(props.ctaHref)} /></div>
      </div>
    </div></section>
  ),
});

const gallery = def({
  type: 'gallery', version: 1, label: 'Gallery', category: 'media', leadsPage: false,
  description: 'A grid of images. Each opens larger in a lightbox built on the HTML popover attribute (no JavaScript).',
  props: { heading: text('Heading', 120), images: list('Images', 24, { image: image('Image', true), caption: text('Caption', 200) }, 'Image') },
  defaults: () => ({ heading: {}, images: [] }),
  render: ({ props, ctx, level, sectionId }) => (
    <section id={sectionId} className="s-section"><div className="s-wrap">
      <Heading level={level} text={t(ctx, lt(props.heading))} />
      <ul className="s-gallery">
        {arr(props.images).map((entry, i) => {
          const ref = media(entry.image);
          const info = ref ? ctx.media(ref.id) : undefined;
          if (!ref || !info) return null;
          const popId = `${sectionId}-img-${i}`;
          const caption = t(ctx, lt(entry.caption));
          return (
            <li key={i}>
              <figure>
                <button type="button" className="s-thumb" popoverTarget={popId} aria-label={`${ui(ctx.locale, 'open')}: ${t(ctx, ref.alt)}`}>
                  <Img ctx={ctx} media={ref} sizes="(min-width: 900px) 25vw, 50vw" />
                </button>
                {caption ? <figcaption>{caption}</figcaption> : null}
              </figure>
              <div id={popId} popover="auto" className="s-lightbox">
                <img src={info.url} alt={t(ctx, ref.alt)} width={info.width} height={info.height} loading="lazy" decoding="async" />
                <button type="button" className="s-btn s-btn-secondary" popoverTarget={popId} popoverTargetAction="hide">{ui(ctx.locale, 'close')}</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div></section>
  ),
});

const team = def({
  type: 'team', version: 1, label: 'Team', category: 'people', leadsPage: false,
  description: 'People with a photo, role, short bio and an optional link.',
  props: { heading: text('Heading', 120), intro: text('Intro', 500, { multiline: true }), members: list('People', 24, { name: text('Name', 80, { required: true }), role: text('Role', 80), bio: text('Bio', 500, { multiline: true }), photo: image('Photo'), href: link('Link') }, 'Person') },
  defaults: () => ({ heading: L('Team'), intro: {}, members: [] }),
  render: ({ props, ctx, level, sectionId }) => (
    <section id={sectionId} className="s-section"><div className="s-wrap">
      <Heading level={level} text={t(ctx, lt(props.heading))} />
      <Text ctx={ctx} value={lt(props.intro)} className="s-lead" />
      <ul className="s-grid s-cols-3">
        {arr(props.members).map((m, i) => (
          <li key={i} className="s-person">
            <Img ctx={ctx} media={media(m.photo)} sizes="160px" className="s-avatar" />
            <SubHeading level={level} text={t(ctx, lt(m.name))} />
            <Text ctx={ctx} value={lt(m.role)} className="s-muted" />
            <Text ctx={ctx} value={lt(m.bio)} />
            {str(m.href) ? <a href={resolveHref(ctx, str(m.href))} {...externalRel(str(m.href))}>{ui(ctx.locale, 'readMore')}<span className="s-sr">: {t(ctx, lt(m.name))}</span></a> : null}
          </li>
        ))}
      </ul>
    </div></section>
  ),
});

const testimonials = def({
  type: 'testimonials', version: 1, label: 'Testimonials', category: 'people', leadsPage: false,
  description: 'Quotes from customers or partners.',
  props: { heading: text('Heading', 120), items: list('Quotes', 12, { quote: text('Quote', 600, { required: true, multiline: true }), author: text('Author', 80, { required: true }), role: text('Role or company', 80), photo: image('Photo') }, 'Quote') },
  defaults: () => ({ heading: {}, items: [] }),
  render: ({ props, ctx, level, sectionId }) => (
    <section id={sectionId} className="s-section"><div className="s-wrap">
      <Heading level={level} text={t(ctx, lt(props.heading))} />
      <ul className="s-grid s-cols-2">
        {arr(props.items).map((q, i) => (
          <li key={i} className="s-card">
            <figure className="s-quote">
              <blockquote><p>{t(ctx, lt(q.quote))}</p></blockquote>
              <figcaption>
                <Img ctx={ctx} media={media(q.photo)} sizes="48px" className="s-avatar-sm" />
                <span>{t(ctx, lt(q.author))}</span>
                <Text ctx={ctx} value={lt(q.role)} as="span" className="s-muted" />
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </div></section>
  ),
});

const faq = def({
  type: 'faq', version: 1, label: 'FAQ', category: 'content', leadsPage: false,
  description: 'Questions that expand to show their answer (native disclosure, keyboard accessible).',
  props: { heading: text('Heading', 120), items: list('Questions', 30, { question: text('Question', 200, { required: true }), answer: rich('Answer', 3000, true) }, 'Question') },
  defaults: () => ({ heading: L('Questions'), items: [] }),
  render: ({ props, ctx, level, sectionId }) => (
    <section id={sectionId} className="s-section"><div className="s-wrap s-narrow">
      <Heading level={level} text={t(ctx, lt(props.heading))} />
      <div className="s-faq">
        {arr(props.items).map((q, i) => (
          <details key={i}>
            <summary>{t(ctx, lt(q.question))}</summary>
            <Rich ctx={ctx} value={lt(q.answer)} />
          </details>
        ))}
      </div>
    </div></section>
  ),
});

const pricing = def({
  type: 'pricing', version: 1, label: 'Pricing table', category: 'content', leadsPage: false,
  description: 'Plans with a price and feature list, for display only. No checkout.',
  props: {
    heading: text('Heading', 120), intro: text('Intro', 500, { multiline: true }),
    plans: list('Plans', 6, {
      name: text('Name', 60, { required: true }), price: text('Price', 40, { required: true }), period: text('Period', 40),
      features: list('Features', 12, { text: text('Feature', 120, { required: true }) }, 'Feature'),
      highlighted: bool('Highlight this plan'), ctaLabel: text('Button label', 40), ctaHref: link('Button link'),
    }, 'Plan'),
  },
  defaults: () => ({ heading: L('Pricing'), intro: {}, plans: [] }),
  render: ({ props, ctx, level, sectionId }) => (
    <section id={sectionId} className="s-section"><div className="s-wrap">
      <Heading level={level} text={t(ctx, lt(props.heading))} />
      <Text ctx={ctx} value={lt(props.intro)} className="s-lead" />
      <ul className="s-grid s-cols-3">
        {arr(props.plans).map((p, i) => (
          <li key={i} className={`s-card s-plan ${p.highlighted === true ? 's-plan-hi' : ''}`}>
            <SubHeading level={level} text={t(ctx, lt(p.name))} />
            <p className="s-price">{t(ctx, lt(p.price))} <Text ctx={ctx} value={lt(p.period)} as="span" className="s-muted" /></p>
            <ul className="s-checks">{arr(p.features).map((f, j) => <li key={j}>{t(ctx, lt(f.text))}</li>)}</ul>
            <Button ctx={ctx} label={lt(p.ctaLabel)} href={str(p.ctaHref)} variant={p.highlighted === true ? 'primary' : 'secondary'} />
          </li>
        ))}
      </ul>
    </div></section>
  ),
});

const cta = def({
  type: 'cta', version: 1, label: 'Call to action', category: 'content', leadsPage: true,
  description: 'A short heading and text with one button.',
  props: { heading: text('Heading', 120, { required: true }), body: text('Text', 500, { multiline: true }), ctaLabel: text('Button label', 40), ctaHref: link('Button link'), tone: select('Style', ['accent', 'subtle']) },
  defaults: () => ({ heading: L('Ready to talk?'), body: {}, ctaLabel: L('Contact us'), ctaHref: '', tone: 'accent' }),
  render: ({ props, ctx, level, sectionId }) => (
    <section id={sectionId} className={`s-section s-cta s-cta-${str(props.tone)}`}><div className="s-wrap s-narrow">
      <Heading level={level} text={t(ctx, lt(props.heading))} />
      <Text ctx={ctx} value={lt(props.body)} className="s-lead" />
      <div className="s-actions"><Button ctx={ctx} label={lt(props.ctaLabel)} href={str(props.ctaHref)} variant={str(props.tone) === 'accent' ? 'secondary' : 'primary'} /></div>
    </div></section>
  ),
});

const linkList = def({
  type: 'linkList', version: 1, label: 'Links', category: 'content', leadsPage: false,
  description: 'A list of labelled links (carried over from the earlier Links block).',
  props: { heading: text('Heading', 120), links: list('Links', 12, { label: text('Label', 60, { required: true }), href: link('Link', true) }, 'Link') },
  defaults: () => ({ heading: L('Links'), links: [] }),
  render: ({ props, ctx, level, sectionId }) => (
    <section id={sectionId} className="s-section"><div className="s-wrap s-narrow">
      <Heading level={level} text={t(ctx, lt(props.heading))} />
      <ul className="s-links">
        {arr(props.links).map((l, i) => <li key={i}><a href={resolveHref(ctx, str(l.href))} {...externalRel(str(l.href))}>{t(ctx, lt(l.label))}</a></li>)}
      </ul>
    </div></section>
  ),
});

const logoStrip = def({
  type: 'logoStrip', version: 1, label: 'Logo strip', category: 'media', leadsPage: false,
  description: 'A row of partner or client logos, optionally linked.',
  props: { heading: text('Heading', 120), logos: list('Logos', 16, { image: image('Logo', true), href: link('Link') }, 'Logo') },
  defaults: () => ({ heading: {}, logos: [] }),
  render: ({ props, ctx, level, sectionId }) => (
    <section id={sectionId} className="s-section"><div className="s-wrap">
      <Heading level={level} text={t(ctx, lt(props.heading))} className="s-center s-muted" />
      <ul className="s-logos">
        {arr(props.logos).map((l, i) => {
          const img = <Img ctx={ctx} media={media(l.image)} sizes="160px" />;
          return <li key={i}>{str(l.href) ? <a href={resolveHref(ctx, str(l.href))} {...externalRel(str(l.href))}>{img}</a> : img}</li>;
        })}
      </ul>
    </div></section>
  ),
});

// ---- data ------------------------------------------------------------------------
function fieldValue(ctx: RenderContext, field: CollectionField | undefined, item: SiteCollectionItem): string {
  if (!field) return '';
  const raw = item.values[field.key];
  switch (field.kind) {
    case 'text': return t(ctx, lt(raw));
    case 'richtext': return markdownToText(t(ctx, lt(raw)));
    case 'number': return typeof raw === 'number' ? new Intl.NumberFormat(ctx.locale).format(raw) : '';
    case 'date': return typeof raw === 'string' && raw ? new Intl.DateTimeFormat(ctx.locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${raw}T00:00:00Z`)) : '';
    case 'boolean': return raw === true ? '✓' : '';
    case 'select': return typeof raw === 'string' ? raw : '';
    default: return '';
  }
}

function sortItems(collection: SiteCollection, items: SiteCollectionItem[], ctx: RenderContext): SiteCollectionItem[] {
  const copy = [...items];
  if (collection.sort === 'dateDesc') copy.sort((a, b) => String(b.values[collection.sortField] ?? '').localeCompare(String(a.values[collection.sortField] ?? '')));
  else if (collection.sort === 'titleAsc') copy.sort((a, b) => t(ctx, lt(a.values[collection.titleField])).localeCompare(t(ctx, lt(b.values[collection.titleField])), ctx.locale));
  else copy.sort((a, b) => a.order - b.order);
  return copy;
}

const collectionList = def({
  type: 'collectionList', version: 1, label: 'Collection list', category: 'data', leadsPage: false,
  description: 'Published items of a content collection as cards or a list, linking to their detail pages.',
  props: {
    heading: text('Heading', 120), collection: { kind: 'collection', label: 'Collection', required: true },
    layout: select('Layout', ['cards', 'list']), limit: { kind: 'number', label: 'Show at most', min: 1, max: 50, integer: true },
    summaryField: { kind: 'key', label: 'Summary field' }, imageField: { kind: 'key', label: 'Image field' }, dateField: { kind: 'key', label: 'Date field' },
  },
  defaults: () => ({ heading: {}, collection: '', layout: 'cards', limit: 12, summaryField: '', imageField: '', dateField: '' }),
  render: ({ props, ctx, level, sectionId }) => {
    const collection = ctx.collections.find((c) => c.id === str(props.collection));
    if (!collection) return null;
    const items = sortItems(collection, ctx.items(collection.id).filter((i) => i.status === 'published'), ctx).slice(0, Number(props.limit) || 12);
    const field = (key: string) => collection.fields.find((f) => f.key === key);
    const title = field(collection.titleField);
    return (
      <section id={sectionId} className="s-section"><div className="s-wrap">
        <Heading level={level} text={t(ctx, lt(props.heading))} />
        {items.length === 0 ? <p className="s-muted">{ui(ctx.locale, 'empty')}</p> : (
          <ul className={str(props.layout) === 'list' ? 's-list' : 's-grid s-cols-3'}>
            {items.map((item) => {
              const name = fieldValue(ctx, title, item) || item.slug;
              const imageRef = str(props.imageField) ? media(item.values[str(props.imageField)]) : null;
              const date = fieldValue(ctx, field(str(props.dateField)), item);
              const summary = fieldValue(ctx, field(str(props.summaryField)), item);
              return (
                <li key={item.id} className={str(props.layout) === 'list' ? 's-list-item' : 's-card'}>
                  <Img ctx={ctx} media={imageRef} sizes="(min-width: 900px) 33vw, 100vw" className="s-card-img" />
                  {level === 1 ? <h2>{collection.detailPages ? <a href={itemHref(ctx, collection, item)}>{name}</a> : name}</h2> : <h3>{collection.detailPages ? <a href={itemHref(ctx, collection, item)}>{name}</a> : name}</h3>}
                  {date ? <p className="s-muted s-small">{date}</p> : null}
                  {summary ? <p>{summary.length > 240 ? `${summary.slice(0, 237)}…` : summary}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div></section>
    );
  },
});

const collectionItem = def({
  type: 'collectionItem', version: 1, label: 'Collection item', category: 'data', leadsPage: true,
  description: 'One item with all its fields. On a detail page it shows the item in the URL; elsewhere the item named here.',
  props: { collection: { kind: 'collection', label: 'Collection', required: true }, itemSlug: text('Item slug (outside detail pages)', 64) },
  defaults: () => ({ collection: '', itemSlug: {} }),
  render: ({ props, ctx, level, sectionId }) => {
    const current = ctx.currentItem && (str(props.collection) === '' || ctx.currentItem.collection.id === str(props.collection)) ? ctx.currentItem : null;
    let collection = current?.collection;
    let item = current?.item;
    if (!current) {
      collection = ctx.collections.find((c) => c.id === str(props.collection));
      const slug = t(ctx, lt(props.itemSlug));
      item = collection ? ctx.items(collection.id).find((i) => i.slug === slug && i.status === 'published') : undefined;
    }
    if (!collection || !item) return null;
    const title = collection.fields.find((f) => f.key === collection.titleField);
    return (
      <article id={sectionId} className="s-section s-item"><div className="s-wrap s-narrow">
        <Heading level={level} text={fieldValue(ctx, title, item) || item.slug} />
        {collection.fields.filter((f) => f.key !== collection.titleField).map((f) => {
          const raw = item.values[f.key];
          if (f.kind === 'richtext') return <Rich key={f.key} ctx={ctx} value={lt(raw)} />;
          if (f.kind === 'media') return <Img key={f.key} ctx={ctx} media={media(raw)} sizes="(min-width: 900px) 720px, 100vw" className="s-media" />;
          if (f.kind === 'link') return typeof raw === 'string' && raw ? <p key={f.key}><a href={resolveHref(ctx, raw)} {...externalRel(raw)}>{t(ctx, f.label)}</a></p> : null;
          const value = fieldValue(ctx, f, item);
          return value ? <p key={f.key}><span className="s-muted">{t(ctx, f.label)}: </span>{value}</p> : null;
        })}
      </div></article>
    );
  },
});

const productShowcase = def({
  type: 'productShowcase', version: 1, label: 'Product showcase', category: 'data', leadsPage: false,
  description: "Live names, summaries and prices from this workspace's Storefront. Display only, no checkout.",
  props: { heading: text('Heading', 120) },
  defaults: () => ({ heading: L('From the shop') }),
  render: ({ props, ctx, level, sectionId }) => (
    <section id={sectionId} className="s-section"><div className="s-wrap">
      <Heading level={level} text={t(ctx, lt(props.heading))} />
      {ctx.products.length === 0 ? <p className="s-muted">{ui(ctx.locale, 'empty')}</p> : (
        <ul className="s-grid s-cols-3">
          {ctx.products.map((p) => (
            <li key={p.id} className="s-card">
              {level === 1 ? <h2>{p.title}</h2> : <h3>{p.title}</h3>}
              {p.category ? <p className="s-muted s-small">{p.category}</p> : null}
              {p.summary ? <p>{p.summary}</p> : null}
              <p className="s-price">{ctx.formatPrice(p.priceCents)}</p>
            </li>
          ))}
        </ul>
      )}
    </div></section>
  ),
});

// ---- forms -----------------------------------------------------------------------
function FormFieldInput({ ctx, field, sectionId }: { ctx: RenderContext; field: SiteFormField; sectionId: string }) {
  const id = `${sectionId}-${field.id}`;
  const name = `f_${field.id}`;
  const label = t(ctx, field.label);
  const help = t(ctx, field.help);
  const helpId = help ? `${id}-help` : undefined;
  const common = { id, name, required: field.required, ...(helpId ? { 'aria-describedby': helpId } : {}) };
  const labelNode = <label htmlFor={id}>{label}{field.required ? <span className="s-muted"> ({ui(ctx.locale, 'required')})</span> : null}</label>;
  const helpNode = help ? <small id={helpId} className="s-muted">{help}</small> : null;
  switch (field.kind) {
    case 'textarea':
      return <div className="s-field">{labelNode}<textarea {...common} rows={5} maxLength={5000} />{helpNode}</div>;
    case 'select':
      return <div className="s-field">{labelNode}<select {...common} defaultValue=""><option value="" disabled={field.required}>—</option>{field.options.map((o) => <option key={o.value} value={o.value}>{t(ctx, o.label) || o.value}</option>)}</select>{helpNode}</div>;
    case 'multiselect':
      return (
        <fieldset className="s-field" {...(helpId ? { 'aria-describedby': helpId } : {})}>
          <legend>{label}{field.required ? <span className="s-muted"> ({ui(ctx.locale, 'required')})</span> : null}</legend>
          {field.options.map((o, i) => <label key={o.value} className="s-check"><input type="checkbox" name={name} value={o.value} id={`${id}-${i}`} /> {t(ctx, o.label) || o.value}</label>)}
          {helpNode}
        </fieldset>
      );
    case 'checkbox':
    case 'consent':
      return <div className="s-field"><label className="s-check" htmlFor={id}><input type="checkbox" {...common} value="on" /> {label}{field.required ? <span className="s-muted"> ({ui(ctx.locale, 'required')})</span> : null}</label>{helpNode}</div>;
    default: {
      const type = field.kind === 'phone' ? 'tel' : field.kind === 'text' ? 'text' : field.kind;
      const auto = field.kind === 'email' ? 'email' : field.kind === 'phone' ? 'tel' : undefined;
      return <div className="s-field">{labelNode}<input {...common} type={type} {...(auto ? { autoComplete: auto } : {})} {...(field.kind === 'text' ? { maxLength: 500 } : field.kind === 'number' ? { step: 'any' } : {})} />{helpNode}</div>;
    }
  }
}

export const DEFAULT_CONTACT_FIELDS: SiteFormField[] = [
  { id: 'name', kind: 'text', label: { en: 'Name', de: 'Name', sk: 'Meno', hu: 'Név', es: 'Nombre' }, help: {}, required: true, options: [] },
  { id: 'email', kind: 'email', label: { en: 'Email', de: 'E-Mail', sk: 'E-mail', hu: 'E-mail', es: 'Correo electrónico' }, help: {}, required: true, options: [] },
  { id: 'message', kind: 'textarea', label: { en: 'Message', de: 'Nachricht', sk: 'Správa', hu: 'Üzenet', es: 'Mensaje' }, help: {}, required: true, options: [] },
];

const contactForm = def({
  type: 'contactForm', version: 1, label: 'Contact form', category: 'forms', leadsPage: true,
  description: 'A form whose answers are stored in Rodrigo and can notify a Messenger channel and connected Relay routes. Works without JavaScript; spam is filtered with a hidden field, a minimum fill time and rate limits.',
  props: {
    heading: text('Heading', 120), intro: text('Intro', 500, { multiline: true }),
    fields: { kind: 'formFields', label: 'Fields' }, submitLabel: text('Submit label', 40), successMessage: text('Success message', 300),
    notifyChannelId: { kind: 'channel', label: 'Post submissions to Messenger channel', help: 'Leave empty to skip Messenger.' },
    notifyRelay: bool('Send submissions to connected Relay routes'),
  },
  defaults: () => ({ heading: L('Contact'), intro: {}, fields: DEFAULT_CONTACT_FIELDS.map((f) => ({ ...f })), submitLabel: {}, successMessage: {}, notifyChannelId: '', notifyRelay: false }),
  render: ({ props, ctx, level, sectionId }) => {
    const fields = arr(props.fields) as unknown as SiteFormField[];
    const state = ctx.form.state?.sectionId === sectionId ? ctx.form.state : undefined;
    const success = t(ctx, lt(props.successMessage)) || ui(ctx.locale, 'sent');
    const statusId = `${sectionId}-status`;
    return (
      <section id={sectionId} className="s-section"><div className="s-wrap s-narrow">
        <Heading level={level} text={t(ctx, lt(props.heading))} />
        <Text ctx={ctx} value={lt(props.intro)} className="s-lead" />
        <div id={statusId} role="status" className="s-form-status">
          {state?.kind === 'sent' ? <p className="s-ok">{success}</p> : null}
          {state?.kind === 'error' ? <p className="s-err">{ui(ctx.locale, state.code === 'rate_limited' ? 'busy' : 'failed')}</p> : null}
        </div>
        {state?.kind === 'sent' ? null : (
          <form className="s-form" method="post" action={ctx.form.action(sectionId)} aria-describedby={statusId}>
            <input type="hidden" name="_t" value={ctx.form.token} />
            <input type="hidden" name="_l" value={ctx.locale} />
            <div className="s-hp" aria-hidden="true"><label htmlFor={`${sectionId}-website`}>Website</label><input id={`${sectionId}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" /></div>
            {fields.map((f) => <FormFieldInput key={f.id} ctx={ctx} field={f} sectionId={sectionId} />)}
            <button type="submit" className="s-btn s-btn-primary">{t(ctx, lt(props.submitLabel)) || ui(ctx.locale, 'send')}</button>
          </form>
        )}
      </div></section>
    );
  },
});

// ---- registry --------------------------------------------------------------------
export const COMPONENTS = [
  header, hero, richText, features, imageText, gallery, team, testimonials, faq, pricing, cta,
  contactForm, collectionList, collectionItem, logoStrip, footer, linkList, productShowcase,
] as unknown as readonly ComponentDefinition[];

const BY_TYPE = new Map(COMPONENTS.map((c) => [c.type, c]));

export function getComponent(type: string): ComponentDefinition | undefined {
  return BY_TYPE.get(type);
}

export function componentDefaults(type: string): Record<string, unknown> {
  const component = BY_TYPE.get(type);
  if (!component) throw new Error(`Unknown component ${type}`);
  return { ...emptyProps(component.props), ...component.defaults() };
}

export type { MediaRef };
