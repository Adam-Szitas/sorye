'use client';

import { useI18n } from '@sorye/platform/react';
import { registerPendingActionFlusher, type MessageKey } from '@sorye/platform';
import { FORM_FIELD_KINDS, FORM_MAX_FIELDS, formSlugFromTitle, type FormDefinition, type FormField, type FormFieldKind } from '@sorye/types';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { FormAnswersPanel } from '@/components/forms-answers-panel';
import { FormPreview } from '@/components/form-public-view';
import {
  CARD_CLASS, DANGER_BTN, GHOST_BTN, HINT_CLASS, ICON_BTN, INPUT_CLASS, Icon, KindGlyph, LABEL_CLASS, PRIMARY_BTN,
} from '@/components/forms-ui';
import {
  FormsClient,
  formForSave,
  formIsSavable,
  newField,
  newFormDraft,
  optionsFromText,
  withFieldKind,
  type CommitResult,
  type StoredForm,
} from '@/lib/forms/forms-client';

const KIND_LABEL: Record<FormFieldKind, MessageKey> = {
  text: 'forms.kind.text', textarea: 'forms.kind.textarea', email: 'forms.kind.email', phone: 'forms.kind.phone',
  number: 'forms.kind.number', date: 'forms.kind.date', select: 'forms.kind.select', multiselect: 'forms.kind.multiselect',
  checkbox: 'forms.kind.checkbox', consent: 'forms.kind.consent',
};

/** Matches Tailwind's `xl` breakpoint, where the preview sits beside the editor. */
const WIDE_QUERY = '(min-width: 80rem)';

type LoadState = 'loading' | 'ready' | 'error';
type Tab = 'build' | 'preview' | 'answers';
const TABS: readonly Tab[] = ['build', 'preview', 'answers'];
const TAB_LABEL: Record<Tab, MessageKey> = { build: 'forms.tabBuild', preview: 'forms.tabPreview', answers: 'forms.tabAnswers' };

function formState(form: FormDefinition): { key: MessageKey; dot: string } {
  if (!form.published) return { key: 'forms.draft', dot: 'bg-slate-400' };
  return form.accepting ? { key: 'forms.published', dot: 'bg-emerald-400' } : { key: 'forms.closed', dot: 'bg-amber-400' };
}

function StatusBadge({ form }: { form: FormDefinition }) {
  const { t } = useI18n();
  const state = formState(form);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-[var(--color-text-muted)]">
      <span className={`size-1.5 rounded-full ${state.dot}`} aria-hidden="true" />
      {t(state.key)}
    </span>
  );
}

function SectionHeading({ id, title, aside }: { id: string; title: string; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <h3 id={id} className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      {aside ? <span className="ml-auto text-xs text-[var(--color-text-muted)]">{aside}</span> : null}
    </div>
  );
}

