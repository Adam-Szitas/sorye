/**
 * Declarative prop schema shared by the CMS form, Hub and Rodrigo.
 *
 * The same rules are implemented by `validateValue` here and by Rodrigo's
 * interpreter of the exported contract (`contracts/site-components.json`).
 * Keep both in step: every rule below has a twin in Rodrigo `src/site.rs`.
 *
 * Shape rules (both sides):
 * - every key a spec declares must be present; unknown keys are rejected;
 * - `required` means "not empty", not "present";
 * - lengths count Unicode code points;
 * - text never contains control characters (newline allowed when multiline).
 */
import { SITE_LOCALES, type LText } from './locales';

export type FieldSpec =
  | { kind: 'text'; max: number; required?: boolean; multiline?: boolean; label: string; help?: string }
  | { kind: 'richtext'; max: number; required?: boolean; label: string; help?: string }
  | { kind: 'link'; required?: boolean; label: string; help?: string }
  | { kind: 'media'; accept: 'image' | 'document'; required?: boolean; label: string; help?: string }
  | { kind: 'select'; options: readonly string[]; label: string; help?: string }
  | { kind: 'number'; min: number; max: number; integer?: boolean; label: string; help?: string }
  | { kind: 'boolean'; label: string; help?: string }
  | { kind: 'key'; required?: boolean; label: string; help?: string }
  | { kind: 'collection'; required?: boolean; label: string; help?: string }
  | { kind: 'channel'; label: string; help?: string }
  | { kind: 'formFields'; label: string; help?: string }
  | { kind: 'list'; max: number; item: Record<string, FieldSpec>; label: string; help?: string; itemLabel?: string };

export type PropsSpec = Record<string, FieldSpec>;

export interface MediaRef {
  id: string;
  alt: LText;
}

export const FORM_FIELD_KINDS = ['text', 'textarea', 'email', 'phone', 'number', 'date', 'select', 'multiselect', 'checkbox', 'consent'] as const;
export type SiteFormFieldKind = (typeof FORM_FIELD_KINDS)[number];

export interface SiteFormField {
  id: string;
  kind: SiteFormFieldKind;
  label: LText;
  help: LText;
  required: boolean;
  /** Option values are stored answers; labels are shown. `select`/`multiselect` only. */
  options: Array<{ value: string; label: LText }>;
}

export const LIMITS = {
  linkMax: 500,
  idMax: 40,
  keyMax: 64,
  formFieldsMax: 30,
  formOptionsMax: 30,
  optionValueMax: 80,
  formLabelMax: 200,
  formHelpMax: 300,
} as const;

