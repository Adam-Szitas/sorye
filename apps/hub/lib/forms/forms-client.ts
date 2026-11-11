/**
 * Browser data layer for the Forms app. Reads go through Hub's Rodrigo resource
 * routes; writes go through a durable IndexedDB queue and the action batch route.
 * No Node imports: this module runs in the browser.
 */
import { createDurableActionQueue, type DurableActionQueue } from '@sorye/platform';
import {
  FORM_MAX_FIELDS,
  isFormDefinition,
  isFormSlug,
  isFormSubmission,
  type FormAnswerValue,
  type FormDefinition,
  type FormField,
  type FormFieldKind,
  type FormSubmission,
} from '@sorye/types';

export interface FormsAction {
  actionId: string;
  appId: 'forms';
  resourceType: 'form' | 'submission';
  operation: 'create' | 'update' | 'delete';
  resourceId: string;
  expectedRevision?: number;
  payloadVersion: 1;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface StoredForm {
  form: FormDefinition;
  /** 0 until Rodrigo has confirmed the first save. */
  revision: number;
}

export interface StoredSubmission {
  submission: FormSubmission;
  revision: number;
}

export type CommitResult =
  | { ok: true; revision: number }
  | { ok: false; kind: 'conflict' | 'rejected' | 'unconfirmed'; code: string };

interface CollectionPage {
  items?: Array<{ resourceId: string; revision: number; resource: unknown }>;
  nextCursor?: string | null;
}

/** Field ids are generated, never derived from labels, so they stay stable and opaque. */
export function newFieldId(): string {
  return `f_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function newField(kind: FormFieldKind): FormField {
  const field: FormField = { id: newFieldId(), kind, label: '', required: false };
  if (kind === 'select' || kind === 'multiselect') field.options = [];
  if (kind === 'consent') field.required = true;
  return field;
}

/** Switching kind keeps the question and drops or adds the choice list as the kind needs. */
export function withFieldKind(field: FormField, kind: FormFieldKind): FormField {
  const next: FormField = { id: field.id, kind, label: field.label, required: field.required };
  if (field.help) next.help = field.help;
  if (kind === 'select' || kind === 'multiselect') next.options = field.options ?? [];
  return next;
}

export function optionsFromText(text: string): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const option = line.trim();
    if (!option || seen.has(option)) continue;
    seen.add(option);
    options.push(option);
  }
  return options;
}

export function newFormDraft(title: string): FormDefinition {
  return {
    id: `form-${crypto.randomUUID()}`,
    slug: '',
    title,
    description: '',
    published: false,
    accepting: true,
    version: 1,
    fields: [],
    successMessage: '',
    updatedAt: new Date().toISOString(),
  };
}

/** The payload to save: trimmed text, no empty optional keys, and a fresh timestamp. */
export function formForSave(draft: FormDefinition, saved: FormDefinition | null, now = new Date()): FormDefinition {
  const fields = draft.fields.slice(0, FORM_MAX_FIELDS).map((field) => {
    const clean: FormField = { id: field.id, kind: field.kind, label: field.label.trim(), required: field.required };
    const help = field.help?.trim();
    if (help) clean.help = help;
    if (field.kind === 'select' || field.kind === 'multiselect') clean.options = optionsFromText((field.options ?? []).join('\n'));
    return clean;
  });
  const fieldsChanged = !saved || JSON.stringify(saved.fields) !== JSON.stringify(fields);
  return {
    id: draft.id,
    slug: draft.slug.trim(),
    title: draft.title.trim(),
    description: draft.description.trim(),
    published: draft.published,
    accepting: draft.accepting,
    // A submission records the version it answered, so it rises only when fields change.
    version: saved ? saved.version + (fieldsChanged ? 1 : 0) : 1,
    fields,
    successMessage: draft.successMessage.trim(),
    updatedAt: now.toISOString(),
  };
}

export function formIsSavable(form: FormDefinition): boolean {
  return isFormSlug(form.slug) && isFormDefinition(form, form.id);
}

function csvCell(value: string): string {
  // A leading =, +, - or @ would run as a formula in spreadsheet apps.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function answerText(value: FormAnswerValue | undefined, yes: string): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'boolean') return value ? yes : '';
  return String(value);
}

export function submissionsCsv(form: FormDefinition, rows: readonly StoredSubmission[], labels: { received: string; status: string; yes: string }): string {
  const header = [labels.received, labels.status, ...form.fields.map((field) => field.label)];
  const lines = rows.map(({ submission }) =>
    [submission.submittedAt, submission.status, ...form.fields.map((field) => answerText(submission.answers[field.id], labels.yes))].map(csvCell).join(','),
  );
  return [header.map(csvCell).join(','), ...lines].join('\r\n');
}

async function getJson<T>(path: string): Promise<{ ok: boolean; status: number; data: T }> {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store' });
  const data = (await response.json().catch(() => ({}))) as T;
  return { ok: response.ok, status: response.status, data };
}

const SUBMISSION_PAGE_LIMIT = 10;

export class FormsClient {
  private constructor(private readonly scope: string, private readonly queue: DurableActionQueue<FormsAction>) {}

  /** Throws `app_access_denied`, `unauthorized` or `unavailable`. */
  static async open(): Promise<FormsClient> {
    const { ok, status, data } = await getJson<{ queueScope?: string }>('/api/forms/scope');
    if (!ok || !data.queueScope || !/^[a-f0-9]{64}$/.test(data.queueScope)) {
      throw new Error(status === 403 ? 'app_access_denied' : status === 401 ? 'unauthorized' : 'unavailable');
    }
    return new FormsClient(data.queueScope, createDurableActionQueue<FormsAction>({ appId: 'forms', scope: data.queueScope }));
  }

  close(): void {
    this.queue.close();
  }

  async listForms(): Promise<StoredForm[]> {
    const forms: StoredForm[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const query = `limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const { ok, data } = await getJson<CollectionPage>(`/api/backend/resources/forms/form?${query}`);
      if (!ok) throw new Error('unavailable');
      for (const item of data.items ?? []) {
        if (isFormDefinition(item.resource, item.resourceId)) forms.push({ form: item.resource, revision: item.revision });
      }
      if (!data.nextCursor) break;
      cursor = data.nextCursor;
    }
    return forms.sort((a, b) => b.form.updatedAt.localeCompare(a.form.updatedAt));
  }

  /**
   * Submissions of one form, newest first. The collection is not filtered by form on
   * the server, so this reads a bounded number of pages; `truncated` says more exist.
   */
  async listSubmissions(formId: string): Promise<{ rows: StoredSubmission[]; truncated: boolean }> {
    const rows: StoredSubmission[] = [];
    let cursor: string | undefined;
    let truncated = false;
    for (let page = 0; page < SUBMISSION_PAGE_LIMIT; page += 1) {
      const query = `limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const { ok, data } = await getJson<CollectionPage>(`/api/backend/resources/forms/submission?${query}`);
      if (!ok) throw new Error('unavailable');
      for (const item of data.items ?? []) {
        if (isFormSubmission(item.resource, item.resourceId) && item.resource.formId === formId) {
          rows.push({ submission: item.resource, revision: item.revision });
        }
      }
      if (!data.nextCursor) break;
      cursor = data.nextCursor;
      if (page === SUBMISSION_PAGE_LIMIT - 1) truncated = true;
    }
    rows.sort((a, b) => b.submission.submittedAt.localeCompare(a.submission.submittedAt));
    return { rows, truncated };
  }

  async pendingCount(): Promise<number> {
    return (await this.queue.list()).length;
  }

  /** Drops changes Rodrigo refused. Changes still waiting for confirmation are kept. */
  async discardRefused(): Promise<void> {
    for (const row of await this.queue.list()) {
      if (row.status === 'conflict' || row.status === 'rejected') await this.queue.discard(row.action.actionId);
    }
  }

  saveForm(form: FormDefinition, revision: number): Promise<CommitResult> {
    return this.commit({
      resourceType: 'form', operation: revision === 0 ? 'create' : 'update', resourceId: form.id,
      ...(revision ? { expectedRevision: revision } : {}), payload: { ...form },
    });
  }

  deleteForm(formId: string, revision: number): Promise<CommitResult> {
    return this.commit({ resourceType: 'form', operation: 'delete', resourceId: formId, expectedRevision: revision, payload: {} });
  }

  setSubmissionStatus(row: StoredSubmission, status: FormSubmission['status']): Promise<CommitResult> {
    return this.commit({
      resourceType: 'submission', operation: 'update', resourceId: row.submission.id, expectedRevision: row.revision,
      payload: { ...row.submission, status },
    });
  }

  deleteSubmission(row: StoredSubmission): Promise<CommitResult> {
    return this.commit({ resourceType: 'submission', operation: 'delete', resourceId: row.submission.id, expectedRevision: row.revision, payload: {} });
  }

  /** Sends changes left over from an earlier visit. Safe to call at any time. */
  async flush(): Promise<void> {
    for (const row of await this.queue.list()) {
      if (row.status === 'pending' || row.status === 'failed') await this.send(row.action);
    }
  }

  private async commit(input: Pick<FormsAction, 'resourceType' | 'operation' | 'resourceId' | 'payload'> & { expectedRevision?: number }): Promise<CommitResult> {
    const now = new Date().toISOString();
    const action: FormsAction = { actionId: crypto.randomUUID(), appId: 'forms', payloadVersion: 1, occurredAt: now, ...input };
    await this.queue.enqueue(action);
    return this.send(action);
  }

  /** One action per request, never retried here: the queue keeps it for the next flush. */
  private async send(action: FormsAction): Promise<CommitResult> {
    await this.queue.markAttempt(action.actionId);
    try {
      const response = await fetch('/api/backend/actions/batch', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Sorye-Queue-Scope': this.scope },
        body: JSON.stringify({ actions: [action] }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        results?: Array<{ actionId: string; status: 'committed' | 'duplicate' | 'conflict' | 'rejected'; revision?: number; error?: { code: string; message?: string } }>;
        error?: { code?: string };
      };
      if (!response.ok) {
        const code = data.error?.code ?? 'request_failed';
        // A 4xx will never succeed on retry; keep it out of the retry loop.
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          await this.queue.discard(action.actionId);
          return { ok: false, kind: 'rejected', code };
        }
        await this.queue.markTransportFailure(action.actionId, { code });
        return { ok: false, kind: 'unconfirmed', code };
      }
      const outcome = data.results?.find((result) => result.actionId === action.actionId);
      if (!outcome) {
        await this.queue.markTransportFailure(action.actionId, { code: 'missing_action_result' });
        return { ok: false, kind: 'unconfirmed', code: 'missing_action_result' };
      }
      await this.queue.settle(outcome);
      if (outcome.status === 'committed' || outcome.status === 'duplicate') return { ok: true, revision: outcome.revision ?? 0 };
      // The editor shows the outcome now; the stored copy would only block later saves.
      await this.queue.discard(action.actionId);
      return { ok: false, kind: outcome.status, code: outcome.error?.code ?? outcome.status };
    } catch {
      await this.queue.markTransportFailure(action.actionId, { code: 'network_error' }).catch(() => undefined);
      return { ok: false, kind: 'unconfirmed', code: 'network_error' };
    }
  }
}