function SwitchRow({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (next: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        <p id={`${id}-help`} className="mt-0.5 text-xs text-[var(--color-text-muted)]">{help}</p>
      </div>
      <input id={id} type="checkbox" role="switch" className="ui-switch mt-0.5" aria-describedby={`${id}-help`} checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </div>
  );
}

export function AppForms() {
  const { t, locale } = useI18n();
  const uid = useId();
  const clientRef = useRef<FormsClient | null>(null);
  const [readyClient, setReadyClient] = useState<FormsClient | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [forms, setForms] = useState<StoredForm[]>([]);
  const [draft, setDraft] = useState<FormDefinition | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [tab, setTab] = useState<Tab>('build');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  // Read out by screen readers when fields are added, moved or removed.
  const [announcement, setAnnouncement] = useState('');
  const [focusFieldId, setFocusFieldId] = useState<string | null>(null);

  const saved = draft ? forms.find((item) => item.form.id === draft.id) ?? null : null;
  const revision = saved?.revision ?? 0;
  const dirty = draft !== null && (saved === null || JSON.stringify(draft) !== JSON.stringify(saved.form));

  const reload = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const listed = await client.listForms();
    setForms(listed);
    setPending(await client.pendingCount());
    setDraft((current) => {
      if (!current) return listed[0] ? structuredClone(listed[0].form) : null;
      const fresh = listed.find((item) => item.form.id === current.id);
      return fresh ? structuredClone(fresh.form) : current;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const opened = await FormsClient.open();
        if (cancelled) { opened.close(); return; }
        clientRef.current = opened;
        setReadyClient(opened);
        await opened.flush();
        if (cancelled) return;
        await reload();
        if (!cancelled) setLoadState('ready');
      } catch {
        if (!cancelled) setLoadState('error');
      }
    })();
    return () => {
      cancelled = true;
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [reload]);

  useEffect(() => {
    const flush = async () => {
      const client = clientRef.current;
      if (!client) return 0;
      await client.flush().catch(() => undefined);
      return client.pendingCount().catch(() => 0);
    };
    return registerPendingActionFlusher('forms', flush);
  }, []);

  // Unsaved edits live only in this component; ask before the tab is closed or reloaded.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // The Preview tab exists only on narrow screens; on wide screens the preview is always beside the editor.
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const sync = () => { if (query.matches) setTab((current) => (current === 'preview' ? 'build' : current)); };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  function describe(result: Extract<CommitResult, { ok: false }>): string {
    if (result.kind === 'conflict') return t('forms.conflict');
    if (result.kind === 'unconfirmed') return t('forms.saveFailed');
    return result.code === 'slug_unavailable' ? t('forms.slugTaken') : t('forms.rejected', { code: result.code });
  }

  function resetMessages() {
    setError(null);
    setNotice(null);
    setConfirmDelete(false);
  }

  function selectForm(item: StoredForm) {
    setDraft(structuredClone(item.form));
    setSlugTouched(true);
    setTab('build');
    resetMessages();
  }

  function startNew() {
    setDraft(newFormDraft(''));
    setSlugTouched(false);
    setTab('build');
    resetMessages();
  }

  function patch(change: Partial<FormDefinition>) {
    setNotice(null);
    setDraft((current) => (current ? { ...current, ...change } : current));
  }

  function patchField(index: number, next: FormField) {
    setNotice(null);
    setDraft((current) => (current ? { ...current, fields: current.fields.map((field, at) => (at === index ? next : field)) } : current));
  }

  function moveField(index: number, direction: -1 | 1) {
    if (!draft) return;
    const target = index + direction;
    if (target < 0 || target >= draft.fields.length) return;
    const fields = [...draft.fields];
    const [item] = fields.splice(index, 1);
    if (!item) return;
    fields.splice(target, 0, item);
    setDraft({ ...draft, fields });
    setAnnouncement(t('forms.announceMoved', { n: target + 1, total: fields.length }));
  }

  function addField(kind: FormFieldKind) {
    if (!draft || draft.fields.length >= FORM_MAX_FIELDS) return;
    const field = newField(kind);
    setDraft({ ...draft, fields: [...draft.fields, field] });
    setFocusFieldId(field.id);
    setAnnouncement(t('forms.announceAdded'));
  }

  function removeField(index: number) {
    if (!draft) return;
    setDraft({ ...draft, fields: draft.fields.filter((_, at) => at !== index) });
    setAnnouncement(t('forms.announceRemoved'));
  }

  const enabledTabs = TABS.filter((name) => !(name === 'answers' && revision === 0));

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    // Only tabs that are visible at this width take part in arrow-key movement.
    const visible = enabledTabs.filter((name) => document.getElementById(`${uid}-tab-${name}`)?.offsetParent !== null);
    const at = visible.indexOf(tab);
    const next = visible[(at + (event.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length];
    if (!next) return;
    event.preventDefault();
    setTab(next);
    document.getElementById(`${uid}-tab-${next}`)?.focus();
  }

  async function save() {
    const client = clientRef.current;
    if (!draft || busy) return;
    setError(null);
    setNotice(null);
    if (!client) { setError(t('forms.queueNotReady')); return; }
    const candidate = formForSave(draft, saved?.form ?? null);
    if (!formIsSavable(candidate)) { setError(t('forms.invalid')); return; }
    setBusy(true);
    try {
      const result = await client.saveForm(candidate, revision);
      if (result.ok) {
        setForms((current) => [{ form: candidate, revision: result.revision }, ...current.filter((item) => item.form.id !== candidate.id)]);
        setDraft(structuredClone(candidate));
        setSlugTouched(true);
        setNotice(candidate.published ? t('forms.saved') : t('forms.savedDraft'));
      } else {
        setError(describe(result));
      }
      setPending(await client.pendingCount());
    } catch {
      setError(t('forms.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const client = clientRef.current;
    if (!draft || !client || busy || revision === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.deleteForm(draft.id, revision);
      if (result.ok) {
        const rest = forms.filter((item) => item.form.id !== draft.id);
        setForms(rest);
        setDraft(rest[0] ? structuredClone(rest[0].form) : null);
        setConfirmDelete(false);
      } else {
        setError(describe(result));
      }
      setPending(await client.pendingCount());
    } catch {
      setError(t('forms.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function discardRefused() {
    const client = clientRef.current;
    if (!client) return;
    await client.discardRefused();
    await client.flush();
    await reload().catch(() => setError(t('forms.loadFailed')));
  }

  if (loadState !== 'ready') {
    return (
      <div className="flex flex-1 items-center justify-center p-6" role={loadState === 'error' ? 'alert' : 'status'}>
        {loadState === 'error' ? (
          <p className="flex items-center gap-2 text-sm text-red-300"><Icon.alert />{t('forms.loadFailed')}</p>
        ) : (
          <p className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
            <span className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-[var(--color-accent)] motion-reduce:animate-none" aria-hidden="true" />
            {t('forms.loading')}
          </p>
        )}
      </div>
    );
  }

  const sharePath = saved && saved.form.slug ? `/f/${saved.form.slug}` : null;
  const shareUrl = sharePath ? `${window.location.origin}${sharePath}` : null;
  const editorHidden = tab === 'preview' ? 'hidden xl:block' : '';

  return (
    <div lang={locale} className="flex min-h-0 flex-1 flex-col overflow-auto">
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4 sm:p-6 lg:flex-row lg:items-start lg:gap-8">
        {/* Form list: a horizontal strip on phones, a sidebar from `lg`. */}
        <nav className="lg:sticky lg:top-6 lg:w-64 lg:shrink-0" aria-label={t('forms.yourForms')}>
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{t('forms.yourForms')}</h1>
            <button type="button" className={`${PRIMARY_BTN} min-h-10 px-3`} onClick={startNew}>
              <Icon.plus />{t('forms.newForm')}
            </button>
          </div>
          {forms.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-white/15 p-4 text-sm text-[var(--color-text-muted)]">{t('forms.noForms')}</p>
          ) : (
            <ul className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1 lg:flex-col lg:gap-1 lg:overflow-visible">
              {forms.map((item) => {
                const active = draft?.id === item.form.id;
                const state = formState(item.form);
                return (
                  <li key={item.form.id} className="shrink-0 lg:shrink">
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      className={`group flex w-full min-w-44 items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${active ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10' : 'border-transparent hover:bg-white/5'}`}
                      onClick={() => selectForm(item)}
                    >
                      <span className={`size-2 shrink-0 rounded-full ${state.dot}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.form.title || t('forms.untitled')}</span>
                        <span className="block text-xs text-[var(--color-text-muted)]">
                          {t(state.key)} · {t('forms.questionsCount', { n: item.form.fields.length })}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <section className="min-w-0 flex-1" aria-labelledby={draft ? `${uid}-heading` : undefined}>
          {draft ? (
            <>
              <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h2 id={`${uid}-heading`} className="min-w-0 truncate text-xl font-semibold tracking-tight sm:text-2xl">{draft.title || t('forms.untitled')}</h2>
                <StatusBadge form={saved?.form ?? draft} />
                <div className="ml-auto inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1" role="tablist" aria-label={draft.title || t('forms.untitled')}>
                  {TABS.map((name) => (
                    <button
                      key={name}
                      type="button"
                      role="tab"
                      id={`${uid}-tab-${name}`}
                      aria-controls={`${uid}-panel`}
                      aria-selected={tab === name}
                      tabIndex={tab === name ? 0 : -1}
                      onKeyDown={onTabKey}
                      disabled={!enabledTabs.includes(name)}
                      className={`min-h-9 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] disabled:opacity-40 ${name === 'preview' ? 'xl:hidden' : ''} ${tab === name ? 'bg-white/12 text-[var(--color-text)] shadow-sm' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
                      onClick={() => setTab(name)}
                    >
                      {t(TAB_LABEL[name])}
                    </button>
                  ))}
                </div>
              </header>

              <div className="mt-4 flex flex-col gap-2 empty:hidden" aria-live="polite" role="status">
                {error ? <p className="flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2.5 text-sm text-red-200"><Icon.alert className="mt-0.5 size-4 shrink-0" />{error}</p> : null}
                {notice ? <p className="flex items-start gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2.5 text-sm text-emerald-200"><Icon.check className="mt-0.5 size-4 shrink-0" />{notice}</p> : null}
                {pending > 0 ? (
                  <p className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2.5 text-sm text-amber-100">
                    {t('forms.pending', { n: pending })}{' '}
                    <button type="button" className="font-medium underline underline-offset-2" onClick={() => void discardRefused()}>{t('forms.discardPending')}</button>
                  </p>
                ) : null}
              </div>

              <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`} className="mt-5">
                {tab === 'answers' && saved && readyClient ? (
                  <FormAnswersPanel key={saved.form.id} client={readyClient} form={saved.form} />
                ) : (
                  <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start xl:gap-8">
                    {tab === 'preview' ? (
                      <div className="xl:hidden">
                        <p className="mb-3 text-xs text-[var(--color-text-muted)]">{t('forms.previewNote')}</p>
                        <FormPreview form={draft} />
                      </div>
                    ) : null}
                    <form
                      className={`flex flex-col gap-5 ${editorHidden}`}
                      aria-labelledby={`${uid}-heading`}
                      onSubmit={(event) => { event.preventDefault(); void save(); }}
                    >
                      <section className={CARD_CLASS} aria-labelledby={`${uid}-details`}>
                        <SectionHeading id={`${uid}-details`} title={t('forms.sectionDetails')} />
                        <div className="flex flex-col gap-5">
                          <div>
                            <label className={LABEL_CLASS} htmlFor={`${uid}-title`}>{t('forms.fieldTitle')}</label>
                            <input
                              id={`${uid}-title`} className={`${INPUT_CLASS} mt-1.5 text-lg font-medium`} type="text" maxLength={200} required
                              placeholder={t('forms.titlePlaceholder')} value={draft.title}
                              onChange={(event) => {
                                const title = event.target.value;
                                patch(slugTouched ? { title } : { title, slug: formSlugFromTitle(title) });
                              }}
                            />
                          </div>
                          <div>
                            <label className={LABEL_CLASS} htmlFor={`${uid}-description`}>{t('forms.fieldDescription')}</label>
                            <textarea id={`${uid}-description`} className={`${INPUT_CLASS} mt-1.5 resize-y`} rows={3} maxLength={2000} value={draft.description} onChange={(event) => patch({ description: event.target.value })} />
                          </div>
                          <div>
                            <label className={LABEL_CLASS} htmlFor={`${uid}-slug`}>{t('forms.fieldSlug')}</label>
                            <div className="mt-1.5 flex min-h-11 items-stretch overflow-hidden rounded-[0.625rem] border border-white/12 bg-[var(--color-surface-overlay)] transition-colors focus-within:border-[var(--color-accent)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-[var(--color-accent)]/40 hover:border-white/20 has-[:user-invalid]:border-red-400">
                              <span className="flex max-w-[45%] shrink-0 items-center truncate border-r border-white/10 bg-white/[0.03] px-3 text-sm text-[var(--color-text-muted)]" aria-hidden="true">
                                {window.location.host}/f/
                              </span>
                              <input
                                id={`${uid}-slug`} className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-sm outline-none" type="text" maxLength={64} required value={draft.slug}
                                pattern="[a-z0-9]+(-[a-z0-9]+)*" autoComplete="off" spellCheck={false} aria-describedby={`${uid}-slug-help`}
                                onChange={(event) => { setSlugTouched(true); patch({ slug: event.target.value.toLowerCase() }); }}
                              />
                            </div>
                            <p id={`${uid}-slug-help`} className={HINT_CLASS}>{t('forms.slugHelp')}</p>
                          </div>
                        </div>
                      </section>

                      <section className={CARD_CLASS} aria-labelledby={`${uid}-questions`}>
                        <SectionHeading
                          id={`${uid}-questions`} title={t('forms.sectionQuestions')}
                          aside={`${draft.fields.length} / ${FORM_MAX_FIELDS}`}
                        />
                        {draft.fields.length === 0 ? (
                          <p className="mb-4 rounded-xl border border-dashed border-white/15 p-4 text-center text-sm text-[var(--color-text-muted)]">{t('forms.noQuestions')}</p>
                        ) : (
                          <ol className="mb-5 flex flex-col gap-3">
                            {draft.fields.map((field, index) => (
                              <li key={field.id}>
                                <FieldEditor
                                  field={field}
                                  index={index}
                                  last={index === draft.fields.length - 1}
                                  autoFocus={focusFieldId === field.id}
                                  onChange={(next) => patchField(index, next)}
                                  onMove={(direction) => moveField(index, direction)}
                                  onRemove={() => removeField(index)}
                                />
                              </li>
                            ))}
                          </ol>
                        )}
                        <AddQuestion disabled={draft.fields.length >= FORM_MAX_FIELDS} onAdd={addField} />
                      </section>

                      <section className={CARD_CLASS} aria-labelledby={`${uid}-after`}>
                        <SectionHeading id={`${uid}-after`} title={t('forms.sectionAfter')} />
                        <label className={LABEL_CLASS} htmlFor={`${uid}-success`}>{t('forms.successMessage')}</label>
                        <textarea
                          id={`${uid}-success`} className={`${INPUT_CLASS} mt-1.5 resize-y`} rows={2} maxLength={500}
                          placeholder={t('forms.successDefault')} value={draft.successMessage} onChange={(event) => patch({ successMessage: event.target.value })}
                        />
                      </section>

                      <section className={CARD_CLASS} aria-labelledby={`${uid}-sharing`}>
                        <SectionHeading id={`${uid}-sharing`} title={t('forms.sectionSharing')} />
                        <div className="divide-y divide-white/8">
                          <SwitchRow label={t('forms.published')} help={t('forms.publishedHelp')} checked={draft.published} onChange={(published) => patch({ published })} />
                          <SwitchRow label={t('forms.acceptingToggle')} help={t('forms.acceptingHelp')} checked={draft.accepting} onChange={(accepting) => patch({ accepting })} />
                        </div>
                        <div className="mt-3 border-t border-white/8 pt-4">
                          {shareUrl && sharePath && saved?.form.published ? (
                            <>
                              <label className={LABEL_CLASS} htmlFor={`${uid}-share`}>{t('forms.shareLink')}</label>
                              <div className="mt-1.5 flex flex-wrap gap-2">
                                <input id={`${uid}-share`} className={`${INPUT_CLASS} min-w-0 flex-1 font-mono text-sm`} readOnly value={shareUrl} onFocus={(event) => event.target.select()} />
                                <button
                                  type="button" className={`${GHOST_BTN} border border-white/12`}
                                  onClick={() => {
                                    void navigator.clipboard?.writeText(shareUrl).then(() => {
                                      setCopied(true);
                                      window.setTimeout(() => setCopied(false), 2000);
                                    }).catch(() => undefined);
                                  }}
                                >
                                  {copied ? <Icon.check className="size-4 text-emerald-300" /> : <Icon.copy />}
                                  <span aria-live="polite">{copied ? t('forms.copied') : t('forms.copy')}</span>
                                </button>
                                <a className={`${GHOST_BTN} border border-white/12`} href={sharePath} target="_blank" rel="noreferrer">
                                  <Icon.external />{t('forms.openPublic')}
                                </a>
                              </div>
                            </>
                          ) : (
                            <p className="text-sm text-[var(--color-text-muted)]">{t('forms.shareHint')}</p>
                          )}
                        </div>
                      </section>

                      {revision > 0 ? (
                        <section className="rounded-2xl border border-red-400/20 p-4 sm:p-5" aria-labelledby={`${uid}-delete`}>
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="mr-auto min-w-0">
                              <h3 id={`${uid}-delete`} className="text-sm font-semibold">{t('forms.sectionDelete')}</h3>
                              <p className="mt-0.5 max-w-prose text-xs text-[var(--color-text-muted)]">{t('forms.confirmDelete')}</p>
                            </div>
                            {!confirmDelete ? (
                              <button type="button" className={DANGER_BTN} disabled={busy} onClick={() => setConfirmDelete(true)}>{t('forms.deleteForm')}</button>
                            ) : (
                              <div className="flex gap-2" role="group" aria-label={t('forms.deleteForm')}>
                                <button type="button" className={GHOST_BTN} autoFocus onClick={() => setConfirmDelete(false)}>{t('cancel')}</button>
                                <button type="button" className={`${DANGER_BTN} bg-red-500/15`} disabled={busy} onClick={() => void remove()}>{t('forms.confirmDeleteYes')}</button>
                              </div>
                            )}
                          </div>
                        </section>
                      ) : null}

                      {/* Save bar stays in reach while scrolling, as in a native settings screen. */}
                      <div className="sticky bottom-0 z-10 -mx-4 border-t border-white/10 bg-[var(--color-surface)]/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:-mx-6 sm:px-6 xl:mx-0 xl:rounded-2xl xl:border xl:px-5 xl:pb-3 xl:mb-4">
                        <div className="flex items-center gap-3">
                          <p className="mr-auto flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                            <span className={`size-2 rounded-full ${dirty ? 'bg-amber-400' : 'bg-emerald-400'}`} aria-hidden="true" />
                            {dirty ? t('forms.unsaved') : t('forms.allSaved')}
                          </p>
                          <button type="submit" className={PRIMARY_BTN} disabled={busy || !dirty}>
                            {busy ? <span className="size-4 animate-spin rounded-full border-2 border-slate-950/30 border-t-slate-950 motion-reduce:animate-none" aria-hidden="true" /> : null}
                            {busy ? t('forms.saving') : t('save')}
                          </button>
                        </div>
                      </div>
                    </form>

                    <aside className="hidden xl:sticky xl:top-6 xl:block" aria-label={t('forms.tabPreview')}>
                      <div className="mb-3 flex items-baseline justify-between gap-2">
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('forms.tabPreview')}</h3>
                      </div>
                      <p className="mb-3 text-xs text-[var(--color-text-muted)]">{t('forms.previewNote')}</p>
                      <div className="max-h-[calc(100dvh-10rem)] overflow-auto rounded-2xl">
                        <FormPreview form={draft} />
                      </div>
                    </aside>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 px-6 py-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-[var(--color-accent)]/12 text-[var(--color-accent)]"><KindGlyph kind="multiselect" className="size-6" /></span>
              <p className="mt-4 text-sm text-[var(--color-text-muted)]">{t('forms.noForms')}</p>
              <button type="button" className={`${PRIMARY_BTN} mt-5`} onClick={startNew}><Icon.plus />{t('forms.newForm')}</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Palette of question types: one click adds a question of that type, as in modern form builders. */
function AddQuestion({ disabled, onAdd }: { disabled: boolean; onAdd: (kind: FormFieldKind) => void }) {
  const { t } = useI18n();
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId}>
      <p id={headingId} className="mb-2 text-sm font-medium">{t('forms.addQuestion')}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-5">
        {FORM_FIELD_KINDS.map((kind) => (
          <button
            key={kind} type="button" disabled={disabled}
            className="flex min-h-11 items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-left text-sm transition-colors hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-accent)]/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-40"
            onClick={() => onAdd(kind)}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/6 text-[var(--color-accent)]"><KindGlyph kind={kind} /></span>
            <span className="min-w-0 truncate">{t(KIND_LABEL[kind])}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function FieldEditor({
  field, index, last, autoFocus, onChange, onMove, onRemove,
}: {
  field: FormField;
  index: number;
  last: boolean;
  /** True for a field that was just added, so typing can start at once. */
  autoFocus: boolean;
  onChange: (next: FormField) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const uid = useId();
  const choice = field.kind === 'select' || field.kind === 'multiselect';
  // Raw text keeps blank lines while typing; the field stores the cleaned list.
  const [optionsText, setOptionsText] = useState(() => (field.options ?? []).join('\n'));
  const position = index + 1;
  const groupLabel = t('forms.questionN', { n: position });

  return (
    <div
      className="group/field rounded-xl border border-white/10 bg-[var(--color-surface)]/60 p-3 transition-colors focus-within:border-[var(--color-accent)]/40 hover:border-white/20 sm:p-4"
      role="group" aria-label={groupLabel}
    >
      <div className="flex items-start gap-3">
        <span className="mt-1.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent)]/12 text-[var(--color-accent)]" title={t(KIND_LABEL[field.kind])}>
          <KindGlyph kind={field.kind} />
        </span>
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
          <div>
            <label className="sr-only" htmlFor={`${uid}-label`}>{t('forms.fieldLabel')} {position}</label>
            <input
              id={`${uid}-label`} className={`${INPUT_CLASS} font-medium`} type="text" maxLength={200} required autoFocus={autoFocus}
              placeholder={`${position}. ${t('forms.questionPlaceholder')}`} value={field.label}
              onChange={(event) => onChange({ ...field, label: event.target.value })}
            />
          </div>
          <div>
            <label className="sr-only" htmlFor={`${uid}-kind`}>{t('forms.fieldKind')}</label>
            <select
              id={`${uid}-kind`} className="ui-select" value={field.kind}
              onChange={(event) => {
                const next = withFieldKind(field, event.target.value as FormFieldKind);
                if (next.options) next.options = optionsFromText(optionsText);
                onChange(next);
              }}
            >
              {FORM_FIELD_KINDS.map((kind) => <option key={kind} value={kind}>{t(KIND_LABEL[kind])}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:pl-11">
        {choice ? (
          <div>
            <label className={LABEL_CLASS} htmlFor={`${uid}-options`}>{t('forms.fieldOptions')}</label>
            <textarea
              id={`${uid}-options`} className={`${INPUT_CLASS} mt-1.5 resize-y`} rows={3} required value={optionsText}
              onChange={(event) => {
                setOptionsText(event.target.value);
                onChange({ ...field, options: optionsFromText(event.target.value).slice(0, 50) });
              }}
            />
          </div>
        ) : null}
        <div>
          <label className="sr-only" htmlFor={`${uid}-help`}>{t('forms.fieldHelp')}</label>
          <input
            id={`${uid}-help`} className={`${INPUT_CLASS} text-sm`} type="text" maxLength={500} placeholder={t('forms.fieldHelp')} value={field.help ?? ''}
            onChange={(event) => {
              const next: FormField = { id: field.id, kind: field.kind, label: field.label, required: field.required };
              if (field.options) next.options = field.options;
              if (event.target.value) next.help = event.target.value;
              onChange(next);
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1 border-t border-white/8 pt-2">
          <label className="mr-auto flex min-h-10 items-center gap-2.5 text-sm">
            <input type="checkbox" role="switch" className="ui-switch" checked={field.required} onChange={(event) => onChange({ ...field, required: event.target.checked })} />
            {t('forms.fieldRequired')}
          </label>
          <button type="button" className={ICON_BTN} disabled={index === 0} aria-label={t('forms.moveUp', { n: position })} title={t('forms.moveUp', { n: position })} onClick={() => onMove(-1)}><Icon.up /></button>
          <button type="button" className={ICON_BTN} disabled={last} aria-label={t('forms.moveDown', { n: position })} title={t('forms.moveDown', { n: position })} onClick={() => onMove(1)}><Icon.down /></button>
          <button type="button" className={`${ICON_BTN} hover:bg-red-400/10 hover:text-red-300`} aria-label={t('forms.removeField', { n: position })} title={t('forms.removeField', { n: position })} onClick={onRemove}><Icon.trash /></button>
        </div>
      </div>
    </div>
  );
}
