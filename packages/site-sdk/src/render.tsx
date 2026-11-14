/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import { Fragment, h, renderToString } from './html';
// Keep the JSX factory imports alive: Turbopack elides imports it sees as unused
// before it applies the classic JSX transform, leaving `h is not defined` at runtime.
void h; void Fragment;
/** Server rendering to a complete static HTML document. No client JavaScript is emitted. */
import { createHash } from 'node:crypto';
import { t, ui, type RenderContext } from './context';
import type { SiteLocale } from './locales';
import { getComponent } from './registry';
import type { SiteSection } from './model';
import { SITE_CSS } from './styles';
import { resolveTheme, themeCss } from './theme';
import { validateSection } from './validate';

export interface DocumentMeta {
  title: string;
  description: string;
  /** Absolute self-canonical URL. */
  canonical: string;
  alternates: Array<{ locale: SiteLocale | 'x-default'; href: string }>;
  socialImageUrl?: string;
  faviconUrl?: string;
  noindex?: boolean;
  status?: 200 | 404;
}

export interface RenderedDocument {
  html: string;
  /** CSP source expressions for the inline styles, e.g. `'sha256-…'`. */
  styleHashes: string[];
  /** Section ids whose stored props failed validation and were skipped. */
  skipped: string[];
}

function hash(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Renders sections; invalid stored sections are skipped, never rendered with unvalidated props. */
export function renderSections(sections: SiteSection[], ctx: RenderContext, leadingTitle: string): { markup: string; skipped: string[] } {
  const skipped: string[] = [];
  const valid = sections.filter((s) => {
    const ok = validateSection(s).length === 0;
    if (!ok) skipped.push(String((s as { id?: unknown }).id ?? '?'));
    return ok;
  });
  const isChrome = (s: SiteSection) => s.type === 'header' || s.type === 'footer';
  let start = 0;
  while (start < valid.length && valid[start]!.type === 'header') start += 1;
  let end = valid.length;
  while (end > start && valid[end - 1]!.type === 'footer') end -= 1;
  const leadIndex = valid.slice(start, end).findIndex((s) => !isChrome(s) && getComponent(s.type)!.leadsPage);
  const leadsWithHeading = leadIndex === 0;
  const render = (s: SiteSection, level: 1 | 2) => {
    const component = getComponent(s.type)!;
    return component.render({ props: s.props, ctx, sectionId: s.id, level });
  };
  const tree = (
    <>
      {valid.slice(0, start).map((s) => <>{render(s, 2)}</>)}
      <main id="main" tabIndex={-1}>
        {leadsWithHeading ? null : <h1 className="s-sr">{leadingTitle}</h1>}
        {valid.slice(start, end).map((s, i) => <>{render(s, leadsWithHeading && i === 0 ? 1 : 2)}</>)}
      </main>
      {valid.slice(end).map((s) => <>{render(s, 2)}</>)}
    </>
  );
  return { markup: renderToString(tree), skipped };
}

export function renderDocument(ctx: RenderContext, sections: SiteSection[], meta: DocumentMeta): RenderedDocument {
  const theme = themeCss(resolveTheme(ctx.settings.theme));
  const styles = [theme, SITE_CSS];
  const { markup, skipped } = renderSections(sections, ctx, meta.title);
  const langs = ctx.settings.locales.length > 1
    ? renderToString(
      <nav className="s-langs" aria-label={ui(ctx.locale, 'language')}>
        {meta.alternates.filter((a) => a.locale !== 'x-default').map((a) => (
          <a key={a.locale} href={a.href} lang={a.locale} hrefLang={a.locale} {...(a.locale === ctx.locale ? { 'aria-current': 'true' as const } : {})}>{a.locale.toUpperCase()}</a>
        ))}
      </nav>,
    )
    : '';
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeAttr(meta.title)}</title>`,
    meta.description ? `<meta name="description" content="${escapeAttr(meta.description)}">` : '',
    `<link rel="canonical" href="${escapeAttr(meta.canonical)}">`,
    ...meta.alternates.map((a) => `<link rel="alternate" hreflang="${a.locale}" href="${escapeAttr(a.href)}">`),
    `<meta property="og:title" content="${escapeAttr(meta.title)}">`,
    `<meta property="og:url" content="${escapeAttr(meta.canonical)}">`,
    '<meta property="og:type" content="website">',
    meta.description ? `<meta property="og:description" content="${escapeAttr(meta.description)}">` : '',
    meta.socialImageUrl ? `<meta property="og:image" content="${escapeAttr(meta.socialImageUrl)}">` : '',
    meta.faviconUrl ? `<link rel="icon" href="${escapeAttr(meta.faviconUrl)}">` : '',
    meta.noindex || ctx.preview ? '<meta name="robots" content="noindex, nofollow">' : '',
    `<meta name="theme-color" content="${resolveTheme(ctx.settings.theme).colors.background}">`,
    ...styles.map((css) => `<style>${css}</style>`),
  ].filter(Boolean).join('');
  const banner = ctx.preview ? `<div class="s-preview" role="note">${escapeAttr(ui(ctx.locale, 'preview'))}</div>` : '';
  const skip = `<a class="s-skip" href="#main">${escapeAttr(ui(ctx.locale, 'skip'))}</a>`;
  const html = `<!doctype html><html lang="${ctx.locale}"><head>${head}</head><body>${skip}${banner}${langs}${markup}</body></html>`;
  return { html, styleHashes: styles.map(hash), skipped };
}

/** Content-Security-Policy for a rendered page: no scripts at all, hashed inline styles, own-origin images. */
export function siteCsp(styleHashes: string[], formAction = "'self'"): string {
  return [
    "default-src 'none'",
    "script-src 'none'",
    `style-src ${styleHashes.join(' ')}`,
    "img-src 'self'",
    `form-action ${formAction}`,
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
  ].join('; ');
}

export function pageTitle(ctx: RenderContext): string {
  const own = ctx.page ? t(ctx, ctx.page.seo.title) || t(ctx, ctx.page.title) : '';
  const site = t(ctx, ctx.settings.seo.title) || ctx.settings.name;
  return own && own !== site ? `${own} · ${site}` : site;
}
