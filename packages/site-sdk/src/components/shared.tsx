/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, type Child } from '../html';
import { resolveHref, t, type RenderContext } from '../context';
import type { LText } from '../locales';
import { externalRel, Markdown } from '../markdown';
import type { MediaRef } from '../schema';

export type HeadingLevel = 1 | 2;

export function Heading({ level, text, className }: { level: HeadingLevel; text: string; className?: string }) {
  if (!text) return null;
  return level === 1 ? <h1 className={className}>{text}</h1> : <h2 className={className}>{text}</h2>;
}

export function SubHeading({ level, text, className }: { level: HeadingLevel; text: string; className?: string }) {
  if (!text) return null;
  return level === 1 ? <h2 className={className}>{text}</h2> : <h3 className={className}>{text}</h3>;
}

export function Rich({ ctx, value }: { ctx: RenderContext; value: LText }) {
  const source = t(ctx, value);
  if (!source) return null;
  return <div className="s-prose"><Markdown source={source} href={(link) => resolveHref(ctx, link)} /></div>;
}

export function Text({ ctx, value, as: Tag = 'p', className }: { ctx: RenderContext; value: LText; as?: 'p' | 'span' | 'div'; className?: string }) {
  const text = t(ctx, value);
  if (!text) return null;
  return <Tag className={className}>{text}</Tag>;
}

export function Button({ ctx, label, href, variant = 'primary' }: { ctx: RenderContext; label: LText; href: string; variant?: 'primary' | 'secondary' }) {
  const text = t(ctx, label);
  if (!text || !href) return null;
  return <a className={`s-btn s-btn-${variant}`} href={resolveHref(ctx, href)} {...externalRel(href)}>{text}</a>;
}

/** Library image with intrinsic size (no layout shift). Missing media renders nothing publicly. */
export function Img({ ctx, media, sizes, priority, className }: { ctx: RenderContext; media: MediaRef | null; sizes: string; priority?: boolean; className?: string }) {
  if (!media) return null;
  const info = ctx.media(media.id);
  if (!info || !info.mimeType.startsWith('image/')) {
    return ctx.preview ? <div className={`s-img-missing ${className ?? ''}`}>Image not in the media library</div> : null;
  }
  return (
    <img
      className={className}
      src={info.url}
      alt={t(ctx, media.alt)}
      width={info.width}
      height={info.height}
      sizes={sizes}
      loading={priority ? 'eager' : 'lazy'}
      decoding={priority ? 'sync' : 'async'}
      {...(priority ? { fetchPriority: 'high' as const } : {})}
    />
  );
}

export function Section({ id, className, children, labelledBy }: { id: string; className: string; children: Child; labelledBy?: string }) {
  return <section id={id} className={`s-section ${className}`} {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}><div className="s-wrap">{children}</div></section>;
}
