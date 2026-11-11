'use client';

import { useI18n } from '@sorye/platform/react';
import { compactFormAnswers, findFormAnswerIssue, type FormAnswers, type FormAnswerValue, type FormField, type PublishedForm } from '@sorye/types';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { HINT_CLASS, INPUT_CLASS, Icon, PRIMARY_BTN } from '@/components/forms-ui';

type Phase = 'editing' | 'sending' | 'sent';

/** Up to this many choices a single-choice question shows as radio cards; more use a dropdown. */
const RADIO_LIMIT = 6;

const CHOICE_ROW =
  'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-white/12 bg-white/[0.03] px-4 py-2.5 text-base transition-colors hover:border-white/25 has-[:checked]:border-[var(--color-accent)] has-[:checked]:bg-[var(--color-accent)]/10 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-accent)]';

/** Centered card that frames the public page and its states. */
function PublicShell({ children, lang }: { children: ReactNode; lang: string }) {
  return (
    <main lang={lang} className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6 sm:pt-14">
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-[var(--color-surface-raised)]/90 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
        <div className="h-1.5 bg-gradient-to-r from-[var(--color-accent)] via-sky-300 to-violet-400" aria-hidden="true" />
        <div className="px-5 py-7 sm:px-10 sm:py-10">{children}</div>
      </div>
    </main>
  );
}

