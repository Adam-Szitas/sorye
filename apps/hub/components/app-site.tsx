'use client';

import {
  emptySiteBlock,
  SITE_ABOUT_MAX,
  SITE_BLOCK_LABELS,
  SITE_BLOCK_TYPES,
  SITE_CTA_LABEL_MAX,
  SITE_DISPLAY_NAME_MAX,
  SITE_HEADING_MAX,
  SITE_LINK_LABEL_MAX,
  SITE_MAX_BLOCKS,
  SITE_MAX_LINKS,
  SITE_OFFER_MAX,
  SITE_TEMPLATES,
  SITE_URL_MAX,
  siteTemplateBlocks,
  type SiteBlock,
  type SiteBlockType,
  type SiteLink,
  type SitePage,
  type SiteTemplateId,
} from '@sorye/types';
import { useEffect, useId, useState, type FormEvent } from 'react';

const FIELD_CLASS =
  'mt-1 w-full min-h-12 rounded-lg border border-white/12 bg-black/25 px-3 py-2 text-base text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#0b57d0] focus:border-[var(--color-accent)]/50';

const LABEL_CLASS = 'block text-sm font-medium text-[var(--color-text)]';
const HINT_CLASS = 'mt-1 text-xs text-[var(--color-text-muted)]';
const GHOST_BTN =
  'min-h-12 rounded-lg px-3 text-sm text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)] disabled:opacity-40';

interface EditorResponse {
  site?: SitePage;
  sharePath?: string;
  error?: string;
}

function emptyLink(): SiteLink {
  return { label: '', url: '' };
}

function patchBlock(
  blocks: SiteBlock[],
  index: number,
  next: SiteBlock,
): SiteBlock[] {
  return blocks.map((block, i) => (i === index ? next : block));
}

