'use client';

import { useI18n } from '@sorye/platform/react';
import {
  COLLECTION_FIELD_KINDS, collectionFieldSpec, isFieldKey, isPageSlug, MEDIA_MAX_ITEMS, MEDIA_TYPES, SITE_MODEL_LIMITS, textFor, validateCollection, validateItem,
  type CollectionField, type SiteCollection, type SiteCollectionItem, type SiteMedia, type SiteSubmission,
} from '@sorye/site-sdk';
import { useEffect, useRef, useState } from 'react';
import { enqueueUploads } from '@/lib/upload-queue';
import { BTN, FIELD, FieldInput, HINT, LABEL, LTextInput, PRIMARY, type Issues } from './field-editor';
import type { PanelProps } from './site-cms';
import { newId, nowIso } from './use-site-cms';

export const SITE_MEDIA_UPLOADED_EVENT = 'sorye:site:media-uploaded';

// ---- collections ---------------------------------------------------------------------
export function CollectionsPanel({ data, env, save, notify }: PanelProps) {
  const { t } = useI18n();
  const collections = data.drafts.collections;
  const [selected, setSelected] = useState(collections[0]?.value.id ?? '');
  const current = collections.find((c) => c.value.id === selected) ?? collections[0];
  const [draft, setDraft] = useState<SiteCollection | null>(current?.value ?? null);
  useEffect(() => setDraft(current?.value ?? null), [current?.value]);

  const create = async () => {
    const id = newId('c');
    const collection: SiteCollection = {
      id, slug: `collection-${collections.length + 1}`, name: { [env.locale]: t('site.newCollection') }, titleField: 'title', sort: 'manual', sortField: '', detailPages: true, updatedAt: nowIso(),
      fields: [{ key: 'title', label: { [env.locale]: 'Title' }, kind: 'text', required: true, options: [] }, { key: 'body', label: { [env.locale]: 'Text' }, kind: 'richtext', required: false, options: [] }],
    };
    const result = await save('collection', id, 0, collection as never);
    notify(result);
    if (result.ok) setSelected(id);
  };
  const submit = async () => {
    if (!draft || !current) return;
    const next = { ...draft, updatedAt: nowIso() };
    if (validateCollection(next).length) { notify({ ok: false, kind: 'invalid' }); return; }
    notify(await save('collection', next.id, current.revision, next as never));
  };
  const remove = async () => {
    if (!current || !window.confirm(t('site.confirmDelete', { name: current.value.slug }))) return;
    notify(await save('collection', current.value.id, current.revision, null));
  };
  const setField = (i: number, patch: Partial<CollectionField>) => draft && setDraft({ ...draft, fields: draft.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-[14rem_1fr]">
      <aside>
        <h2 className="text-sm font-semibold">{t('site.collectionsHeading')}</h2>
        <p className={HINT}>{t('site.collectionsIntro')}</p>
        <ul className="mt-2 flex flex-col gap-1">
          {collections.map(({ value: c }) => (
            <li key={c.id}><button type="button" aria-current={c.id === current?.value.id} className={`w-full min-h-11 rounded-lg px-3 text-left text-sm ${c.id === current?.value.id ? 'bg-white/10' : 'hover:bg-white/5'}`} onClick={() => setSelected(c.id)}>{textFor(c.name, env.locale, env.locales[0] ?? 'en') || c.slug}</button></li>
          ))}
        </ul>
        <button type="button" className={`${BTN} mt-2 w-full`} disabled={env.readOnly || collections.length >= SITE_MODEL_LIMITS.collections} onClick={() => void create()}>{t('site.newCollection')}</button>
      </aside>
      {draft && current ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>{t('site.collectionName')}<LTextInput id="col-name" value={draft.name} max={80} env={env} onChange={(name) => setDraft({ ...draft, name })} /></label>
            <label className={LABEL}>{t('site.pageSlug')}<input className={FIELD} value={draft.slug} disabled={env.readOnly} aria-invalid={!isPageSlug(draft.slug)} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })} /></label>
            <label className={LABEL}>{t('site.titleField')}
              <select className={FIELD} value={draft.titleField} disabled={env.readOnly} onChange={(e) => setDraft({ ...draft, titleField: e.target.value })}>
                {draft.fields.filter((f) => f.kind === 'text').map((f) => <option key={f.key} value={f.key}>{f.key}</option>)}
              </select>
            </label>
            <label className={LABEL}>{t('site.sort')}
              <select className={FIELD} value={draft.sort} disabled={env.readOnly} onChange={(e) => {
                const sort = e.target.value as SiteCollection['sort'];
                setDraft({ ...draft, sort, sortField: sort === 'dateDesc' ? draft.fields.find((f) => f.kind === 'date')?.key ?? '' : '' });
              }}>
                <option value="manual">{t('site.sortManual')}</option><option value="dateDesc">{t('site.sortDate')}</option><option value="titleAsc">{t('site.sortTitle')}</option>
              </select>
            </label>
            {draft.sort === 'dateDesc' ? (
              <label className={LABEL}>{t('site.sortField')}
                <select className={FIELD} value={draft.sortField} disabled={env.readOnly} onChange={(e) => setDraft({ ...draft, sortField: e.target.value })}>
                  {draft.fields.filter((f) => f.kind === 'date').map((f) => <option key={f.key} value={f.key}>{f.key}</option>)}
                </select>
              </label>
            ) : null}
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.detailPages} disabled={env.readOnly} onChange={(e) => setDraft({ ...draft, detailPages: e.target.checked })} />{t('site.detailPages')}</label>
          </div>
          <fieldset className="rounded-lg border border-white/10 p-3">
            <legend className="px-1 text-sm font-medium">{t('site.fields')}</legend>
            <ol className="flex flex-col gap-3">
              {draft.fields.map((f, i) => (
                <li key={i} className="grid gap-2 sm:grid-cols-4">
                  <label className="text-sm">{t('site.fieldKey')}<input className={FIELD} value={f.key} disabled={env.readOnly} aria-invalid={!isFieldKey(f.key)} onChange={(e) => setField(i, { key: e.target.value })} /></label>
                  <label className="text-sm">{t('site.fieldLabel')}<LTextInput id={`cf-${i}`} value={f.label} max={80} env={env} onChange={(label) => setField(i, { label })} /></label>
                  <label className="text-sm">{t('site.fieldKind')}
                    <select className={FIELD} value={f.kind} disabled={env.readOnly} onChange={(e) => setField(i, { kind: e.target.value as CollectionField['kind'], options: e.target.value === 'select' ? ['A'] : [] })}>
                      {COLLECTION_FIELD_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </label>
                  <div className="flex items-end gap-2">
                    <label className="flex min-h-11 items-center gap-1 text-sm"><input type="checkbox" checked={f.required} disabled={env.readOnly} onChange={(e) => setField(i, { required: e.target.checked })} />{t('site.fieldRequired')}</label>
                    <button type="button" className={BTN} disabled={env.readOnly || draft.fields.length <= 1} onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, j) => j !== i) })}>{t('site.remove')}</button>
                  </div>
                  {f.kind === 'select' ? (
                    <label className="text-sm sm:col-span-4">{t('site.fieldOptions')}
                      <textarea className={FIELD} rows={3} disabled={env.readOnly} value={f.options.join('\n')} onChange={(e) => setField(i, { options: [...new Set(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))].slice(0, 30) })} />
                    </label>
                  ) : null}
                </li>
              ))}
            </ol>
            <button type="button" className={`${BTN} mt-2`} disabled={env.readOnly || draft.fields.length >= SITE_MODEL_LIMITS.collectionFields}
              onClick={() => setDraft({ ...draft, fields: [...draft.fields, { key: `field${draft.fields.length + 1}`, label: { [env.locale]: '' }, kind: 'text', required: false, options: [] }] })}>{t('site.add')}</button>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={env.readOnly} onClick={() => void submit()}>{t('site.save')}</button>
            <button type="button" className={BTN} disabled={env.readOnly} onClick={() => void remove()}>{t('site.delete')}</button>
          </div>
          <ItemsEditor collection={current.value} data={data} env={env} save={save} notify={notify} />
        </div>
      ) : null}
    </div>
  );
}

