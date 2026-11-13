/** Validation of whole documents: sections, pages, settings, collections and items. */
import { isSiteLocale, SITE_LOCALES } from './locales';
import { COLLECTION_FIELD_KINDS, PAGE_SLUG_RE, RESERVED_PAGE_SLUGS, SITE_MODEL_LIMITS as LIM, type CmsPage, type SiteCollection, type SiteCollectionItem, type SiteSection, type SiteSettings } from './model';
import { getComponent } from './registry';
import { isFieldKey, isSectionId, validateProps, validateValue, type FieldSpec, type ValidationIssue } from './schema';
import { validateTheme } from './theme';

export type { ValidationIssue };

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function obj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string, issues: ValidationIssue[]) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) issues.push({ path: `${path}.${key}`, code: 'unknown_prop' });
  for (const key of keys) if (!(key in value)) issues.push({ path: `${path}.${key}`, code: 'missing_prop' });
}

export function isPageSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= LIM.slugMax && PAGE_SLUG_RE.test(value) && !(RESERVED_PAGE_SLUGS as readonly string[]).includes(value);
}

const seoSpec = { title: { kind: 'text', label: '', max: LIM.seoTitleMax }, description: { kind: 'text', label: '', max: LIM.seoDescriptionMax } } satisfies Record<string, FieldSpec>;

export function validateSection(section: unknown, path = 'section'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!obj(section)) return [{ path, code: 'expected_object' }];
  exactKeys(section, ['id', 'type', 'version', 'props'], path, issues);
  if (!isSectionId(section.id)) issues.push({ path: `${path}.id`, code: 'invalid_id' });
  const component = typeof section.type === 'string' ? getComponent(section.type) : undefined;
  if (!component) return [...issues, { path: `${path}.type`, code: 'unknown_component' }];
  if (section.version !== component.version) issues.push({ path: `${path}.version`, code: 'unsupported_version' });
  validateProps(component.props, section.props, `${path}.props`, issues);
  return issues;
}

export function validatePage(page: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!obj(page)) return [{ path: 'page', code: 'expected_object' }];
  exactKeys(page, ['id', 'slug', 'title', 'nav', 'order', 'seo', 'sections', 'updatedAt'], 'page', issues);
  if (!isSectionId(page.id)) issues.push({ path: 'page.id', code: 'invalid_id' });
  if (!isPageSlug(page.slug)) issues.push({ path: 'page.slug', code: 'invalid_slug' });
  validateValue({ kind: 'text', label: '', max: LIM.seoTitleMax, required: true }, page.title, 'page.title', issues);
  if (!['header', 'footer', 'both', 'none'].includes(String(page.nav))) issues.push({ path: 'page.nav', code: 'invalid_option' });
  validateValue({ kind: 'number', label: '', min: 0, max: 10000, integer: true }, page.order, 'page.order', issues);
  validateProps(seoSpec, page.seo, 'page.seo', issues);
  if (typeof page.updatedAt !== 'string' || !ISO.test(page.updatedAt)) issues.push({ path: 'page.updatedAt', code: 'invalid_datetime' });
  if (!Array.isArray(page.sections)) issues.push({ path: 'page.sections', code: 'expected_list' });
  else {
    if (page.sections.length > LIM.sectionsPerPage) issues.push({ path: 'page.sections', code: 'too_many' });
    const ids = new Set<string>();
    page.sections.slice(0, LIM.sectionsPerPage).forEach((s, i) => {
      issues.push(...validateSection(s, `page.sections[${i}]`));
      const id = obj(s) ? String(s.id) : '';
      if (ids.has(id)) issues.push({ path: `page.sections[${i}].id`, code: 'duplicate_id' });
      ids.add(id);
    });
  }
  return issues;
}

const mediaSpec: FieldSpec = { kind: 'media', label: '', accept: 'image' };