export function AppSite() {
  const uid = useId();
  const [site, setSite] = useState<SitePage | null>(null);
  const [sharePath, setSharePath] = useState('/s/…');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addType, setAddType] = useState<SiteBlockType>('hero');

  const nameId = `${uid}-name`;
  const publishedId = `${uid}-published`;
  const shareId = `${uid}-share`;
  const statusId = `${uid}-status`;
  const addTypeId = `${uid}-add-type`;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch('/api/site', { credentials: 'include' });
      const data = (await res.json().catch(() => ({}))) as EditorResponse;
      if (cancelled) return;
      if (!res.ok || !data.site) {
        setError(data.error ?? 'Could not load this page.');
        return;
      }
      setSite(data.site);
      setSharePath(data.sharePath ?? `/s/${data.site.slug}`);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const shareUrl =
    typeof window === 'undefined'
      ? sharePath
      : `${window.location.origin}${sharePath}`;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || !site || saving) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/site', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          published: site.published,
          displayName: site.displayName,
          blocks: site.blocks,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as EditorResponse;
      if (!res.ok || !data.site) {
        setError(data.error ?? 'Could not save this page.');
        return;
      }
      setSite(data.site);
      setSharePath(data.sharePath ?? `/s/${data.site.slug}`);
      setNotice(
        data.site.published
          ? 'Saved and published. Anyone with the link can view these sections.'
          : 'Saved. Unpublished pages return 404.',
      );
    } catch {
      setError('Could not save this page.');
    } finally {
      setSaving(false);
    }
  }

  async function copyShareUrl() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy the URL.');
    }
  }

  function applyTemplate(templateId: SiteTemplateId) {
    if (!site) return;
    setSite({
      ...site,
      blocks: siteTemplateBlocks(templateId, site.displayName),
    });
    setNotice(`Applied the ${SITE_TEMPLATES.find((t) => t.id === templateId)?.name} starter. Save to publish.`);
    setError(null);
  }

  function moveBlock(index: number, direction: -1 | 1) {
    if (!site) return;
    const next = index + direction;
    if (next < 0 || next >= site.blocks.length) return;
    const blocks = [...site.blocks];
    const [item] = blocks.splice(index, 1);
    if (!item) return;
    blocks.splice(next, 0, item);
    setSite({ ...site, blocks });
  }

  function removeBlock(index: number) {
    if (!site) return;
    setSite({ ...site, blocks: site.blocks.filter((_, i) => i !== index) });
  }

  function addBlock() {
    if (!site || site.blocks.length >= SITE_MAX_BLOCKS) return;
    setSite({ ...site, blocks: [...site.blocks, emptySiteBlock(addType)] });
  }

  function updateBlock(index: number, next: SiteBlock) {
    if (!site) return;
    setSite({ ...site, blocks: patchBlock(site.blocks, index, next) });
  }

  if (!site) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--color-text-muted)]">
        {error ?? 'Loading…'}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4 sm:p-6">
      <form
        action="/api/site"
        method="POST"
        className="mx-auto flex w-full max-w-2xl flex-col gap-6"
        onSubmit={onSubmit}
      >
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Site</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Build sections, then publish one URL. Visitors only see the blocks
            you include — never Reports, Mail, members, or orders.
          </p>
        </header>

        <div
          id={statusId}
          className="min-h-5 text-sm"
          aria-live="polite"
          role="status"
        >
          {error ? <p className="text-red-300">{error}</p> : null}
          {notice ? <p className="text-emerald-300">{notice}</p> : null}
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor={nameId}>
            Page title
          </label>
          <input
            id={nameId}
            name="displayName"
            type="text"
            required
            maxLength={SITE_DISPLAY_NAME_MAX}
            autoComplete="organization"
            className={FIELD_CLASS}
            value={site.displayName}
            onChange={(event) =>
              setSite({ ...site, displayName: event.target.value })
            }
            aria-describedby={`${nameId}-hint`}
          />
          <p id={`${nameId}-hint`} className={HINT_CLASS}>
            Browser title and fallback heading. Up to {SITE_DISPLAY_NAME_MAX}{' '}
            characters.
          </p>
        </div>

        <fieldset>
          <legend className={LABEL_CLASS}>Starters</legend>
          <p className={HINT_CLASS}>
            Replaces the current section list. Save to keep the change.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {SITE_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className="min-h-12 rounded-xl border border-white/12 px-3 py-2 text-left text-sm transition hover:bg-white/8"
                onClick={() => applyTemplate(template.id)}
              >
                <span className="font-medium">{template.name}</span>
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                  {template.summary}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className={LABEL_CLASS}>Sections</legend>
          <p className={HINT_CLASS}>
            Add, reorder, or remove. Public page shows these in order. Up to{' '}
            {SITE_MAX_BLOCKS}.
          </p>

          {site.blocks.map((block, index) => (
            <BlockEditor
              key={block.id}
              uid={`${uid}-b-${index}`}
              block={block}
              index={index}
              total={site.blocks.length}
              onChange={(next) => updateBlock(index, next)}
              onMove={(dir) => moveBlock(index, dir)}
              onRemove={() => removeBlock(index)}
            />
          ))}

          {site.blocks.length < SITE_MAX_BLOCKS ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label className={LABEL_CLASS} htmlFor={addTypeId}>
                  Add a section
                </label>
                <select
                  id={addTypeId}
                  name="addBlockType"
                  className={FIELD_CLASS}
                  value={addType}
                  onChange={(event) =>
                    setAddType(event.target.value as SiteBlockType)
                  }
                >
                  {SITE_BLOCK_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {SITE_BLOCK_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="min-h-12 rounded-lg border border-white/12 px-4 text-sm text-[var(--color-text-muted)] transition hover:bg-white/8 hover:text-[var(--color-text)]"
                onClick={addBlock}
              >
                Add section
              </button>
            </div>
          ) : null}
        </fieldset>

        <div className="flex items-start gap-3">
          <input
            id={publishedId}
            name="published"
            type="checkbox"
            className="mt-1 size-5 accent-[var(--color-accent)]"
            checked={site.published}
            onChange={(event) =>
              setSite({ ...site, published: event.target.checked })
            }
            aria-describedby={`${publishedId}-hint`}
          />
          <div>
            <label className={LABEL_CLASS} htmlFor={publishedId}>
              Published
            </label>
            <p id={`${publishedId}-hint`} className={HINT_CLASS}>
              When on, anyone with the URL can see these sections. Off returns
              404.
            </p>
          </div>
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor={shareId}>
            Share URL
          </label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input
              id={shareId}
              name="shareUrl"
              type="url"
              readOnly
              className={FIELD_CLASS}
              value={shareUrl}
              aria-describedby={`${shareId}-hint`}
            />
            <button
              type="button"
              className="min-h-12 shrink-0 rounded-lg bg-white/10 px-4 text-sm transition hover:bg-white/15"
              onClick={() => void copyShareUrl()}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p id={`${shareId}-hint`} className={HINT_CLASS}>
            Slug is assigned from this workspace name plus a stable id suffix.
          </p>
        </div>

        <button
          type="submit"
          className="min-h-12 rounded-xl bg-[var(--color-accent)] px-4 text-sm font-medium text-[var(--color-surface)] transition hover:brightness-110 disabled:opacity-60"
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save page'}
        </button>
      </form>
    </div>
  );
}

