import { formatStorefrontPrice, type SiteBlock, type SitePublicPage } from '@sorye/types';
import Link from 'next/link';
import type { ReactNode } from 'react';

function isHttpImage(url: string | undefined): url is string {
  return Boolean(url && url.startsWith('https://'));
}

function BlockImage({ src, alt }: { src: string; alt: string }) {
  return (
    // User-supplied https URL already checked with assertSafePublicHttpsUrl.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="mt-6 w-full max-h-72 rounded-2xl object-cover"
      loading="lazy"
      decoding="async"
    />
  );
}

function CtaLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className: string;
}) {
  if (href === '/contact') {
    return (
      <Link href="/contact" className={className}>
        {children}
      </Link>
    );
  }
  if (href.startsWith('mailto:') || href.startsWith('#')) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

const CTA_CLASS =
  'inline-flex min-h-12 items-center rounded-xl bg-[var(--color-accent)] px-5 text-sm font-medium text-[var(--color-surface)] transition hover:brightness-110';

function HeroBlock({ block }: { block: Extract<SiteBlock, { type: 'hero' }> }) {
  return (
    <section className="flex flex-col">
      {block.heading ? (
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          {block.heading}
        </h1>
      ) : null}
      {block.offer ? (
        <p className="mt-3 text-pretty text-base text-[var(--color-text-muted)]">
          {block.offer}
        </p>
      ) : null}
      {block.ctaLabel && block.ctaHref ? (
        <p className="mt-6">
          <CtaLink href={block.ctaHref} className={CTA_CLASS}>
            {block.ctaLabel}
          </CtaLink>
        </p>
      ) : null}
      {isHttpImage(block.imageUrl) ? (
        <BlockImage src={block.imageUrl} alt="" />
      ) : null}
    </section>
  );
}

function AboutBlock({ block }: { block: Extract<SiteBlock, { type: 'about' }> }) {
  return (
    <section>
      <p className="whitespace-pre-wrap text-pretty text-sm leading-relaxed text-[var(--color-text)]">
        {block.text}
      </p>
    </section>
  );
}

function LinksBlock({ block }: { block: Extract<SiteBlock, { type: 'links' }> }) {
  if (block.links.length === 0) return null;
  return (
    <section>
      {block.heading ? (
        <h2 className="text-lg font-semibold tracking-tight">{block.heading}</h2>
      ) : null}
      <ul className={`${block.heading ? 'mt-3' : ''} flex flex-col gap-2 text-sm`}>
        {block.links.map((link) => (
          <li key={`${link.label}:${link.url}`}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-accent)] underline-offset-2 hover:underline"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StorefrontBlock({
  block,
  products,
}: {
  block: Extract<SiteBlock, { type: 'storefront' }>;
  products: SitePublicPage['products'];
}) {
  return (
    <section id="shop" className="@container">
      <h2 className="text-lg font-semibold tracking-tight">
        {block.heading || 'From the shop'}
      </h2>
      {products.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          No products listed for this workspace yet.
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-3">
          {products.map((product) => (
            <li key={product.id}>
              <article className="surface flex h-full flex-col rounded-2xl p-4">
                <span
                  className="mb-3 block h-12 rounded-xl"
                  style={{
                    background: `linear-gradient(135deg, ${product.accent}cc, ${product.accent}55)`,
                  }}
                  aria-hidden
                />
                <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  {product.category}
                </p>
                <h3 className="mt-1 text-sm font-semibold">{product.title}</h3>
                {product.summary ? (
                  <p className="mt-1 line-clamp-3 flex-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
                    {product.summary}
                  </p>
                ) : null}
                <p className="mt-3 text-sm font-medium text-[var(--color-accent)]">
                  {formatStorefrontPrice(product.priceCents)}
                </p>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ContactBlock({ block }: { block: Extract<SiteBlock, { type: 'contact' }> }) {
  return (
    <section className="rounded-2xl border border-white/8 p-5">
      {block.heading ? (
        <h2 className="text-lg font-semibold tracking-tight">{block.heading}</h2>
      ) : null}
      <p className={block.heading ? 'mt-4' : ''}>
        <CtaLink href={block.href || '/contact'} className={CTA_CLASS}>
          {block.ctaLabel || 'Contact'}
        </CtaLink>
      </p>
    </section>
  );
}

export function SitePublicView({ page }: { page: SitePublicPage }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="glass flex shrink-0 items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-[var(--color-text)]"
        >
          Sorye
        </Link>
        <Link
          href="/login"
          className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
        >
          Sign in
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 sm:py-14">
        {page.blocks.map((block) => {
          switch (block.type) {
            case 'hero':
              return <HeroBlock key={block.id} block={block} />;
            case 'about':
              return <AboutBlock key={block.id} block={block} />;
            case 'links':
              return <LinksBlock key={block.id} block={block} />;
            case 'storefront':
              return (
                <StorefrontBlock
                  key={block.id}
                  block={block}
                  products={page.products}
                />
              );
            case 'contact':
              return <ContactBlock key={block.id} block={block} />;
            default:
              return null;
          }
        })}
      </main>
    </div>
  );
}
