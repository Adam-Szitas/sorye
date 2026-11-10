/**
 * Forms: shared contract between the Forms app, Hub and Rodrigo.
 * The rules here mirror Rodrigo's `forms.form` / `forms.submission` validation;
 * Rodrigo is authoritative and re-checks everything.
 */

export const FORM_FIELD_KINDS = [
  'text',
  'textarea',
  'email',
  'phone',
  'number',
  'date',
  'select',
  'multiselect',
  'checkbox',
  'consent',
] as const;
export type FormFieldKind = (typeof FORM_FIELD_KINDS)[number];

export const FORM_MAX_FIELDS = 50;
export const FORM_MAX_OPTIONS = 50;

export interface FormField {
  /** Stable key for answers: letters, digits, `_` and `-`, at most 64 characters. */
  id: string;
  kind: FormFieldKind;
  label: string;
  help?: string;
  required: boolean;
  /** Present for `select` and `multiselect` only. */
  options?: string[];
}

export interface FormDefinition {
  id: string;
  /** Public path segment: lowercase letters and digits separated by single dashes. */
  slug: string;
  title: string;
  description: string;
  published: boolean;
  /** When false the public page shows the form as closed. */
  accepting: boolean;
  /** Raised by the editor whenever fields change, so a submission records what it answered. */
  version: number;
  fields: FormField[];
  successMessage: string;
  updatedAt: string;
}

export type FormAnswerValue = string | number | boolean | string[] | null;
export type FormAnswers = Record<string, FormAnswerValue>;

export const FORM_SUBMISSION_STATUSES = ['new', 'handled', 'spam'] as const;
export type FormSubmissionStatus = (typeof FORM_SUBMISSION_STATUSES)[number];

export interface FormSubmission {
  id: string;
  formId: string;
  formVersion: number;
  answers: FormAnswers;
  submittedAt: string;
  status: FormSubmissionStatus;
  source: 'public';
}

/** What an anonymous visitor may see of a published form. */
export interface PublishedForm {
  slug: string;
  formId: string;
  version: number;
  title: string;
  description: string;
  fields: FormField[];
  successMessage: string;
  accepting: boolean;
}

export type FormAnswerProblem = 'required_missing' | 'invalid_answer' | 'unknown_field';

const FIELD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isFormFieldKind(value: unknown): value is FormFieldKind {
  return typeof value === 'string' && (FORM_FIELD_KINDS as readonly string[]).includes(value);
}

export function isFormSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && SLUG.test(value);
}

/** Turns a title into a slug candidate. Returns '' when nothing usable is left. */
export function formSlugFromTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

function byteLength(value: string): number {
  // Rodrigo counts UTF-8 bytes; count the same way so both sides agree.
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function textWithin(value: unknown, min: number, max: number): value is string {
  if (typeof value !== 'string') return false;
  const size = byteLength(value);
  return size >= min && size <= max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}

export function isFormField(value: unknown): value is FormField {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['id', 'kind', 'label', 'required'], ['help', 'options'])) return false;
  if (typeof value.id !== 'string' || !FIELD_ID.test(value.id)) return false;
  if (!isFormFieldKind(value.kind)) return false;
  if (!textWithin(value.label, 1, 200)) return false;
  if (value.help !== undefined && !textWithin(value.help, 0, 500)) return false;
  if (typeof value.required !== 'boolean') return false;
  const choice = value.kind === 'select' || value.kind === 'multiselect';
  if (!choice) return value.options === undefined;
  const options = value.options;
  return (
    Array.isArray(options) &&
    options.length >= 1 &&
    options.length <= FORM_MAX_OPTIONS &&
    options.every((option) => textWithin(option, 1, 200)) &&
    new Set(options).size === options.length
  );
}

export function isFormFieldList(value: unknown): value is FormField[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > FORM_MAX_FIELDS) return false;
  if (!value.every(isFormField)) return false;
  return new Set(value.map((field) => field.id)).size === value.length;
}

/** True when `value` is a form definition Rodrigo will accept for `resourceId`. */
export function isFormDefinition(value: unknown, resourceId?: string): value is FormDefinition {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, ['id', 'slug', 'title', 'description', 'published', 'accepting', 'version', 'fields', 'successMessage', 'updatedAt'])
  ) {
    return false;
  }
  return (
    textWithin(value.id, 1, 160) &&
    (resourceId === undefined || value.id === resourceId) &&
    isFormSlug(value.slug) &&
    textWithin(value.title, 1, 200) &&
    textWithin(value.description, 0, 2000) &&
    typeof value.published === 'boolean' &&
    typeof value.accepting === 'boolean' &&
    Number.isSafeInteger(value.version) &&
    (value.version as number) >= 1 &&
    (value.version as number) <= 1_000_000 &&
    isFormFieldList(value.fields) &&
    textWithin(value.successMessage, 0, 500) &&
    typeof value.updatedAt === 'string'
  );
}

