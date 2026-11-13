'use client';

import { useI18n } from '@sorye/platform/react';
import type { MessageKey } from '@sorye/platform';
import {
  COMPONENTS, componentDefaults, DEFAULT_CONTACT_FIELDS, getComponent, isPageSlug, isSiteLocale, resolveTheme, SITE_LOCALES, SITE_MODEL_LIMITS,
  THEME_COLOR_TOKENS, THEME_PRESET_IDS, themeContrastIssues, validatePage, validateSettings,
  type CmsPage, type NavPlacement, type SiteLocale, type SiteSection, type SiteSettings,
} from '@sorye/site-sdk';
import { useEffect, useMemo, useState } from 'react';
import { BTN, FIELD, HINT, LABEL, LocaleSwitch, LTextInput, PRIMARY, PropsEditor, type EditorEnv, type Issues } from './field-editor';
import { CollectionsPanel, FormsPanel, MediaPanel } from './site-cms-data';
import { newId, nowIso, useSiteCms, type SaveOutcome } from './use-site-cms';

type Tab = 'pages' | 'collections' | 'media' | 'forms' | 'settings' | 'publish';
const TABS: Array<[Tab, MessageKey]> = [
  ['pages', 'site.tabPages'], ['collections', 'site.tabCollections'], ['media', 'site.tabMedia'],
  ['forms', 'site.tabForms'], ['settings', 'site.tabSettings'], ['publish', 'site.tabPublish'],
];

export type Notify = (outcome: SaveOutcome | { ok: false; kind: 'invalid' }) => void;