function emptyItemValue(field: CollectionField): unknown {
  switch (field.kind) {
    case 'text': case 'richtext': return {};
    case 'number': return null;
    case 'boolean': return false;
    case 'media': return null;
    case 'select': return field.required ? field.options[0] ?? '' : '';
    default: return '';
  }
}

function ItemsEditor({ collection, data, env, save, notify }: PanelProps & { collection: SiteCollection }) {
  const { t } = useI18n();
  const items = data.drafts.items.filter((i) => i.value.collectionId === collection.id);
  const [selected, setSelected] = useState<string | null>(null);
  const current = items.find((i) => i.value.id === selected) ?? null;
  const [draft, setDraft] = useState<SiteCollectionItem | null>(current?.value ?? null);
  const [issues, setIssues] = useState<Issues>([]);
  useEffect(() => { setDraft(current?.value ?? null); setIssues([]); }, [current?.value]);
  const create = async () => {
    const id = newId('i');
    const item: SiteCollectionItem = {
      id, collectionId: collection.id, slug: `item-${items.length + 1}`, status: 'draft', order: items.length, updatedAt: nowIso(),
      values: Object.fromEntries(collection.fields.map((f) => [f.key, f.key === collection.titleField ? { [env.locale]: t('site.newItem') } : emptyItemValue(f)])) as SiteCollectionItem['values'],
    };
    const result = await save('item', id, 0, item as never);
    notify(result);
    if (result.ok) setSelected(id);
  };
  const submit = async () => {
    if (!draft || !current) return;
    const next = { ...draft, updatedAt: nowIso() };
    const problems = validateItem(next, collection);
    setIssues(problems.map((i) => ({ path: i.path.replace(/^item\.values/, 'v'), code: i.code })));
    if (problems.length) { notify({ ok: false, kind: 'invalid' }); return; }
    notify(await save('item', next.id, current.revision, next as never));
  };
  const remove = async () => {
    if (!current || !window.confirm(t('site.confirmDelete', { name: current.value.slug }))) return;
    notify(await save('item', current.value.id, current.revision, null));
    setSelected(null);
  };
  return (
    <section className="border-t border-white/10 pt-4">
      <h3 className="text-sm font-semibold">{t('site.items')}</h3>
      <ul className="mt-2 flex flex-col gap-1">
        {items.map(({ value: i }) => (
          <li key={i.id}><button type="button" aria-current={i.id === selected} className={`w-full min-h-11 rounded-lg px-3 text-left text-sm ${i.id === selected ? 'bg-white/10' : 'hover:bg-white/5'}`} onClick={() => setSelected(i.id)}>
            {textFor(i.values[collection.titleField] as never, env.locale, env.locales[0] ?? 'en') || i.slug} · {i.status === 'published' ? t('site.statusPublished') : t('site.statusDraft')}
          </button></li>
        ))}
      </ul>
      <button type="button" className={`${BTN} mt-2`} disabled={env.readOnly || items.length >= SITE_MODEL_LIMITS.itemsPerCollection} onClick={() => void create()}>{t('site.newItem')}</button>
      {draft ? (
        <div className="mt-3 flex flex-col gap-3 rounded-lg border border-white/10 p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={LABEL}>{t('site.itemSlug')}<input className={FIELD} value={draft.slug} disabled={env.readOnly} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })} /></label>
            <label className={LABEL}>{t('site.order')}<input className={FIELD} type="number" min={0} max={100000} value={draft.order} disabled={env.readOnly} onChange={(e) => setDraft({ ...draft, order: Math.max(0, Math.round(Number(e.target.value))) })} /></label>
            <label className={LABEL}>&nbsp;
              <select className={FIELD} value={draft.status} disabled={env.readOnly} onChange={(e) => setDraft({ ...draft, status: e.target.value as SiteCollectionItem['status'] })}>
                <option value="draft">{t('site.statusDraft')}</option><option value="published">{t('site.statusPublished')}</option>
              </select>
            </label>
          </div>
          {collection.fields.map((f) => {
            const spec = collectionFieldSpec(f);
            const label = textFor(f.label, env.locale, env.locales[0] ?? 'en') || f.key;
            if (spec === 'date') {
              return <label key={f.key} className={LABEL}>{label}{f.required ? ' *' : ''}<input className={FIELD} type="date" disabled={env.readOnly} value={String(draft.values[f.key] ?? '')} onChange={(e) => setDraft({ ...draft, values: { ...draft.values, [f.key]: e.target.value } })} /></label>;
            }
            if (f.kind === 'number') {
              return <label key={f.key} className={LABEL}>{label}<input className={FIELD} type="number" disabled={env.readOnly} value={draft.values[f.key] === null ? '' : Number(draft.values[f.key])} onChange={(e) => setDraft({ ...draft, values: { ...draft.values, [f.key]: e.target.value === '' ? null : Number(e.target.value) } })} /></label>;
            }
            return <FieldInput key={f.key} spec={{ ...spec, label }} value={draft.values[f.key]} env={env} issues={issues} path={`v.${f.key}`} onChange={(v) => setDraft({ ...draft, values: { ...draft.values, [f.key]: v as never } })} />;
          })}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={env.readOnly} onClick={() => void submit()}>{t('site.save')}</button>
            <button type="button" className={BTN} disabled={env.readOnly} onClick={() => void remove()}>{t('site.delete')}</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ---- media ---------------------------------------------------------------------------
interface UploadedBody { media?: { objectId: string; name: string; contentType: string; sizeBytes: number; width: number; height: number } }

export function MediaPanel({ data, env, save, notify }: PanelProps) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const media = data.drafts.media;

  // A finished upload becomes a library entry; Rodrigo checks it against the stored object.
  useEffect(() => {
    const onDone = (event: Event) => {
      const body = (event as CustomEvent<UploadedBody>).detail;
      const m = body?.media;
      if (!m) return;
      const id = newId('m');
      const entry: SiteMedia = { id, objectId: m.objectId, name: m.name, contentType: m.contentType, sizeBytes: m.sizeBytes, width: m.width, height: m.height, alt: {}, updatedAt: nowIso() };
      void save('media', id, 0, entry as never).then(notify);
    };
    window.addEventListener(SITE_MEDIA_UPLOADED_EVENT, onDone);
    return () => window.removeEventListener(SITE_MEDIA_UPLOADED_EVENT, onDone);
  }, [save, notify]);

  const upload = (files: File[]) => {
    const accepted = files.filter((f) => MEDIA_TYPES[f.type] !== undefined && f.size <= MEDIA_TYPES[f.type]!);
    setSkipped(files.filter((f) => !accepted.includes(f)).map((f) => f.name));
    if (accepted.length === 0) return;
    const result = enqueueUploads(accepted, {
      workspaceId: data.workspace.id,
      quota: {
        maxFileBytes: Math.max(...Object.values(MEDIA_TYPES)), maxFiles: MEDIA_MAX_ITEMS, fileCount: media.length, usedBytes: 0, limitBytes: null,
        target: 'sorye', maxBatchFiles: 20, maxConcurrentUploads: 2, throttleBytesPerSecond: null,
      },
    }, { endpoint: '/api/site/media', sourceAppId: 'site', doneEvent: SITE_MEDIA_UPLOADED_EVENT });
    if (result.skipped.length) setSkipped((s) => [...s, ...result.skipped.map((x) => `${x.name} (${x.reason})`)]);
  };

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t('site.mediaHeading')}</h2>
        <p className={HINT}>{t('site.mediaIntro')}</p>
      </div>
      <div>
        <input ref={input} type="file" multiple hidden accept={Object.keys(MEDIA_TYPES).join(',')} onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <button type="button" className={PRIMARY} disabled={env.readOnly || media.length >= MEDIA_MAX_ITEMS} onClick={() => input.current?.click()}>{t('site.upload')}</button>
        {skipped.length ? <p className="mt-1 text-xs text-amber-200">{skipped.join(', ')}</p> : null}
      </div>
      {media.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">{t('site.noMedia')}</p> : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {media.map((m) => <MediaCard key={m.value.id} entry={m} env={env} save={save} notify={notify} />)}
        </ul>
      )}
    </div>
  );
}

