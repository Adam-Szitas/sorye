'use client';

import { useI18n } from '@sorye/platform/react';
import {
  emptyProps, FORM_FIELD_KINDS, missingLocales,
  type FieldSpec, type LText, type MediaRef, type PropsSpec, type SiteCollection, type SiteFormField, type SiteLocale, type SiteMedia,
} from '@sorye/site-sdk';
import { useId } from 'react';

export const FIELD = 'mt-1 w-full min-h-11 rounded-lg border border-white/12 bg-black/25 px-3 py-2 text-base text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#0b57d0]';
export const LABEL = 'block text-sm font-medium text-[var(--color-text)]';
export const HINT = 'mt-1 text-xs text-[var(--color-text-muted)]';
export const BTN = 'min-h-11 rounded-lg border border-white/15 px-3 text-sm transition hover:bg-white/10 disabled:opacity-40';
export const PRIMARY = 'min-h-11 rounded-lg bg-[var(--color-accent)] px-4 text-sm font-medium text-[var(--color-surface)] transition hover:brightness-110 disabled:opacity-50';

export interface EditorEnv {
  locale: SiteLocale;
  locales: SiteLocale[];
  media: SiteMedia[];
  collections: SiteCollection[];
  channels: Array<{ id: string; name: string }>;
  readOnly: boolean;
}

/** Problems for one field path from the SDK validator, shown inline. */
export type Issues = ReadonlyArray<{ path: string; code: string }>;

function issueAt(issues: Issues, path: string) {
  return issues.find((i) => i.path === path || i.path.startsWith(`${path}.`) || i.path.startsWith(`${path}[`));
}

export function LTextInput({ value, onChange, env, multiline, max, id, describedBy }: { value: LText; onChange: (v: LText) => void; env: EditorEnv; multiline?: boolean; max: number; id: string; describedBy?: string }) {
  const { t } = useI18n();
  const text = value[env.locale] ?? '';
  const missing = missingLocales(value, env.locales);
  const set = (next: string) => {
    const copy: LText = { ...value };
    if (next) copy[env.locale] = next; else delete copy[env.locale];
    onChange(copy);
  };
  const common = { id, value: text, maxLength: max, disabled: env.readOnly, className: FIELD, lang: env.locale, ...(describedBy ? { 'aria-describedby': describedBy } : {}) };
  return (
    <>
      {multiline ? <textarea {...common} rows={4} onChange={(e) => set(e.target.value)} /> : <input {...common} type="text" onChange={(e) => set(e.target.value)} />}
      {env.locales.length > 1 && missing.length > 0 ? <p className="mt-1 text-xs text-amber-200">{t('site.missingTranslations', { list: missing.map((l) => l.toUpperCase()).join(', ') })}</p> : null}
    </>
  );
}

function MediaPicker({ value, onChange, env, accept, id }: { value: MediaRef | null; onChange: (v: MediaRef | null) => void; env: EditorEnv; accept: 'image' | 'document'; id: string }) {
  const { t } = useI18n();
  const options = env.media.filter((m) => (accept === 'image' ? m.contentType.startsWith('image/') : true));
  const chosen = value ? env.media.find((m) => m.id === value.id) : undefined;
  return (
    <div className="mt-1 flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {chosen?.contentType.startsWith('image/') ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/site/media/${chosen.id}`} alt="" width={chosen.width} height={chosen.height} className="h-14 w-auto max-w-24 rounded object-cover" />
        ) : null}
        <select id={id} className={FIELD} disabled={env.readOnly} value={value?.id ?? ''}
          onChange={(e) => {
            const m = env.media.find((x) => x.id === e.target.value);
            onChange(m ? { id: m.id, alt: value?.alt && Object.keys(value.alt).length ? value.alt : { ...m.alt } } : null);
          }}>
          <option value="">{t('site.none')}</option>
          {options.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      {value ? (
        <label className="text-sm">
          {t('site.altText')}
          <LTextInput id={`${id}-alt`} value={value.alt} max={300} env={env} onChange={(alt) => onChange({ ...value, alt })} />
          <span className={HINT}>{t('site.altHelp')}</span>
        </label>
      ) : null}
    </div>
  );
}