export function validateSettings(settings: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!obj(settings)) return [{ path: 'settings', code: 'expected_object' }];
  exactKeys(settings, ['id', 'slug', 'name', 'theme', 'logo', 'favicon', 'socialImage', 'defaultLocale', 'locales', 'seo', 'homePageId', 'updatedAt'], 'settings', issues);
  if (settings.id !== 'site') issues.push({ path: 'settings.id', code: 'invalid_id' });
  if (typeof settings.slug !== 'string' || settings.slug.length > LIM.slugMax || !PAGE_SLUG_RE.test(settings.slug)) issues.push({ path: 'settings.slug', code: 'invalid_slug' });
  if (typeof settings.name !== 'string' || !settings.name.trim() || settings.name.length > LIM.nameMax || /[\u0000-\u001f]/.test(settings.name)) issues.push({ path: 'settings.name', code: 'invalid_name' });
  for (const problem of validateTheme(settings.theme)) issues.push({ path: 'settings.theme', code: problem });
  for (const key of ['logo', 'favicon', 'socialImage'] as const) validateValue(mediaSpec, settings[key], `settings.${key}`, issues);
  if (!isSiteLocale(settings.defaultLocale)) issues.push({ path: 'settings.defaultLocale', code: 'unknown_locale' });
  const locales = settings.locales;
  if (!Array.isArray(locales) || locales.length === 0 || locales.length > SITE_LOCALES.length || new Set(locales).size !== locales.length || !locales.every(isSiteLocale)) issues.push({ path: 'settings.locales', code: 'invalid_locales' });
  else if (!locales.includes(settings.defaultLocale as never)) issues.push({ path: 'settings.locales', code: 'default_locale_not_enabled' });
  validateProps(seoSpec, settings.seo, 'settings.seo', issues);
  if (!isSectionId(settings.homePageId)) issues.push({ path: 'settings.homePageId', code: 'invalid_id' });
  if (typeof settings.updatedAt !== 'string' || !ISO.test(settings.updatedAt)) issues.push({ path: 'settings.updatedAt', code: 'invalid_datetime' });
  return issues;
}

export function validateCollection(collection: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!obj(collection)) return [{ path: 'collection', code: 'expected_object' }];
  exactKeys(collection, ['id', 'slug', 'name', 'fields', 'titleField', 'sort', 'sortField', 'detailPages', 'updatedAt'], 'collection', issues);
  if (!isSectionId(collection.id)) issues.push({ path: 'collection.id', code: 'invalid_id' });
  if (!isPageSlug(collection.slug)) issues.push({ path: 'collection.slug', code: 'invalid_slug' });
  validateValue({ kind: 'text', label: '', max: 80, required: true }, collection.name, 'collection.name', issues);
  const keys = new Set<string>();
  if (!Array.isArray(collection.fields) || collection.fields.length === 0 || collection.fields.length > LIM.collectionFields) issues.push({ path: 'collection.fields', code: 'invalid_fields' });
  else collection.fields.forEach((f, i) => {
    const at = `collection.fields[${i}]`;
    if (!obj(f)) { issues.push({ path: at, code: 'expected_object' }); return; }
    exactKeys(f, ['key', 'label', 'kind', 'required', 'options'], at, issues);
    if (!isFieldKey(f.key)) issues.push({ path: `${at}.key`, code: 'invalid_key' });
    else if (keys.has(f.key)) issues.push({ path: `${at}.key`, code: 'duplicate_key' });
    else keys.add(f.key);
    validateValue({ kind: 'text', label: '', max: 80, required: true }, f.label, `${at}.label`, issues);
    if (!(COLLECTION_FIELD_KINDS as readonly string[]).includes(String(f.kind))) issues.push({ path: `${at}.kind`, code: 'invalid_option' });
    if (typeof f.required !== 'boolean') issues.push({ path: `${at}.required`, code: 'expected_boolean' });
    const options = f.options;
    const ok = Array.isArray(options) && options.length <= 30 && new Set(options).size === options.length
      && options.every((o) => typeof o === 'string' && o.trim() !== '' && o.length <= 80 && !/[\u0000-\u001f]/.test(o))
      && (f.kind === 'select' ? options.length > 0 : options.length === 0);
    if (!ok) issues.push({ path: `${at}.options`, code: 'invalid_options' });
  });
  const titleField = Array.isArray(collection.fields) ? (collection.fields as Array<Record<string, unknown>>).find((f) => obj(f) && f.key === collection.titleField) : undefined;
  if (!titleField || titleField.kind !== 'text') issues.push({ path: 'collection.titleField', code: 'title_must_be_text_field' });
  if (!['manual', 'dateDesc', 'titleAsc'].includes(String(collection.sort))) issues.push({ path: 'collection.sort', code: 'invalid_option' });
  if (collection.sort === 'dateDesc') {
    const sortField = (collection.fields as Array<Record<string, unknown>> | undefined)?.find((f) => obj(f) && f.key === collection.sortField);
    if (!sortField || sortField.kind !== 'date') issues.push({ path: 'collection.sortField', code: 'sort_field_must_be_date' });
  } else if (collection.sortField !== '') issues.push({ path: 'collection.sortField', code: 'must_be_empty' });
  if (typeof collection.detailPages !== 'boolean') issues.push({ path: 'collection.detailPages', code: 'expected_boolean' });
  if (typeof collection.updatedAt !== 'string' || !ISO.test(collection.updatedAt)) issues.push({ path: 'collection.updatedAt', code: 'invalid_datetime' });
  return issues;
}