function MediaCard({ entry, env, save, notify }: { entry: { value: SiteMedia; revision: number }; env: PanelProps['env']; save: PanelProps['save']; notify: PanelProps['notify'] }) {
  const { t } = useI18n();
  const [alt, setAlt] = useState(entry.value.alt);
  const m = entry.value;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-white/10 p-3">
      {m.contentType.startsWith('image/') ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/site/media/${m.id}`} alt={alt[env.locale] ?? ''} width={m.width} height={m.height} loading="lazy" className="h-32 w-full rounded object-cover" />
      ) : <a className="underline" href={`/api/site/media/${m.id}`} target="_blank" rel="noopener">{m.name}</a>}
      <p className="text-xs text-[var(--color-text-muted)]">{m.name} · {Math.ceil(m.sizeBytes / 1024)} KB{m.width ? ` · ${m.width}×${m.height}` : ''}</p>
      <label className="text-sm">{t('site.altText')}<LTextInput id={`alt-${m.id}`} value={alt} max={300} env={env} onChange={setAlt} /></label>
      <div className="flex gap-2">
        <button type="button" className={BTN} disabled={env.readOnly} onClick={() => void save('media', m.id, entry.revision, { ...m, alt, updatedAt: nowIso() } as never).then(notify)}>{t('site.save')}</button>
        <button type="button" className={BTN} disabled={env.readOnly} onClick={() => { if (window.confirm(t('site.confirmDelete', { name: m.name }))) void save('media', m.id, entry.revision, null).then(notify); }}>{t('site.delete')}</button>
      </div>
    </li>
  );
}

// ---- forms ---------------------------------------------------------------------------
export function FormsPanel({ data, env, save, notify }: PanelProps) {
  const { t, locale } = useI18n();
  const submissions = data.drafts.submissions;
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const state = (s: { state: string } | null) => (s ? t(s.state === 'delivered' ? 'site.deliveryDelivered' : s.state === 'failed' ? 'site.deliveryFailed' : 'site.deliveryPending') : null);
  const setStatus = (entry: { value: SiteSubmission; revision: number }, status: SiteSubmission['status']) => void save('submission', entry.value.id, entry.revision, { ...entry.value, status } as never).then(notify);
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t('site.formsHeading')}</h2>
          <p className={HINT}>{t('site.formsIntro')}</p>
        </div>
        <a className={`${BTN} inline-flex items-center`} href="/api/site/submissions/csv" download>{t('site.exportCsv')}</a>
      </div>
      {submissions.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">{t('site.noSubmissions')}</p> : (
        <ul className="flex flex-col gap-3">
          {submissions.map((entry) => {
            const s = entry.value;
            const delivery = [s.delivery.messenger ? `${t('site.deliveryMessenger')}: ${state(s.delivery.messenger)}` : null, s.delivery.relay ? `${t('site.deliveryRelay')}: ${state(s.delivery.relay)}` : null].filter(Boolean).join(' · ');
            return (
              <li key={s.id} className="rounded-lg border border-white/10 p-3">
                <p className="text-xs text-[var(--color-text-muted)]">
                  {date(s.submittedAt)} · {s.pageId}/{s.sectionId} · {s.locale.toUpperCase()} · {t(s.status === 'new' ? 'site.statusNew' : s.status === 'handled' ? 'site.statusHandled' : 'site.statusSpam')}
                </p>
                {/* Answers are plain text; React escapes them. */}
                <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
                  {Object.entries(s.answers).map(([key, value]) => (
                    <div key={key} className="contents"><dt className="text-[var(--color-text-muted)]">{key}</dt><dd className="whitespace-pre-wrap break-words">{Array.isArray(value) ? value.join(', ') : String(value)}</dd></div>
                  ))}
                </dl>
                <p className="mt-2 text-xs">{t('site.delivery')}: {delivery || t('site.deliveryOff')}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {s.status !== 'handled' ? <button type="button" className={BTN} disabled={env.readOnly} onClick={() => setStatus(entry, 'handled')}>{t('site.markHandled')}</button> : null}
                  {s.status !== 'new' ? <button type="button" className={BTN} disabled={env.readOnly} onClick={() => setStatus(entry, 'new')}>{t('site.markNew')}</button> : null}
                  {s.status !== 'spam' ? <button type="button" className={BTN} disabled={env.readOnly} onClick={() => setStatus(entry, 'spam')}>{t('site.markSpam')}</button> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