function FormFieldsEditor({ value, onChange, env, id }: { value: SiteFormField[]; onChange: (v: SiteFormField[]) => void; env: EditorEnv; id: string }) {
  const { t } = useI18n();
  const patch = (i: number, next: Partial<SiteFormField>) => onChange(value.map((f, j) => (j === i ? { ...f, ...next } : f)));
  return (
    <div id={id} className="mt-2 flex flex-col gap-3">
      {value.map((field, i) => (
        <fieldset key={field.id} className="rounded-lg border border-white/10 p-3">
          <legend className="px-1 text-sm">{field.label[env.locale] || field.id}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm">{t('site.fieldLabel')}<LTextInput id={`${id}-${i}-label`} value={field.label} max={200} env={env} onChange={(label) => patch(i, { label })} /></label>
            <label className="text-sm">{t('site.fieldKind')}
              <select className={FIELD} value={field.kind} disabled={env.readOnly} onChange={(e) => {
                const kind = e.target.value as SiteFormField['kind'];
                patch(i, { kind, options: kind === 'select' || kind === 'multiselect' ? (field.options.length ? field.options : [{ value: 'A', label: {} }]) : [] });
              }}>
                {FORM_FIELD_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={field.required} disabled={env.readOnly} onChange={(e) => patch(i, { required: e.target.checked })} />{t('site.fieldRequired')}</label>
            {field.kind === 'select' || field.kind === 'multiselect' ? (
              <label className="text-sm sm:col-span-2">{t('site.fieldOptions')}
                <textarea className={FIELD} rows={3} disabled={env.readOnly} value={field.options.map((o) => o.value).join('\n')}
                  onChange={(e) => patch(i, { options: [...new Set(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))].slice(0, 30).map((v) => ({ value: v, label: field.options.find((o) => o.value === v)?.label ?? {} })) })} />
              </label>
            ) : null}
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" className={BTN} disabled={env.readOnly || i === 0} onClick={() => { const next = [...value]; [next[i - 1], next[i]] = [next[i]!, next[i - 1]!]; onChange(next); }}>{t('site.moveUp')}</button>
            <button type="button" className={BTN} disabled={env.readOnly} onClick={() => onChange(value.filter((_, j) => j !== i))}>{t('site.remove')}</button>
          </div>
        </fieldset>
      ))}
      <button type="button" className={BTN} disabled={env.readOnly || value.length >= 30}
        onClick={() => onChange([...value, { id: `f${crypto.randomUUID().slice(0, 8)}`, kind: 'text', label: { [env.locale]: '' }, help: {}, required: false, options: [] }])}>{t('site.add')}</button>
    </div>
  );
}