function FormHeader({ form, preview = false }: { form: Pick<PublishedForm, 'title' | 'description'>; preview?: boolean }) {
  const Heading = preview ? 'h4' : 'h1';
  return (
    <header>
      <Heading className={preview ? 'text-xl font-semibold tracking-tight text-balance' : 'text-2xl font-semibold tracking-tight text-balance sm:text-3xl'}>{form.title}</Heading>
      {form.description ? <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-[var(--color-text-muted)]">{form.description}</p> : null}
    </header>
  );
}

/** Public page of a published form. Rodrigo re-validates everything that is sent. */
export function FormPublicView({ form }: { form: PublishedForm }) {
  const { t, locale } = useI18n();
  const uid = useId();
  const sentRef = useRef<HTMLDivElement | null>(null);
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [trap, setTrap] = useState('');
  const [phase, setPhase] = useState<Phase>('editing');
  const [problem, setProblem] = useState<{ fieldId?: string; message: string } | null>(null);
  // One id per attempt to send these answers, so a retry after a lost reply is not stored twice.
  const submissionId = useRef<string | null>(null);

  // After sending, the form is replaced by the confirmation. Move focus there so
  // keyboard and screen-reader users are not left on a control that no longer exists.
  useEffect(() => {
    if (phase === 'sent') sentRef.current?.focus();
  }, [phase]);

  function set(fieldId: string, value: FormAnswerValue) {
    submissionId.current = null;
    setProblem((current) => (current?.fieldId && current.fieldId !== fieldId ? current : null));
    setAnswers((current) => ({ ...current, [fieldId]: value }));
  }

  async function send() {
    if (phase === 'sending') return;
    const compact = compactFormAnswers(form.fields, answers);
    const issue = findFormAnswerIssue(form.fields, compact);
    if (issue) {
      setProblem({ fieldId: issue.fieldId, message: t(issue.problem === 'required_missing' ? 'forms.public.required' : 'forms.public.invalid') });
      if (issue.fieldId) document.getElementById(`${uid}-${issue.fieldId}`)?.focus();
      return;
    }
    setPhase('sending');
    setProblem(null);
    submissionId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/forms/public/${encodeURIComponent(form.slug)}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: submissionId.current, answers: compact, website: trap }),
      });
      if (response.ok) {
        submissionId.current = null;
        setPhase('sent');
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
      const code = data.error?.code;
      const message =
        response.status === 429 ? t('forms.public.rateLimited')
        : code === 'form_closed' ? t('forms.public.closed')
        : code === 'required_missing' ? t('forms.public.required')
        : code === 'invalid_answer' || code === 'unknown_field' ? t('forms.public.invalid')
        : t('forms.public.failed');
      setProblem({ message });
    } catch {
      setProblem({ message: t('forms.public.failed') });
    }
    setPhase('editing');
  }

  if (phase === 'sent') {
    return (
      <PublicShell lang={locale}>
        <div ref={sentRef} tabIndex={-1} className="flex flex-col items-center py-6 text-center outline-none" role="status">
          <span className="flex size-14 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
            <Icon.check className="size-7" />
          </span>
          <h1 className="mt-5 text-xl font-semibold tracking-tight">{form.title}</h1>
          <p className="mt-2 max-w-md whitespace-pre-wrap text-base text-[var(--color-text-muted)]">{form.successMessage || t('forms.successDefault')}</p>
          <button
            type="button" className="mt-6 min-h-11 rounded-lg px-4 text-sm text-[var(--color-accent)] underline-offset-4 hover:underline"
            onClick={() => { setAnswers({}); setPhase('editing'); }}
          >
            {t('forms.public.again')}
          </button>
        </div>
      </PublicShell>
    );
  }

  if (!form.accepting) {
    return (
      <PublicShell lang={locale}>
        <FormHeader form={form} />
        <div className="mt-8 flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4" role="status">
          <Icon.lock className="mt-0.5 size-5 shrink-0 text-[var(--color-text-muted)]" />
          <p className="text-base">{t('forms.public.closed')}</p>
        </div>
      </PublicShell>
    );
  }

  const sending = phase === 'sending';
  return (
    <PublicShell lang={locale}>
      <FormHeader form={form} />
      <form className="mt-8 flex flex-col gap-7" noValidate aria-busy={sending} onSubmit={(event) => { event.preventDefault(); void send(); }}>
        {form.fields.map((field) => (
          <PublicField
            key={field.id}
            field={field}
            inputId={`${uid}-${field.id}`}
            value={answers[field.id]}
            error={problem?.fieldId === field.id ? problem.message : null}
            onChange={(value) => set(field.id, value)}
          />
        ))}
        {/* Hidden from people and assistive technology; automated senders fill it in. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={trap} onChange={(event) => setTrap(event.target.value)} />
          </label>
        </div>
        {problem && !problem.fieldId ? (
          <p className="flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200" role="alert">
            <Icon.alert className="mt-0.5 size-4 shrink-0" />{problem.message}
          </p>
        ) : null}
        <div className="flex flex-col gap-4 border-t border-white/10 pt-6">
          <button type="submit" disabled={sending} className={`${PRIMARY_BTN} min-h-12 w-full text-base sm:w-auto sm:self-start sm:px-8`}>
            {sending ? <span className="size-4 animate-spin rounded-full border-2 border-slate-950/30 border-t-slate-950 motion-reduce:animate-none" aria-hidden="true" /> : null}
            {sending ? t('forms.public.sending') : t('forms.public.submit')}
          </button>
          <p className="flex items-start gap-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
            <Icon.lock className="mt-px size-3.5 shrink-0" />{t('forms.public.notice')}
          </p>
        </div>
      </form>
    </PublicShell>
  );
}

/** Live, unsent rendering of a draft for the builder's preview pane. */
export function FormPreview({ form }: { form: Pick<PublishedForm, 'title' | 'description' | 'fields' | 'accepting'> }) {
  const { t } = useI18n();
  const uid = useId();
  const [answers, setAnswers] = useState<FormAnswers>({});
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[var(--color-surface-raised)]/90">
      <div className="h-1 bg-gradient-to-r from-[var(--color-accent)] via-sky-300 to-violet-400" aria-hidden="true" />
      <div className="p-5">
        <FormHeader preview form={{ title: form.title || t('forms.untitled'), description: form.description }} />
        {!form.accepting ? (
          <p className="mt-6 flex items-start gap-2 rounded-xl border border-white/10 p-3 text-sm" role="note">
            <Icon.lock className="mt-0.5 size-4 shrink-0 text-[var(--color-text-muted)]" />{t('forms.public.closed')}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col gap-6">
          {form.fields.map((field) => (
            <PublicField
              key={field.id}
              field={field}
              inputId={`${uid}-${field.id}`}
              value={answers[field.id]}
              error={null}
              onChange={(value) => setAnswers((current) => ({ ...current, [field.id]: value }))}
            />
          ))}
          <button type="button" aria-disabled="true" className={`${PRIMARY_BTN} w-full cursor-default opacity-80`}>{t('forms.public.submit')}</button>
        </div>
      </div>
    </div>
  );
}

export function PublicField({
  field, inputId, value, error, onChange,
}: {
  field: FormField;
  inputId: string;
  value: FormAnswerValue | undefined;
  error: string | null;
  onChange: (value: FormAnswerValue) => void;
}) {
  const { t } = useI18n();
  const helpId = field.help ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  const common = { id: inputId, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, required: field.required } as const;
  const text = typeof value === 'string' ? value : '';
  // Optional questions are marked instead of required ones: most questions are required,
  // and the `required` attribute already tells assistive technology.
  const mark = field.required ? null : <span className="font-normal text-[var(--color-text-muted)]"> ({t('forms.public.optionalMark')})</span>;
  const label = field.label || t('forms.questionPlaceholder');
  const notes = (
    <>
      {field.help ? <p id={helpId} className={HINT_CLASS}>{field.help}</p> : null}
      {error ? (
        <p id={errorId} className="mt-2 flex items-center gap-1.5 text-sm text-red-300" role="alert">
          <Icon.alert className="size-4 shrink-0" />{error}
        </p>
      ) : null}
    </>
  );
  const legendClass = 'text-base font-medium';
  const labelClass = 'mb-2 block text-base font-medium';

  if (field.kind === 'checkbox' || field.kind === 'consent') {
    return (
      <div>
        <label className={`${CHOICE_ROW} items-start ${error ? 'border-red-400' : ''}`}>
          <input type="checkbox" className="mt-0.5 size-5 shrink-0" {...common} checked={value === true} onChange={(event) => onChange(event.target.checked)} />
          <span>{label}{mark}</span>
        </label>
        {notes}
      </div>
    );
  }

  if (field.kind === 'multiselect' || (field.kind === 'select' && (field.options ?? []).length <= RADIO_LIMIT)) {
    const multi = field.kind === 'multiselect';
    const chosen = Array.isArray(value) ? value : [];
    return (
      <fieldset aria-describedby={describedBy}>
        <legend className={`${legendClass} mb-2`}>{label}{mark}</legend>
        <div className="flex flex-col gap-2">
          {(field.options ?? []).map((option, index) => (
            <label key={option} className={`${CHOICE_ROW} ${error ? 'border-red-400/60' : ''}`}>
              {multi ? (
                <input
                  type="checkbox" className="size-5 shrink-0" id={index === 0 ? inputId : undefined} checked={chosen.includes(option)}
                  onChange={(event) => onChange(event.target.checked ? [...chosen, option] : chosen.filter((item) => item !== option))}
                />
              ) : (
                <input
                  type="radio" className="size-5 shrink-0" name={inputId} id={index === 0 ? inputId : undefined} required={field.required}
                  value={option} checked={text === option} onChange={() => onChange(option)}
                />
              )}
              <span className="min-w-0 break-words">{option}</span>
            </label>
          ))}
        </div>
        {notes}
      </fieldset>
    );
  }

  const labelEl = <label className={labelClass} htmlFor={inputId}>{label}{mark}</label>;
  if (field.kind === 'textarea') {
    return <div>{labelEl}<textarea className={`${INPUT_CLASS} min-h-28 resize-y`} rows={4} maxLength={5000} {...common} value={text} onChange={(event) => onChange(event.target.value)} />{notes}</div>;
  }
  if (field.kind === 'select') {
    return (
      <div>
        {labelEl}
        <select className="ui-select" {...common} value={text} onChange={(event) => onChange(event.target.value)}>
          <option value="">{t('forms.public.choose')}</option>
          {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        {notes}
      </div>
    );
  }
  if (field.kind === 'number') {
    return (
      <div>
        {labelEl}
        <input
          className={`${INPUT_CLASS} sm:max-w-xs`} type="number" inputMode="decimal" step="any" {...common}
          value={typeof value === 'number' ? value : ''}
          onChange={(event) => onChange(event.target.value === '' || Number.isNaN(event.target.valueAsNumber) ? null : event.target.valueAsNumber)}
        />
        {notes}
      </div>
    );
  }
  const type = field.kind === 'email' ? 'email' : field.kind === 'phone' ? 'tel' : field.kind === 'date' ? 'date' : 'text';
  const autoComplete = field.kind === 'email' ? 'email' : field.kind === 'phone' ? 'tel' : undefined;
  const narrow = field.kind === 'date' || field.kind === 'phone';
  return (
    <div>
      {labelEl}
      <input
        className={`${INPUT_CLASS} ${narrow ? 'sm:max-w-xs' : ''}`} type={type} autoComplete={autoComplete}
        inputMode={field.kind === 'email' ? 'email' : field.kind === 'phone' ? 'tel' : undefined}
        maxLength={field.kind === 'email' ? 320 : field.kind === 'phone' ? 40 : 500} {...common} value={text} onChange={(event) => onChange(event.target.value)}
      />
      {notes}
    </div>
  );
}

/** Shown when Rodrigo cannot be reached, so the visitor sees a translated message and a retry. */
export function FormUnavailable() {
  const { t, locale } = useI18n();
  return (
    <PublicShell lang={locale}>
      <div className="flex flex-col items-center py-4 text-center" role="alert">
        <span className="flex size-12 items-center justify-center rounded-full bg-amber-400/15 text-amber-200">
          <Icon.alert className="size-6" />
        </span>
        <h1 className="mt-4 text-lg font-semibold">{t('forms.public.unavailableTitle')}</h1>
        <p className="mt-2 max-w-sm text-sm text-[var(--color-text-muted)]">{t('forms.public.unavailable')}</p>
        <button type="button" className={`${PRIMARY_BTN} mt-6`} onClick={() => window.location.reload()}>
          <Icon.refresh />{t('forms.public.reload')}
        </button>
      </div>
    </PublicShell>
  );
}