export interface ValidationIssue {
  path: string;
  code: string;
}

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/;
const KEY_RE = /^[a-z][a-zA-Z0-9_]{0,63}$/;
const FIELD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const INTERNAL_RE = /^\/[a-z0-9\-/]{0,200}(#[a-z0-9-]{1,60})?$/;
const HASH_RE = /^#[a-z0-9-]{1,60}$/;
const EMAIL_RE = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]+$/;
const HOST_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function codePoints(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSectionId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

export function isFieldKey(value: unknown): value is string {
  return typeof value === 'string' && KEY_RE.test(value);
}

/**
 * `https://host/...`, `mailto:a@b.c`, a site-internal path (`/about`, `/news/item#x`)
 * or a same-page `#anchor`. Never javascript:, data:, protocol-relative or http:.
 */
export function isSafeLink(value: string): boolean {
  if (value.length > LIMITS.linkMax || CONTROL.test(value) || /\s/.test(value)) return false;
  if (HASH_RE.test(value)) return true;
  if (value.startsWith('/')) return !value.startsWith('//') && INTERNAL_RE.test(value);
  if (value.startsWith('mailto:')) return EMAIL_RE.test(value.slice(7)) && !value.includes('?');
  if (!value.startsWith('https://')) return false;
  const rest = value.slice(8);
  const end = rest.search(/[/?#]/);
  const authority = end === -1 ? rest : rest.slice(0, end);
  if (authority.includes('@')) return false;
  const host = authority.replace(/:\d{1,5}$/, '').toLowerCase();
  return HOST_RE.test(host);
}

function textOk(value: string, max: number, multiline: boolean): string | null {
  if (codePoints(value) > max) return 'too_long';
  if (CONTROL.test(value)) return 'control_character';
  if (!multiline && /[\r\n]/.test(value)) return 'newline_not_allowed';
  return null;
}

/** Localized text object: keys from SITE_LOCALES, string values. */
function validateLText(value: unknown, path: string, max: number, multiline: boolean, required: boolean, issues: ValidationIssue[]): void {
  if (!isPlainObject(value)) {
    issues.push({ path, code: 'expected_localized_text' });
    return;
  }
  let filled = false;
  for (const [locale, text] of Object.entries(value)) {
    if (!(SITE_LOCALES as readonly string[]).includes(locale)) {
      issues.push({ path: `${path}.${locale}`, code: 'unknown_locale' });
      continue;
    }
    if (typeof text !== 'string') {
      issues.push({ path: `${path}.${locale}`, code: 'expected_string' });
      continue;
    }
    const problem = textOk(text, max, multiline);
    if (problem) issues.push({ path: `${path}.${locale}`, code: problem });
    if (text.trim()) filled = true;
  }
  if (required && !filled) issues.push({ path, code: 'required' });
}

function validateFormFields(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ path, code: 'expected_list' });
    return;
  }
  if (value.length > LIMITS.formFieldsMax) issues.push({ path, code: 'too_many' });
  const seen = new Set<string>();
  value.slice(0, LIMITS.formFieldsMax).forEach((raw, index) => {
    const at = `${path}[${index}]`;
    if (!isPlainObject(raw)) {
      issues.push({ path: at, code: 'expected_object' });
      return;
    }
    const keys = ['id', 'kind', 'label', 'help', 'required', 'options'];
    for (const key of Object.keys(raw)) if (!keys.includes(key)) issues.push({ path: `${at}.${key}`, code: 'unknown_prop' });
    for (const key of keys) if (!(key in raw)) issues.push({ path: `${at}.${key}`, code: 'missing_prop' });
    if (typeof raw.id !== 'string' || !FIELD_ID_RE.test(raw.id)) issues.push({ path: `${at}.id`, code: 'invalid_id' });
    else if (seen.has(raw.id)) issues.push({ path: `${at}.id`, code: 'duplicate_id' });
    else seen.add(raw.id);
    const kind = raw.kind;
    if (typeof kind !== 'string' || !(FORM_FIELD_KINDS as readonly string[]).includes(kind)) issues.push({ path: `${at}.kind`, code: 'invalid_option' });
    if ('label' in raw) validateLText(raw.label, `${at}.label`, LIMITS.formLabelMax, false, true, issues);
    if ('help' in raw) validateLText(raw.help, `${at}.help`, LIMITS.formHelpMax, false, false, issues);
    if ('required' in raw && typeof raw.required !== 'boolean') issues.push({ path: `${at}.required`, code: 'expected_boolean' });
    const choice = kind === 'select' || kind === 'multiselect';
    const options = raw.options;
    if (!Array.isArray(options)) {
      if ('options' in raw) issues.push({ path: `${at}.options`, code: 'expected_list' });
      return;
    }
    if (choice && options.length === 0) issues.push({ path: `${at}.options`, code: 'required' });
    if (!choice && options.length > 0) issues.push({ path: `${at}.options`, code: 'options_not_allowed' });
    if (options.length > LIMITS.formOptionsMax) issues.push({ path: `${at}.options`, code: 'too_many' });
    const values = new Set<string>();
    options.slice(0, LIMITS.formOptionsMax).forEach((option, optionIndex) => {
      const op = `${at}.options[${optionIndex}]`;
      if (!isPlainObject(option) || Object.keys(option).length !== 2 || !('value' in option) || !('label' in option)) {
        issues.push({ path: op, code: 'expected_option' });
        return;
      }
      const v = option.value;
      if (typeof v !== 'string' || !v.trim() || codePoints(v) > LIMITS.optionValueMax || CONTROL.test(v) || /[\r\n]/.test(v)) issues.push({ path: `${op}.value`, code: 'invalid_value' });
      else if (values.has(v)) issues.push({ path: `${op}.value`, code: 'duplicate_value' });
      else values.add(v);
      validateLText(option.label, `${op}.label`, LIMITS.optionValueMax, false, false, issues);
    });
  });
}