/** Field spec for one collection field's stored value. */
export function collectionFieldSpec(field: SiteCollection['fields'][number]): FieldSpec | 'date' {
  switch (field.kind) {
    case 'text': return { kind: 'text', label: '', max: LIM.itemTextMax, multiline: true, required: field.required };
    case 'richtext': return { kind: 'richtext', label: '', max: LIM.itemRichTextMax, required: field.required };
    case 'number': return { kind: 'number', label: '', min: -1e12, max: 1e12 };
    case 'boolean': return { kind: 'boolean', label: '' };
    case 'link': return { kind: 'link', label: '', required: field.required };
    case 'media': return { kind: 'media', label: '', accept: 'image', required: field.required };
    case 'select': return { kind: 'select', label: '', options: field.required ? field.options : ['', ...field.options] };
    case 'date': return 'date';
  }
}

export function validateItem(item: unknown, collection: SiteCollection): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!obj(item)) return [{ path: 'item', code: 'expected_object' }];
  exactKeys(item, ['id', 'collectionId', 'slug', 'status', 'order', 'values', 'updatedAt'], 'item', issues);
  if (!isSectionId(item.id)) issues.push({ path: 'item.id', code: 'invalid_id' });
  if (item.collectionId !== collection.id) issues.push({ path: 'item.collectionId', code: 'collection_mismatch' });
  if (typeof item.slug !== 'string' || item.slug.length > LIM.slugMax || !PAGE_SLUG_RE.test(item.slug)) issues.push({ path: 'item.slug', code: 'invalid_slug' });
  if (item.status !== 'draft' && item.status !== 'published') issues.push({ path: 'item.status', code: 'invalid_option' });
  validateValue({ kind: 'number', label: '', min: 0, max: 100000, integer: true }, item.order, 'item.order', issues);
  if (!obj(item.values)) issues.push({ path: 'item.values', code: 'expected_object' });
  else {
    const values = item.values;
    for (const key of Object.keys(values)) if (!collection.fields.some((f) => f.key === key)) issues.push({ path: `item.values.${key}`, code: 'unknown_prop' });
    for (const field of collection.fields) {
      const at = `item.values.${field.key}`;
      if (!(field.key in values)) { issues.push({ path: at, code: 'missing_prop' }); continue; }
      const spec = collectionFieldSpec(field);
      const value = values[field.key];
      if (spec === 'date') {
        if (value === '' ? field.required : typeof value !== 'string' || !DATE.test(value)) issues.push({ path: at, code: 'invalid_date' });
      } else if (field.kind === 'number' && value === null) {
        if (field.required) issues.push({ path: at, code: 'required' });
      } else validateValue(spec, value, at, issues);
    }
  }
  if (typeof item.updatedAt !== 'string' || !ISO.test(item.updatedAt)) issues.push({ path: 'item.updatedAt', code: 'invalid_datetime' });
  return issues;
}

export type { CmsPage, SiteCollection, SiteCollectionItem, SiteSection, SiteSettings };