export function FieldInput({ spec, value, onChange, env, issues, path }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void; env: EditorEnv; issues: Issues; path: string }) {
  const { t } = useI18n();
  const id = useId();
  const problem = issueAt(issues, path);
  const helpId = `${id}-help`;
  const label = <span className={LABEL}>{spec.label}{'required' in spec && spec.required ? ' *' : ''}</span>;
  const help = spec.help || problem ? <span id={helpId} className={problem ? 'mt-1 block text-xs text-red-300' : HINT}>{problem ? `${problem.code} (${problem.path})` : spec.help}</span> : null;
  switch (spec.kind) {
    case 'text':
    case 'richtext':
      return <label className="block">{label}<LTextInput id={id} value={(value ?? {}) as LText} onChange={onChange} env={env} max={spec.max} multiline={spec.kind === 'richtext' || spec.multiline} describedBy={help ? helpId : undefined} />{help}</label>;
    case 'link':
    case 'key':
      return <label className="block">{label}<input id={id} className={FIELD} type="text" disabled={env.readOnly} value={String(value ?? '')} maxLength={500} onChange={(e) => onChange(e.target.value.trim())} aria-describedby={help ? helpId : undefined} />{help}</label>;
    case 'media':
      return <div>{label}<MediaPicker id={id} value={(value ?? null) as MediaRef | null} onChange={onChange} env={env} accept={spec.accept} />{help}</div>;
    case 'select':
      return <label className="block">{label}<select id={id} className={FIELD} disabled={env.readOnly} value={String(value)} onChange={(e) => onChange(e.target.value)}>{spec.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>{help}</label>;
    case 'number':
      return <label className="block">{label}<input id={id} className={FIELD} type="number" disabled={env.readOnly} min={spec.min} max={spec.max} step={spec.integer ? 1 : 'any'} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} />{help}</label>;
    case 'boolean':
      return <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={env.readOnly} checked={value === true} onChange={(e) => onChange(e.target.checked)} />{label}{help}</label>;
    case 'collection':
      return <label className="block">{label}<select id={id} className={FIELD} disabled={env.readOnly} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}><option value="">{t('site.none')}</option>{env.collections.map((c) => <option key={c.id} value={c.id}>{c.name[env.locale] || c.slug}</option>)}</select>{help}</label>;
    case 'channel':
      return <label className="block">{label}<select id={id} className={FIELD} disabled={env.readOnly} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}><option value="">{t('site.none')}</option>{env.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}</select>{help}</label>;
    case 'formFields':
      return <div>{label}<FormFieldsEditor id={id} value={(value ?? []) as SiteFormField[]} onChange={onChange} env={env} />{help}</div>;
    case 'list': {
      const items = (Array.isArray(value) ? value : []) as Record<string, unknown>[];
      const move = (i: number, d: -1 | 1) => { const next = [...items]; const j = i + d; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j]!, next[i]!]; onChange(next); };
      return (
        <fieldset className="rounded-lg border border-white/10 p-3">
          <legend className="px-1 text-sm font-medium">{spec.label}</legend>
          <ol className="flex flex-col gap-3">
            {items.map((item, i) => (
              <li key={i} className="rounded-lg border border-white/10 p-3">
                <p className="mb-2 text-xs text-[var(--color-text-muted)]">{spec.itemLabel ?? spec.label} {i + 1}</p>
                <PropsEditor spec={spec.item} props={item} onChange={(next) => onChange(items.map((x, j) => (j === i ? next : x)))} env={env} issues={issues} path={`${path}[${i}]`} />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={BTN} disabled={env.readOnly || i === 0} onClick={() => move(i, -1)}>{t('site.moveUp')}</button>
                  <button type="button" className={BTN} disabled={env.readOnly || i === items.length - 1} onClick={() => move(i, 1)}>{t('site.moveDown')}</button>
                  <button type="button" className={BTN} disabled={env.readOnly} onClick={() => onChange(items.filter((_, j) => j !== i))}>{t('site.remove')}</button>
                </div>
              </li>
            ))}
          </ol>
          <button type="button" className={`${BTN} mt-2`} disabled={env.readOnly || items.length >= spec.max} onClick={() => onChange([...items, emptyProps(spec.item)])}>{t('site.add')}</button>
          {help}
        </fieldset>
      );
    }
  }
}

export function PropsEditor({ spec, props, onChange, env, issues, path }: { spec: PropsSpec; props: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void; env: EditorEnv; issues: Issues; path: string }) {
  return (
    <div className="flex flex-col gap-3">
      {Object.entries(spec).map(([key, field]) => (
        <FieldInput key={key} spec={field} value={props[key]} env={env} issues={issues} path={`${path}.${key}`} onChange={(v) => onChange({ ...props, [key]: v })} />
      ))}
    </div>
  );
}

export function LocaleSwitch({ env, onChange }: { env: EditorEnv; onChange: (l: SiteLocale) => void }) {
  const { t } = useI18n();
  if (env.locales.length < 2) return null;
  return (
    <div role="group" aria-label={t('site.language')} className="flex gap-1">
      {env.locales.map((l) => (
        <button key={l} type="button" aria-pressed={env.locale === l} className={`${BTN} ${env.locale === l ? 'bg-white/15' : ''}`} onClick={() => onChange(l)}>{l.toUpperCase()}</button>
      ))}
    </div>
  );
}