export function isFormAnswerValue(value: unknown): value is FormAnswerValue {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return byteLength(value) <= 5000;
  return Array.isArray(value) && value.length <= 50 && value.every((item) => textWithin(item, 0, 200));
}

export function isFormAnswers(value: unknown): value is FormAnswers {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length <= FORM_MAX_FIELDS && keys.every((key) => FIELD_ID.test(key) && isFormAnswerValue(value[key]));
}

function isCalendarDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
}

function isEmptyAnswer(kind: FormFieldKind, answer: FormAnswerValue | undefined): boolean {
  if (answer === undefined || answer === null) return true;
  if (typeof answer === 'string') return answer.trim() === '';
  if (Array.isArray(answer)) return answer.length === 0;
  if (typeof answer === 'boolean') return !answer && (kind === 'checkbox' || kind === 'consent');
  return false;
}

function answerFits(field: FormField, answer: FormAnswerValue): boolean {
  const options = field.options ?? [];
  switch (field.kind) {
    case 'text':
      return textWithin(answer, 0, 500);
    case 'textarea':
      return textWithin(answer, 0, 5000);
    case 'email': {
      if (!textWithin(answer, 0, 320) || /\s/.test(answer)) return false;
      const at = answer.indexOf('@');
      const domain = answer.slice(at + 1);
      return at > 0 && domain.includes('.') && !domain.includes('@');
    }
    case 'phone':
      return textWithin(answer, 0, 40) && /\d/.test(answer) && /^[\d +\-().]+$/.test(answer);
    case 'number':
      return typeof answer === 'number' && Number.isFinite(answer);
    case 'date':
      return typeof answer === 'string' && isCalendarDay(answer);
    case 'select':
      return typeof answer === 'string' && options.includes(answer);
    case 'multiselect':
      return (
        Array.isArray(answer) &&
        answer.length <= FORM_MAX_OPTIONS &&
        answer.every((choice) => options.includes(choice)) &&
        new Set(answer).size === answer.length
      );
    case 'checkbox':
    case 'consent':
      return answer === true;
  }
}

export interface FormAnswerIssue {
  problem: FormAnswerProblem;
  /** The field the problem belongs to, when it is tied to one. */
  fieldId?: string;
}

/**
 * Checks answers against a definition. Returns the first problem, in field order,
 * or `null` when Rodrigo would accept them.
 */
export function findFormAnswerIssue(fields: readonly FormField[], answers: FormAnswers): FormAnswerIssue | null {
  const known = new Set(fields.map((field) => field.id));
  for (const field of fields) {
    const answer = answers[field.id];
    if (isEmptyAnswer(field.kind, answer)) {
      if (field.required) return { problem: 'required_missing', fieldId: field.id };
      continue;
    }
    if (!answerFits(field, answer as FormAnswerValue)) return { problem: 'invalid_answer', fieldId: field.id };
  }
  const stray = Object.keys(answers).find((key) => !known.has(key));
  return stray === undefined ? null : { problem: 'unknown_field', fieldId: stray };
}

/** Removes empty optional answers so stored submissions hold only what was entered. */
export function compactFormAnswers(fields: readonly FormField[], answers: FormAnswers): FormAnswers {
  const compact: FormAnswers = {};
  for (const field of fields) {
    const answer = answers[field.id];
    if (answer === undefined || isEmptyAnswer(field.kind, answer)) continue;
    compact[field.id] = typeof answer === 'string' ? answer.trim() : answer;
  }
  return compact;
}

export function isFormSubmission(value: unknown, resourceId?: string): value is FormSubmission {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['id', 'formId', 'formVersion', 'answers', 'submittedAt', 'status', 'source'])) return false;
  return (
    textWithin(value.id, 1, 160) &&
    (resourceId === undefined || value.id === resourceId) &&
    textWithin(value.formId, 1, 160) &&
    Number.isSafeInteger(value.formVersion) &&
    (value.formVersion as number) >= 1 &&
    (value.formVersion as number) <= 1_000_000 &&
    isFormAnswers(value.answers) &&
    typeof value.submittedAt === 'string' &&
    typeof value.status === 'string' &&
    (FORM_SUBMISSION_STATUSES as readonly string[]).includes(value.status) &&
    value.source === 'public'
  );
}