function BlockEditor({
  uid,
  block,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  uid: string;
  block: SiteBlock;
  index: number;
  total: number;
  onChange: (block: SiteBlock) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <fieldset className="rounded-xl border border-white/8 p-3">
      <legend className="px-1 text-sm font-medium">
        {SITE_BLOCK_LABELS[block.type]}
      </legend>
      <div className="mb-3 flex flex-wrap gap-1">
        <button
          type="button"
          className={GHOST_BTN}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          Up
        </button>
        <button
          type="button"
          className={GHOST_BTN}
          disabled={index === total - 1}
          onClick={() => onMove(1)}
        >
          Down
        </button>
        <button type="button" className={GHOST_BTN} onClick={onRemove}>
          Remove
        </button>
      </div>
      {block.type === 'hero' ? (
        <HeroFields uid={uid} block={block} onChange={onChange} />
      ) : null}
      {block.type === 'about' ? (
        <AboutFields uid={uid} block={block} onChange={onChange} />
      ) : null}
      {block.type === 'links' ? (
        <LinksFields uid={uid} block={block} onChange={onChange} />
      ) : null}
      {block.type === 'storefront' ? (
        <StorefrontFields uid={uid} block={block} onChange={onChange} />
      ) : null}
      {block.type === 'contact' ? (
        <ContactFields uid={uid} block={block} onChange={onChange} />
      ) : null}
    </fieldset>
  );
}

function HeroFields({
  uid,
  block,
  onChange,
}: {
  uid: string;
  block: Extract<SiteBlock, { type: 'hero' }>;
  onChange: (block: SiteBlock) => void;
}) {
  const headingId = `${uid}-heading`;
  const offerId = `${uid}-offer`;
  const ctaLabelId = `${uid}-cta-label`;
  const ctaHrefId = `${uid}-cta-href`;
  const imageId = `${uid}-image`;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className={LABEL_CLASS} htmlFor={headingId}>
          Heading
        </label>
        <input
          id={headingId}
          name={`${uid}-heading`}
          type="text"
          maxLength={SITE_HEADING_MAX}
          className={FIELD_CLASS}
          value={block.heading}
          onChange={(event) =>
            onChange({ ...block, heading: event.target.value })
          }
        />
      </div>
      <div>
        <label className={LABEL_CLASS} htmlFor={offerId}>
          Offer
        </label>
        <input
          id={offerId}
          name={`${uid}-offer`}
          type="text"
          maxLength={SITE_OFFER_MAX}
          className={FIELD_CLASS}
          value={block.offer}
          onChange={(event) => onChange({ ...block, offer: event.target.value })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL_CLASS} htmlFor={ctaLabelId}>
            Button label
          </label>
          <input
            id={ctaLabelId}
            name={`${uid}-cta-label`}
            type="text"
            maxLength={SITE_CTA_LABEL_MAX}
            className={FIELD_CLASS}
            value={block.ctaLabel}
            onChange={(event) =>
              onChange({ ...block, ctaLabel: event.target.value })
            }
          />
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor={ctaHrefId}>
            Button link
          </label>
          <input
            id={ctaHrefId}
            name={`${uid}-cta-href`}
            type="text"
            maxLength={SITE_URL_MAX}
            className={FIELD_CLASS}
            value={block.ctaHref}
            onChange={(event) =>
              onChange({ ...block, ctaHref: event.target.value })
            }
            aria-describedby={`${ctaHrefId}-hint`}
          />
          <p id={`${ctaHrefId}-hint`} className={HINT_CLASS}>
            https, /contact, mailto:, or #shop.
          </p>
        </div>
      </div>
      <div>
        <label className={LABEL_CLASS} htmlFor={imageId}>
          Image URL
        </label>
        <input
          id={imageId}
          name={`${uid}-image`}
          type="url"
          maxLength={SITE_URL_MAX}
          inputMode="url"
          placeholder="https://"
          className={FIELD_CLASS}
          value={block.imageUrl ?? ''}
          onChange={(event) =>
            onChange({ ...block, imageUrl: event.target.value })
          }
          aria-describedby={`${imageId}-hint`}
        />
        <p id={`${imageId}-hint`} className={HINT_CLASS}>
          Optional. HTTPS only — skipped if the URL is not safe.
        </p>
      </div>
    </div>
  );
}