export function SiteCms() {
  const { t, locale: uiLocale } = useI18n();
  const cms = useSiteCms();
  const [tab, setTab] = useState<Tab>('pages');
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [locale, setLocale] = useState<SiteLocale>('en');
  const [channels, setChannels] = useState<Array<{ id: string; name: string }>>([]);
  const data = cms.data;
  const settings = data?.drafts.settings?.value ?? null;

  useEffect(() => {
    if (settings && !settings.locales.includes(locale)) setLocale(settings.defaultLocale);
  }, [settings, locale]);
  useEffect(() => {
    if (!data?.canEdit) return;
    void fetch('/api/site/channels', { credentials: 'include' }).then((r) => r.ok ? r.json() : { channels: [] }).then((b: { channels?: Array<{ id: string; name: string }> }) => setChannels(b.channels ?? [])).catch(() => undefined);
  }, [data?.canEdit]);

  const notify: Notify = (outcome) => {
    if (outcome.ok) { setStatus({ tone: 'ok', text: t('site.saved') }); void cms.reload(); return; }
    const text = outcome.kind === 'invalid' ? t('site.invalid')
      : outcome.kind === 'conflict' ? t('site.conflict')
        : outcome.kind === 'rejected' ? t('site.rejected', { code: outcome.code ?? '?' })
          : t('site.saveFailed');
    setStatus({ tone: 'error', text });
  };

  if (!data) {
    return <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--color-text-muted)]">{cms.loadError ? t('site.loadFailed') : t('site.loading')}</div>;
  }
  const env: EditorEnv = {
    locale, locales: settings?.locales ?? [locale],
    media: data.drafts.media.map((m) => m.value), collections: data.drafts.collections.map((c) => c.value),
    channels, readOnly: !data.canEdit,
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t('site.title')}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('site.intro')}</p>
            {!data.canEdit ? <p className="mt-1 text-sm text-amber-200">{t('site.readOnly')}</p> : null}
          </div>
          <LocaleSwitch env={env} onChange={setLocale} />
        </header>
        <div role="status" aria-live="polite" className="min-h-5 text-sm">
          {status ? <p className={status.tone === 'ok' ? 'text-emerald-300' : 'text-red-300'}>{status.text} {status.tone === 'error' ? <button type="button" className="underline" onClick={() => void cms.reload()}>{t('site.reload')}</button> : null}</p> : null}
          {cms.pending > 0 ? <p className="text-amber-200">{t('site.pending', { n: cms.pending })} <button type="button" className="underline" onClick={() => void cms.flush()}>{t('site.retry')}</button> <button type="button" className="ml-2 underline" onClick={() => void cms.discardRefused()}>{t('site.discard')}</button></p> : null}
        </div>
        {!settings ? (
          <SetupPanel data={data} uiLocale={isSiteLocale(uiLocale) ? uiLocale : 'en'} save={cms.save} notify={notify} />
        ) : (
          <>
            <nav aria-label={t('site.title')}>
              <ul role="tablist" className="flex flex-wrap gap-1 border-b border-white/10">
                {TABS.map(([id, key]) => (
                  <li key={id} role="presentation">
                    <button type="button" role="tab" id={`site-tab-${id}`} aria-selected={tab === id} aria-controls={`site-panel-${id}`}
                      className={`min-h-11 px-3 text-sm ${tab === id ? 'border-b-2 border-[var(--color-accent)] font-medium' : 'text-[var(--color-text-muted)]'}`} onClick={() => setTab(id)}>{t(key)}</button>
                  </li>
                ))}
              </ul>
            </nav>
            <section role="tabpanel" id={`site-panel-${tab}`} aria-labelledby={`site-tab-${tab}`}>
              {tab === 'pages' ? <PagesPanel data={data} env={env} save={cms.save} notify={notify} /> : null}
              {tab === 'collections' ? <CollectionsPanel data={data} env={env} save={cms.save} notify={notify} /> : null}
              {tab === 'media' ? <MediaPanel data={data} env={env} save={cms.save} notify={notify} /> : null}
              {tab === 'forms' ? <FormsPanel data={data} env={env} save={cms.save} notify={notify} /> : null}
              {tab === 'settings' ? <SettingsPanel data={data} env={env} save={cms.save} notify={notify} /> : null}
              {tab === 'publish' ? <PublishPanel data={data} env={env} save={cms.save} notify={notify} /> : null}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export interface PanelProps {
  data: NonNullable<ReturnType<typeof useSiteCms>['data']>;
  env: EditorEnv;
  save: ReturnType<typeof useSiteCms>['save'];
  notify: Notify;
}

function starterPage(locale: SiteLocale, name: string): CmsPage {
  const l = (text: string) => ({ [locale]: text });
  const section = (id: string, type: string, props: Record<string, unknown> = {}): SiteSection => ({ id, type, version: 1, props: { ...componentDefaults(type), ...props } });
  return {
    id: 'home', slug: 'home', title: l(name), nav: 'none', order: 0, seo: { title: {}, description: {} }, updatedAt: nowIso(),
    sections: [
      section('header', 'header', { brand: l(name) }),
      section('hero', 'hero', { heading: l(name), ctaLabel: l('Contact'), ctaHref: '#contact' }),
      section('about', 'richText', { heading: l('About'), body: l('Tell visitors who you are and what you offer.') }),
      section('contact', 'contactForm', { fields: DEFAULT_CONTACT_FIELDS.map((f) => ({ ...f })) }),
      section('footer', 'footer', { copyright: l(`© ${name}`) }),
    ],
  };
}

function SetupPanel({ data, uiLocale, save, notify }: { data: PanelProps['data']; uiLocale: SiteLocale; save: PanelProps['save']; notify: Notify }) {
  const { t } = useI18n();
  const legacy = data.drafts.legacy;
  const fallbackSlug = (data.workspace.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'site') + `-${data.workspace.id.replace(/[^a-z0-9]/gi, '').slice(-6).toLowerCase()}`;
  const [name, setName] = useState(legacy?.settings.name ?? data.workspace.name);
  const [slug, setSlug] = useState(legacy?.slug ?? fallbackSlug);
  const [busy, setBusy] = useState(false);
  const start = async (fromLegacy: boolean) => {
    const page = fromLegacy && legacy ? legacy.page : starterPage(uiLocale, name);
    const settings: SiteSettings = fromLegacy && legacy
      ? { ...legacy.settings, name, slug, updatedAt: nowIso() }
      : { id: 'site', slug, name, theme: { preset: 'paper', overrides: {} }, logo: null, favicon: null, socialImage: null, defaultLocale: uiLocale, locales: [uiLocale], seo: { title: {}, description: {} }, homePageId: 'home', updatedAt: nowIso() };
    if (validatePage(page).length || validateSettings(settings).length) { notify({ ok: false, kind: 'invalid' }); return; }
    setBusy(true);
    const pageResult = await save('cmsPage', page.id, 0, page as never);
    notify(pageResult.ok ? await save('settings', 'site', 0, settings as never) : pageResult);
    setBusy(false);
  };
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-white/10 p-4">
      <h2 className="text-lg font-semibold">{t('site.startTitle')}</h2>
      <p className="text-sm text-[var(--color-text-muted)]">{t('site.startIntro')}</p>
      <label className={LABEL}>{t('site.siteName')}<input className={FIELD} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} disabled={!data.canEdit} /></label>
      <label className={LABEL}>{t('site.siteSlug')}<input className={FIELD} value={slug} maxLength={64} onChange={(e) => setSlug(e.target.value.toLowerCase())} disabled={!data.canEdit} aria-describedby="site-slug-help" /><span id="site-slug-help" className={HINT}>/s/{slug} · {t('site.slugHelp')}</span></label>
      {legacy ? (
        <div className="rounded-lg border border-white/10 p-3">
          <button type="button" className={PRIMARY} disabled={busy || !data.canEdit} onClick={() => void start(true)}>{t('site.startConvert')}</button>
          <p className={HINT}>{t('site.startConvertHelp')}</p>
          <ul className="mt-2 list-disc pl-5 text-sm text-amber-200">
            {legacy.notes.map((note, i) => (
              <li key={i}>{note.kind === 'externalImage' ? t('site.noteExternalImage', { url: note.url }) : note.kind === 'droppedLink' ? t('site.noteDroppedLink', { url: note.url }) : t('site.noteContactForm')}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div><button type="button" className={legacy ? BTN : PRIMARY} disabled={busy || !data.canEdit} onClick={() => void start(false)}>{t('site.startBlank')}</button></div>
    </section>
  );
}

function PagesPanel({ data, env, save, notify }: PanelProps) {
  const { t } = useI18n();
  const pages = data.drafts.pages;
  const [selected, setSelected] = useState<string>(pages[0]?.value.id ?? '');
  const current = pages.find((p) => p.value.id === selected) ?? pages[0];
  const [draft, setDraft] = useState<CmsPage | null>(current?.value ?? null);
  const [issues, setIssues] = useState<Issues>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [addType, setAddType] = useState('richText');
  useEffect(() => { setDraft(current?.value ?? null); setIssues([]); }, [current?.value]);
  const home = data.drafts.settings?.value.homePageId;

  const addPage = async () => {
    const id = newId('p');
    const page: CmsPage = { id, slug: `page-${pages.length + 1}`, title: { [env.locale]: t('site.newPage') }, nav: 'header', order: pages.length, seo: { title: {}, description: {} }, sections: [], updatedAt: nowIso() };
    const result = await save('cmsPage', id, 0, page as never);
    notify(result);
    if (result.ok) setSelected(id);
  };
  const savePage = async () => {
    if (!draft || !current) return;
    const next = { ...draft, updatedAt: nowIso() };
    const problems = validatePage(next);
    setIssues(problems.map((i) => ({ path: i.path.replace(/^page\.sections\[(\d+)\]/, (_m, n) => `s${n}`), code: i.code })));
    if (problems.length) { notify({ ok: false, kind: 'invalid' }); return; }
    notify(await save('cmsPage', next.id, current.revision, next as never));
  };
  const removePage = async () => {
    if (!current || current.value.id === home) return;
    if (!window.confirm(t('site.confirmDelete', { name: current.value.slug }))) return;
    notify(await save('cmsPage', current.value.id, current.revision, null));
  };
  const setSections = (sections: SiteSection[]) => draft && setDraft({ ...draft, sections });

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-[14rem_1fr]">
      <aside>
        <h2 className="text-sm font-semibold">{t('site.pagesHeading')}</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {pages.map(({ value: p }) => (
            <li key={p.id}><button type="button" aria-current={p.id === current?.value.id} className={`w-full min-h-11 rounded-lg px-3 text-left text-sm ${p.id === current?.value.id ? 'bg-white/10' : 'hover:bg-white/5'}`} onClick={() => setSelected(p.id)}>{p.title[env.locale] || p.slug}{p.id === home ? ` · ${t('site.home')}` : ''}</button></li>
          ))}
        </ul>
        <button type="button" className={`${BTN} mt-2 w-full`} disabled={env.readOnly || pages.length >= SITE_MODEL_LIMITS.pages} onClick={() => void addPage()}>{t('site.newPage')}</button>
      </aside>
      {draft ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>{t('site.pageTitle')}<LTextInput id="page-title" value={draft.title} max={120} env={env} onChange={(title) => setDraft({ ...draft, title })} /></label>
            <label className={LABEL}>{t('site.pageSlug')}<input className={FIELD} value={draft.slug} disabled={env.readOnly || draft.id === home} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })} aria-invalid={!isPageSlug(draft.slug)} /><span className={HINT}>{t('site.slugHelp')}</span></label>
            <label className={LABEL}>{t('site.nav')}
              <select className={FIELD} value={draft.nav} disabled={env.readOnly} onChange={(e) => setDraft({ ...draft, nav: e.target.value as NavPlacement })}>
                <option value="header">{t('site.navHeader')}</option><option value="footer">{t('site.navFooter')}</option><option value="both">{t('site.navBoth')}</option><option value="none">{t('site.navNone')}</option>
              </select>
            </label>
            <label className={LABEL}>{t('site.order')}<input className={FIELD} type="number" min={0} max={10000} value={draft.order} disabled={env.readOnly} onChange={(e) => setDraft({ ...draft, order: Math.max(0, Math.min(10000, Math.round(Number(e.target.value)))) })} /></label>
            <label className={LABEL}>{t('site.seoTitle')}<LTextInput id="page-seo-title" value={draft.seo.title} max={120} env={env} onChange={(title) => setDraft({ ...draft, seo: { ...draft.seo, title } })} /></label>
            <label className={LABEL}>{t('site.seoDescription')}<LTextInput id="page-seo-desc" value={draft.seo.description} max={300} env={env} multiline onChange={(description) => setDraft({ ...draft, seo: { ...draft.seo, description } })} /></label>
          </div>
          <h3 className="text-sm font-semibold">{t('site.sections')} <span className="font-normal text-[var(--color-text-muted)]">{t('site.sectionCount', { n: draft.sections.length, max: SITE_MODEL_LIMITS.sectionsPerPage })}</span></h3>
          <ol className="flex flex-col gap-2">
            {draft.sections.map((section, i) => {
              const def = getComponent(section.type);
              const isOpen = open === section.id;
              const move = (d: -1 | 1) => { const next = [...draft.sections]; const j = i + d; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j]!, next[i]!]; setSections(next); };
              return (
                <li key={section.id} className="rounded-lg border border-white/10 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-auto text-sm font-medium">{def?.label ?? section.type}{issues.some((x) => x.path.startsWith(`s${i}.`) || x.path === `s${i}`) ? ' ⚠' : ''}</span>
                    <button type="button" className={BTN} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : section.id)}>{isOpen ? t('site.close') : t('site.edit')}</button>
                    <button type="button" className={BTN} disabled={env.readOnly || i === 0} onClick={() => move(-1)}>{t('site.moveUp')}</button>
                    <button type="button" className={BTN} disabled={env.readOnly || i === draft.sections.length - 1} onClick={() => move(1)}>{t('site.moveDown')}</button>
                    <button type="button" className={BTN} disabled={env.readOnly} onClick={() => setSections(draft.sections.filter((_, j) => j !== i))}>{t('site.remove')}</button>
                  </div>
                  {isOpen && def ? (
                    <div className="mt-3">
                      <p className={HINT}>{def.description}</p>
                      <PropsEditor spec={def.props} props={section.props} env={env} issues={issues} path={`s${i}.props`}
                        onChange={(props) => setSections(draft.sections.map((s, j) => (j === i ? { ...s, props } : s)))} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-end gap-2">
            <label className={LABEL}>{t('site.addSection')}
              <select className={FIELD} value={addType} disabled={env.readOnly} onChange={(e) => setAddType(e.target.value)}>
                {COMPONENTS.map((c) => <option key={c.type} value={c.type}>{c.label}</option>)}
              </select>
            </label>
            <button type="button" className={BTN} disabled={env.readOnly || draft.sections.length >= SITE_MODEL_LIMITS.sectionsPerPage}
              onClick={() => { const id = newId('s'); setSections([...draft.sections, { id, type: addType, version: getComponent(addType)!.version, props: componentDefaults(addType) }]); setOpen(id); }}>{t('site.add')}</button>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
            <button type="button" className={PRIMARY} disabled={env.readOnly} onClick={() => void savePage()}>{t('site.save')}</button>
            <a className={`${BTN} inline-flex items-center`} href={`/api/site/preview/${env.locale}/${draft.id === home ? '' : draft.slug}`} target="_blank" rel="noopener">{t('site.preview')}</a>
            <button type="button" className={BTN} disabled={env.readOnly || draft.id === home} onClick={() => void removePage()}>{t('site.delete')}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SettingsPanel({ data, env, save, notify }: PanelProps) {
  const { t } = useI18n();
  const current = data.drafts.settings!;
  const [draft, setDraft] = useState<SiteSettings>(current.value);
  useEffect(() => setDraft(current.value), [current.value]);
  const contrast = useMemo(() => themeContrastIssues(resolveTheme(draft.theme)), [draft.theme]);
  const tokens = resolveTheme(draft.theme).colors;
  const media = (key: 'logo' | 'favicon' | 'socialImage', label: MessageKey) => (
    <PropsEditor spec={{ [key]: { kind: 'media', accept: 'image', label: t(label) } }} props={{ [key]: draft[key] }} env={env} issues={[]} path="settings"
      onChange={(p) => setDraft({ ...draft, [key]: p[key] as never })} />
  );
  const submit = async () => {
    const next = { ...draft, updatedAt: nowIso() };
    if (validateSettings(next).length) { notify({ ok: false, kind: 'invalid' }); return; }
    notify(await save('settings', 'site', current.revision, next as never));
  };
  return (
    <div className="mt-4 flex max-w-2xl flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('site.settingsHeading')}</h2>
      <label className={LABEL}>{t('site.siteName')}<input className={FIELD} value={draft.name} maxLength={120} disabled={env.readOnly} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label className={LABEL}>{t('site.siteSlug')}<input className={FIELD} value={draft.slug} maxLength={64} disabled={env.readOnly} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })} /><span className={HINT}>/s/{draft.slug}</span></label>
      <fieldset className="rounded-lg border border-white/10 p-3">
        <legend className="px-1 text-sm font-medium">{t('site.locales')}</legend>
        <div className="flex flex-wrap gap-3">
          {SITE_LOCALES.map((l) => (
            <label key={l} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" disabled={env.readOnly || l === draft.defaultLocale} checked={draft.locales.includes(l)}
                onChange={(e) => setDraft({ ...draft, locales: e.target.checked ? [...draft.locales, l] : draft.locales.filter((x) => x !== l) })} />{l.toUpperCase()}
            </label>
          ))}
        </div>
        <label className={`${LABEL} mt-2`}>{t('site.defaultLocale')}
          <select className={FIELD} value={draft.defaultLocale} disabled={env.readOnly} onChange={(e) => { const l = e.target.value as SiteLocale; setDraft({ ...draft, defaultLocale: l, locales: draft.locales.includes(l) ? draft.locales : [...draft.locales, l] }); }}>
            {draft.locales.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </label>
      </fieldset>
      <label className={LABEL}>{t('site.homePage')}
        <select className={FIELD} value={draft.homePageId} disabled={env.readOnly} onChange={(e) => setDraft({ ...draft, homePageId: e.target.value })}>
          {data.drafts.pages.map(({ value: p }) => <option key={p.id} value={p.id}>{p.title[env.locale] || p.slug}</option>)}
        </select>
      </label>
      <fieldset className="rounded-lg border border-white/10 p-3">
        <legend className="px-1 text-sm font-medium">{t('site.theme')}</legend>
        <select className={FIELD} value={draft.theme.preset} disabled={env.readOnly} onChange={(e) => setDraft({ ...draft, theme: { preset: e.target.value as SiteSettings['theme']['preset'], overrides: {} } })}>
          {THEME_PRESET_IDS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <p className="mt-3 text-sm">{t('site.colors')}</p>
        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {THEME_COLOR_TOKENS.map((token) => (
            <label key={token} className="flex items-center gap-2 text-sm">
              <input type="color" value={tokens[token]} disabled={env.readOnly} onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, overrides: { ...draft.theme.overrides, colors: { ...draft.theme.overrides.colors, [token]: e.target.value.toLowerCase() } } } })} />{token}
            </label>
          ))}
        </div>
        {contrast.map((c) => <p key={`${c.fg}${c.bg}`} className="mt-1 text-xs text-red-300">{t('site.contrastFail', { pair: `${c.fg}/${c.bg}`, ratio: c.ratio, min: c.min })}</p>)}
      </fieldset>
      {media('logo', 'site.logo')}
      {media('favicon', 'site.favicon')}
      {media('socialImage', 'site.socialImage')}
      <label className={LABEL}>{t('site.seoTitle')}<LTextInput id="site-seo-title" value={draft.seo.title} max={120} env={{ ...env, locales: draft.locales }} onChange={(title) => setDraft({ ...draft, seo: { ...draft.seo, title } })} /></label>
      <label className={LABEL}>{t('site.seoDescription')}<LTextInput id="site-seo-desc" value={draft.seo.description} max={300} multiline env={{ ...env, locales: draft.locales }} onChange={(description) => setDraft({ ...draft, seo: { ...draft.seo, description } })} /></label>
      <div><button type="button" className={PRIMARY} disabled={env.readOnly || contrast.length > 0} onClick={() => void submit()}>{t('site.save')}</button></div>
    </div>
  );
}

function PublishPanel({ data, env, save, notify }: PanelProps) {
  const { t, locale } = useI18n();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const settings = data.drafts.settings!.value;
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const publish = async (restoreOf: string | null) => {
    setBusy(true);
    const id = newId('r');
    notify(await save('publish', id, 0, { id, note: restoreOf ? '' : note.slice(0, 200), restoreOf, createdAt: nowIso() }));
    setBusy(false);
    setNote('');
  };
  const kept = data.drafts.publishes.filter((p) => p.value.restoreOf === null);
  return (
    <div className="mt-4 flex max-w-2xl flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('site.publishHeading')}</h2>
      <p className="text-sm text-[var(--color-text-muted)]">{t('site.publishIntro')}</p>
      <p className="text-sm">{data.live ? t('site.liveVersion', { id: data.live.revisionId, date: date(data.live.publishedAt) }) : t('site.notPublished')}</p>
      <div className="flex flex-wrap gap-2">
        <a className={`${BTN} inline-flex items-center`} href={`/api/site/preview/${settings.defaultLocale}/`} target="_blank" rel="noopener">{t('site.preview')}</a>
        {data.live ? <a className={`${BTN} inline-flex items-center`} href={`/s/${settings.slug}`} target="_blank" rel="noopener">{t('site.openPublic')}</a> : null}
      </div>
      <label className={LABEL}>{t('site.publishNote')}<input className={FIELD} value={note} maxLength={200} disabled={env.readOnly} onChange={(e) => setNote(e.target.value.replace(/[\r\n]/g, ' '))} /></label>
      <div><button type="button" className={PRIMARY} disabled={env.readOnly || busy} onClick={() => void publish(null)}>{t('site.publishNow')}</button></div>
      <h3 className="text-sm font-semibold">{t('site.history')}</h3>
      <ul className="flex flex-col gap-2">
        {kept.slice(0, 20).map(({ value: r }) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 p-2 text-sm">
            <span className="mr-auto">{date(r.createdAt)} · {r.id}{r.note ? ` · ${r.note}` : ''}{data.live?.revisionId === r.id ? ' ✓' : ''}</span>
            <button type="button" className={BTN} disabled={env.readOnly || busy || data.live?.revisionId === r.id} onClick={() => void publish(r.id)}>{t('site.restore')}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