export function validateValue(spec: FieldSpec, value: unknown, path: string, issues: ValidationIssue[]): void {
  switch (spec.kind) {
    case 'text':
      validateLText(value, path, spec.max, spec.multiline === true, spec.required === true, issues);
      return;
    case 'richtext':
      validateLText(value, path, spec.max, true, spec.required === true, issues);
      return;
    case 'link':
      if (typeof value !== 'string') issues.push({ path, code: 'expected_string' });
      else if (value === '') { if (spec.required) issues.push({ path, code: 'required' }); }
      else if (!isSafeLink(value)) issues.push({ path, code: 'unsafe_link' });
      return;
    case 'media':
      if (value === null) { if (spec.required) issues.push({ path, code: 'required' }); return; }
      if (!isPlainObject(value) || Object.keys(value).length !== 2 || !('id' in value) || !('alt' in value)) {
        issues.push({ path, code: 'expected_media' });
        return;
      }
      if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.id)) issues.push({ path: `${path}.id`, code: 'invalid_id' });
      // Images need alt text; documents use it as the link label.
      validateLText(value.alt, `${path}.alt`, 300, false, spec.accept === 'image', issues);
      return;
    case 'select':
      if (typeof value !== 'string' || !spec.options.includes(value)) issues.push({ path, code: 'invalid_option' });
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max || (spec.integer && !Number.isInteger(value))) issues.push({ path, code: 'invalid_number' });
      return;
    case 'boolean':
      if (typeof value !== 'boolean') issues.push({ path, code: 'expected_boolean' });
      return;
    case 'key':
      if (typeof value !== 'string') issues.push({ path, code: 'expected_string' });
      else if (value === '') { if (spec.required) issues.push({ path, code: 'required' }); }
      else if (!KEY_RE.test(value)) issues.push({ path, code: 'invalid_key' });
      return;
    case 'collection':
      if (typeof value !== 'string') issues.push({ path, code: 'expected_string' });
      else if (value === '') { if (spec.required) issues.push({ path, code: 'required' }); }
      else if (!ID_RE.test(value)) issues.push({ path, code: 'invalid_id' });
      return;
    case 'channel':
      if (typeof value !== 'string') issues.push({ path, code: 'expected_string' });
      else if (value.length > 160 || CONTROL.test(value) || value.includes('|')) issues.push({ path, code: 'invalid_id' });
      return;
    case 'formFields':
      validateFormFields(value, path, issues);
      return;
    case 'list':
      if (!Array.isArray(value)) {
        issues.push({ path, code: 'expected_list' });
        return;
      }
      if (value.length > spec.max) issues.push({ path, code: 'too_many' });
      value.slice(0, spec.max).forEach((item, index) => validateProps(spec.item, item, `${path}[${index}]`, issues));
      return;
  }
}

export function validateProps(spec: PropsSpec, props: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isPlainObject(props)) {
    issues.push({ path, code: 'expected_object' });
    return;
  }
  for (const key of Object.keys(props)) if (!(key in spec)) issues.push({ path: path ? `${path}.${key}` : key, code: 'unknown_prop' });
  for (const [key, field] of Object.entries(spec)) {
    const at = path ? `${path}.${key}` : key;
    if (!(key in props)) {
      issues.push({ path: at, code: 'missing_prop' });
      continue;
    }
    validateValue(field, props[key], at, issues);
  }
}

/** Empty value that satisfies the shape (not necessarily `required`). */
export function emptyValue(spec: FieldSpec): unknown {
  switch (spec.kind) {
    case 'text':
    case 'richtext':
      return {};
    case 'link':
    case 'key':
    case 'collection':
    case 'channel':
      return '';
    case 'media':
      return null;
    case 'select':
      return spec.options[0];
    case 'number':
      return spec.min;
    case 'boolean':
      return false;
    case 'formFields':
    case 'list':
      return [];
  }
}

export function emptyProps(spec: PropsSpec): Record<string, unknown> {
  return Object.fromEntries(Object.entries(spec).map(([key, field]) => [key, emptyValue(field)]));
}

/** Strips editor metadata (label, help, itemLabel). This is what Rodrigo interprets. */
export function contractSpec(spec: PropsSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(spec)) {
    const { label: _label, help: _help, ...rest } = field as FieldSpec & { itemLabel?: string };
    delete (rest as { itemLabel?: string }).itemLabel;
    out[key] = rest.kind === 'list' ? { ...rest, item: contractSpec((rest as { item: PropsSpec }).item) } : rest;
  }
  return out;
}

export function isMediaRef(value: unknown): value is MediaRef {
  return isPlainObject(value) && typeof value.id === 'string' && isPlainObject(value.alt);
}