function AboutFields({
  uid,
  block,
  onChange,
}: {
  uid: string;
  block: Extract<SiteBlock, { type: 'about' }>;
  onChange: (block: SiteBlock) => void;
}) {
  const textId = `${uid}-text`;
  return (
    <div>
      <label className={LABEL_CLASS} htmlFor={textId}>
        About
      </label>
      <textarea
        id={textId}
        name={`${uid}-text`}
        maxLength={SITE_ABOUT_MAX}
        rows={6}
        className={`${FIELD_CLASS} min-h-28 resize-y`}
        value={block.text}
        onChange={(event) => onChange({ ...block, text: event.target.value })}
        aria-describedby={`${textId}-hint`}
      />
      <p id={`${textId}-hint`} className={HINT_CLASS}>
        Plain text, line breaks kept. Up to {SITE_ABOUT_MAX} characters. No
        HTML.
      </p>
    </div>
  );
}

function LinksFields({
  uid,
  block,
  onChange,
}: {
  uid: string;
  block: Extract<SiteBlock, { type: 'links' }>;
  onChange: (block: SiteBlock) => void;
}) {
  const headingId = `${uid}-heading`;

  function updateLink(index: number, patch: Partial<SiteLink>) {
    onChange({
      ...block,
      links: block.links.map((link, i) =>
        i === index ? { ...link, ...patch } : link,
      ),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className={LABEL_CLASS} htmlFor={headingId}>
          Heading
        </label>
        <input
          id={headingId}
          name={`${uid}-heading`}
          type="text"
          maxLength={SITE_HEADING_MAX}
          className={FIELD_CLASS}
          value={block.heading ?? ''}
          onChange={(event) =>
            onChange({ ...block, heading: event.target.value })
          }
        />
      </div>
      {block.links.map((link, index) => {
        const labelId = `${uid}-link-${index}-label`;
        const urlId = `${uid}-link-${index}-url`;
        return (
          <div
            key={`${uid}-link-${index}`}
            className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"
          >
            <div>
              <label className={LABEL_CLASS} htmlFor={labelId}>
                Label {index + 1}
              </label>
              <input
                id={labelId}
                name={`${uid}-link-${index}-label`}
                type="text"
                maxLength={SITE_LINK_LABEL_MAX}
                className={FIELD_CLASS}
                value={link.label}
                onChange={(event) =>
                  updateLink(index, { label: event.target.value })
                }
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor={urlId}>
                URL {index + 1}
              </label>
              <input
                id={urlId}
                name={`${uid}-link-${index}-url`}
                type="url"
                maxLength={SITE_URL_MAX}
                inputMode="url"
                placeholder="https://"
                className={FIELD_CLASS}
                value={link.url}
                onChange={(event) =>
                  updateLink(index, { url: event.target.value })
                }
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                className={GHOST_BTN}
                onClick={() =>
                  onChange({
                    ...block,
                    links: block.links.filter((_, i) => i !== index),
                  })
                }
              >
                Remove
              </button>
            </div>
          </div>
        );
      })}
      {block.links.length < SITE_MAX_LINKS ? (
        <button
          type="button"
          className="min-h-12 self-start rounded-lg border border-white/12 px-3 text-sm text-[var(--color-text-muted)] transition hover:bg-white/8 hover:text-[var(--color-text)]"
          onClick={() =>
            onChange({ ...block, links: [...block.links, emptyLink()] })
          }
        >
          Add link
        </button>
      ) : null}
    </div>
  );
}

function StorefrontFields({
  uid,
  block,
  onChange,
}: {
  uid: string;
  block: Extract<SiteBlock, { type: 'storefront' }>;
  onChange: (block: SiteBlock) => void;
}) {
  const headingId = `${uid}-heading`;
  return (
    <div>
      <label className={LABEL_CLASS} htmlFor={headingId}>
        Heading
      </label>
      <input
        id={headingId}
        name={`${uid}-heading`}
        type="text"
        maxLength={SITE_HEADING_MAX}
        className={FIELD_CLASS}
        value={block.heading ?? ''}
        onChange={(event) =>
          onChange({ ...block, heading: event.target.value })
        }
        aria-describedby={`${headingId}-hint`}
      />
      <p id={`${headingId}-hint`} className={HINT_CLASS}>
        Shows this workspace’s product names and prices. Orders stay in Hub.
      </p>
    </div>
  );
}

function ContactFields({
  uid,
  block,
  onChange,
}: {
  uid: string;
  block: Extract<SiteBlock, { type: 'contact' }>;
  onChange: (block: SiteBlock) => void;
}) {
  const headingId = `${uid}-heading`;
  const ctaLabelId = `${uid}-cta`;
  const modeId = `${uid}-mode`;
  const emailId = `${uid}-email`;
  const isMailto = block.href.startsWith('mailto:');
  const emailValue = isMailto ? block.href.slice('mailto:'.length) : '';

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className={LABEL_CLASS} htmlFor={headingId}>
          Heading
        </label>
        <input
          id={headingId}
          name={`${uid}-heading`}
          type="text"
          maxLength={SITE_HEADING_MAX}
          className={FIELD_CLASS}
          value={block.heading ?? ''}
          onChange={(event) =>
            onChange({ ...block, heading: event.target.value })
          }
        />
      </div>
      <div>
        <label className={LABEL_CLASS} htmlFor={ctaLabelId}>
          Button label
        </label>
        <input
          id={ctaLabelId}
          name={`${uid}-cta`}
          type="text"
          maxLength={SITE_CTA_LABEL_MAX}
          className={FIELD_CLASS}
          value={block.ctaLabel}
          onChange={(event) =>
            onChange({ ...block, ctaLabel: event.target.value })
          }
        />
      </div>
      <fieldset>
        <legend className={LABEL_CLASS}>Button opens</legend>
        <div className="mt-2 flex flex-col gap-2">
          <label className="flex min-h-12 items-center gap-2 text-sm">
            <input
              id={modeId}
              name={`${uid}-mode`}
              type="radio"
              className="size-4 accent-[var(--color-accent)]"
              checked={!isMailto}
              onChange={() => onChange({ ...block, href: '/contact' })}
            />
            Contact page (/contact)
          </label>
          <label className="flex min-h-12 items-center gap-2 text-sm">
            <input
              name={`${uid}-mode`}
              type="radio"
              className="size-4 accent-[var(--color-accent)]"
              checked={isMailto}
              onChange={() =>
                onChange({
                  ...block,
                  href: emailValue ? `mailto:${emailValue}` : 'mailto:',
                })
              }
            />
            Email (mailto)
          </label>
        </div>
      </fieldset>
      {isMailto ? (
        <div>
          <label className={LABEL_CLASS} htmlFor={emailId}>
            Public email
          </label>
          <input
            id={emailId}
            name={`${uid}-email`}
            type="email"
            maxLength={120}
            autoComplete="email"
            inputMode="email"
            className={FIELD_CLASS}
            value={emailValue}
            onChange={(event) =>
              onChange({ ...block, href: `mailto:${event.target.value}` })
            }
          />
        </div>
      ) : null}
    </div>
  );
}
