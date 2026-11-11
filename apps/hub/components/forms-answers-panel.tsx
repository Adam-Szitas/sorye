'use client';

import { useI18n } from '@sorye/platform/react';
import type { MessageKey } from '@sorye/platform';
import { FORM_SUBMISSION_STATUSES, type FormDefinition, type FormSubmissionStatus } from '@sorye/types';
import { useCallback, useEffect, useId, useState } from 'react';
import { DANGER_BTN, GHOST_BTN, ICON_BTN, Icon } from '@/components/forms-ui';
import { answerText, submissionsCsv, type FormsClient, type StoredSubmission } from '@/lib/forms/forms-client';

const STATUS_LABEL: Record<FormSubmissionStatus, MessageKey> = {
  new: 'forms.status.new', handled: 'forms.status.handled', spam: 'forms.status.spam',
};
const STATUS_DOT: Record<FormSubmissionStatus, string> = {
  new: 'bg-[var(--color-accent)]', handled: 'bg-emerald-400', spam: 'bg-slate-500',
};
type Filter = 'all' | FormSubmissionStatus;
const FILTERS: readonly Filter[] = ['all', ...FORM_SUBMISSION_STATUSES];

/** Submissions of one saved form: read, filter, set a handling status, delete, export. */
export function FormAnswersPanel({ client, form }: { client: FormsClient; form: FormDefinition }) {
  const { t, locale } = useI18n();
  const uid = useId();
  const [rows, setRows] = useState<StoredSubmission[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const listed = await client.listSubmissions(form.id);
      setRows(listed.rows);
      setTruncated(listed.truncated);
    } catch {
      setRows((current) => current ?? []);
      setError(t('forms.answersFailed'));
    } finally {
      setLoading(false);
    }
    // `t` changes with the language; reloading on a language switch is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, form.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(row: StoredSubmission, status: FormSubmissionStatus) {
    if (busyId || status === row.submission.status) return;
    setBusyId(row.submission.id);
    setError(null);
    const result = await client.setSubmissionStatus(row, status).catch(() => null);
    if (result?.ok) {
      setRows((current) => (current ?? []).map((item) =>
        item.submission.id === row.submission.id ? { submission: { ...item.submission, status }, revision: result.revision } : item));
    } else {
      setError(result?.kind === 'conflict' ? t('forms.conflict') : t('forms.saveFailed'));
    }
    setBusyId(null);
  }

  async function remove(row: StoredSubmission) {
    if (busyId) return;
    setBusyId(row.submission.id);
    setError(null);
    const result = await client.deleteSubmission(row).catch(() => null);
    setConfirmId(null);
    if (result?.ok) setRows((current) => (current ?? []).filter((item) => item.submission.id !== row.submission.id));
    else setError(result?.kind === 'conflict' ? t('forms.conflict') : t('forms.saveFailed'));
    setBusyId(null);
  }

  function exportCsv() {
    if (!rows || rows.length === 0) return;
    const csv = submissionsCsv(form, rows, { received: t('forms.received', { when: '' }).replace(/[:\s]+$/, ''), status: t('forms.statusLabel'), yes: t('forms.yes') });
    // The BOM makes spreadsheet apps read the file as UTF-8.
    const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${form.slug || 'form'}-answers.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (rows === null) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label={t('loading')}>
        {[0, 1, 2].map((key) => <div key={key} className="h-28 animate-pulse rounded-2xl bg-white/[0.04] motion-reduce:animate-none" />)}
      </div>
    );
  }

  const counts: Record<Filter, number> = { all: rows.length, new: 0, handled: 0, spam: 0 };
  for (const row of rows) counts[row.submission.status] += 1;
  const visible = filter === 'all' ? rows : rows.filter((row) => row.submission.status === filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex flex-wrap gap-1.5" role="group" aria-label={t('forms.filterLabel')}>
          {FILTERS.map((name) => (
            <button
              key={name} type="button" aria-pressed={filter === name}
              className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${filter === name ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/12 text-[var(--color-text)]' : 'border-white/10 text-[var(--color-text-muted)] hover:border-white/20 hover:text-[var(--color-text)]'}`}
              onClick={() => setFilter(name)}
            >
              {name !== 'all' ? <span className={`size-1.5 rounded-full ${STATUS_DOT[name]}`} aria-hidden="true" /> : null}
              {name === 'all' ? t('forms.filterAll') : t(STATUS_LABEL[name])}
              <span className="rounded-full bg-white/8 px-1.5 text-xs tabular-nums">{counts[name]}</span>
            </button>
          ))}
        </div>
        <button type="button" className={GHOST_BTN} disabled={loading} onClick={() => void load()}>
          <Icon.refresh className={`size-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} />{t('forms.refresh')}
        </button>
        <button type="button" className={`${GHOST_BTN} border border-white/12`} disabled={rows.length === 0} onClick={exportCsv}>
          <Icon.download />{t('forms.exportCsv')}
        </button>
      </div>
      <p className="sr-only" aria-live="polite">{t('forms.answersCount', { n: visible.length })}</p>
      {error ? <p className="flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2.5 text-sm text-red-200" role="alert"><Icon.alert className="mt-0.5 size-4 shrink-0" />{error}</p> : null}
      {truncated ? <p className="text-xs text-amber-200">{t('forms.answersTruncated', { n: rows.length })}</p> : null}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/15 px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-white/5 text-[var(--color-text-muted)]"><Icon.inbox className="size-6" /></span>
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">{rows.length === 0 ? t('forms.noAnswers') : t('forms.noAnswersFiltered')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((row) => {
            const { submission } = row;
            const when = new Date(submission.submittedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
            const statusId = `${uid}-${submission.id}-status`;
            return (
              <li
                key={submission.id}
                className={`rounded-2xl border bg-[var(--color-surface-raised)]/70 p-4 ${submission.status === 'new' ? 'border-[var(--color-accent)]/30' : 'border-white/10'} ${submission.status === 'spam' ? 'opacity-70' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="mr-auto flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                    <span className={`size-2 rounded-full ${STATUS_DOT[submission.status]}`} aria-hidden="true" />
                    <time dateTime={submission.submittedAt}>{t('forms.received', { when })}</time>
                  </p>
                  <label className="sr-only" htmlFor={statusId}>{t('forms.statusLabel')}</label>
                  <select
                    id={statusId}
                    className="ui-select min-h-9 w-auto py-1 text-sm"
                    value={submission.status}
                    disabled={busyId !== null}
                    onChange={(event) => void setStatus(row, event.target.value as FormSubmissionStatus)}
                  >
                    {FORM_SUBMISSION_STATUSES.map((status) => <option key={status} value={status}>{t(STATUS_LABEL[status])}</option>)}
                  </select>
                  {confirmId !== submission.id ? (
                    <button
                      type="button" className={`${ICON_BTN} hover:bg-red-400/10 hover:text-red-300`} disabled={busyId !== null}
                      aria-label={t('forms.deleteAnswer')} title={t('forms.deleteAnswer')} onClick={() => setConfirmId(submission.id)}
                    >
                      <Icon.trash />
                    </button>
                  ) : null}
                </div>
                {confirmId === submission.id ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-red-400/30 bg-red-400/5 p-3 text-sm" role="alertdialog" aria-label={t('forms.deleteAnswer')}>
                    <p className="mr-auto">{t('forms.confirmDeleteAnswer')}</p>
                    {/* Focus lands on the safe choice. */}
                    <button type="button" className={GHOST_BTN} autoFocus onClick={() => setConfirmId(null)}>{t('cancel')}</button>
                    <button type="button" className={`${DANGER_BTN} bg-red-500/15`} disabled={busyId !== null} onClick={() => void remove(row)}>{t('forms.confirmDeleteYes')}</button>
                  </div>
                ) : null}
                <dl className="mt-3 grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-[minmax(8rem,14rem)_1fr]">
                  {form.fields.map((field) => {
                    const text = answerText(submission.answers[field.id], t('forms.yes'));
                    if (!text) return null;
                    return (
                      <div key={field.id} className="contents">
                        <dt className="text-[var(--color-text-muted)]">{field.label}</dt>
                        <dd className="whitespace-pre-wrap break-words">{text}</dd>
                      </div>
                    );
                  })}
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
