/**
 * Media library, publish and submission records. Twins of Rodrigo `src/site.rs`
 * (`media_record_ok`, `media_refs`, `publish_ok`, `submission_ok`).
 */
import type { LText, SiteLocale } from './locales';
import { isSectionId, validateValue, type ValidationIssue } from './schema';

/** Accepted media types and byte limits. SVG is refused: it can carry script. */
export const MEDIA_TYPES: Readonly<Record<string, number>> = {
  'image/jpeg': 10 * 1024 * 1024,
  'image/png': 10 * 1024 * 1024,
  'image/webp': 10 * 1024 * 1024,
  'image/gif': 10 * 1024 * 1024,
  'image/avif': 10 * 1024 * 1024,
  'application/pdf': 25 * 1024 * 1024,
};
export const MEDIA_MAX_ITEMS = 500;

export interface SiteMedia {
  id: string;
  objectId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  alt: LText;
  updatedAt: string;
}

export interface SitePublish {
  id: string;
  note: string;
  restoreOf: string | null;
  createdAt: string;
}

export type DeliveryState = 'pending' | 'delivered' | 'failed';

export interface SiteSubmission {
  id: string;
  pageId: string;
  sectionId: string;
  locale: SiteLocale;
  answers: Record<string, string | number | boolean | string[] | null>;
  submittedAt: string;
  status: 'new' | 'handled' | 'spam';
  delivery: {
    messenger: { channelId: string; state: DeliveryState } | null;
    relay: { state: DeliveryState } | null;
  };
  source: 'public';
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function obj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: string, issues: ValidationIssue[]) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) issues.push({ path: `${path}.${key}`, code: 'unknown_prop' });
  for (const key of keys) if (!(key in value)) issues.push({ path: `${path}.${key}`, code: 'missing_prop' });
}

export function isMediaContentType(value: string): boolean {
  return Object.hasOwn(MEDIA_TYPES, value);
}

export function validateMedia(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!obj(value)) return [{ path: 'media', code: 'expected_object' }];
  exact(value, ['id', 'objectId', 'name', 'contentType', 'sizeBytes', 'width', 'height', 'alt', 'updatedAt'], 'media', issues);
  if (!isSectionId(value.id)) issues.push({ path: 'media.id', code: 'invalid_id' });
  if (typeof value.objectId !== 'string' || !UUID.test(value.objectId)) issues.push({ path: 'media.objectId', code: 'invalid_id' });
  if (typeof value.name !== 'string' || !value.name.trim() || [...value.name].length > 255 || /[\u0000-\u001f\u007f]/.test(value.name)) issues.push({ path: 'media.name', code: 'invalid_name' });
  const type = String(value.contentType);
  const max = MEDIA_TYPES[type];
  if (max === undefined) issues.push({ path: 'media.contentType', code: 'unsupported_type' });
  else if (typeof value.sizeBytes !== 'number' || !Number.isInteger(value.sizeBytes) || value.sizeBytes < 1 || value.sizeBytes > max) issues.push({ path: 'media.sizeBytes', code: 'too_large' });
  const image = type.startsWith('image/');
  for (const key of ['width', 'height'] as const) {
    const v = value[key];
    const ok = typeof v === 'number' && Number.isInteger(v) && (image ? v >= 1 && v <= 20000 : v === 0);
    if (!ok) issues.push({ path: `media.${key}`, code: 'invalid_dimension' });
  }
  validateValue({ kind: 'text', label: '', max: 300 }, value.alt, 'media.alt', issues);
  if (typeof value.updatedAt !== 'string' || !ISO.test(value.updatedAt)) issues.push({ path: 'media.updatedAt', code: 'invalid_datetime' });
  return issues;
}

export function validatePublish(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!obj(value)) return [{ path: 'publish', code: 'expected_object' }];
  exact(value, ['id', 'note', 'restoreOf', 'createdAt'], 'publish', issues);
  if (!isSectionId(value.id)) issues.push({ path: 'publish.id', code: 'invalid_id' });
  if (typeof value.note !== 'string' || [...value.note].length > 200 || /[\u0000-\u001f\u007f]/.test(value.note)) issues.push({ path: 'publish.note', code: 'invalid_note' });
  if (value.restoreOf !== null && !isSectionId(value.restoreOf)) issues.push({ path: 'publish.restoreOf', code: 'invalid_id' });
  if (typeof value.createdAt !== 'string' || !ISO.test(value.createdAt)) issues.push({ path: 'publish.createdAt', code: 'invalid_datetime' });
  return issues;
}

export const SUBMISSION_KEYS = ['id', 'pageId', 'sectionId', 'locale', 'answers', 'submittedAt', 'status', 'delivery', 'source'] as const;

/** Shape of a member's status update; Rodrigo compares every other field with the stored row. */
export function validateSubmissionUpdate(value: unknown, resourceId: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!obj(value)) return [{ path: 'submission', code: 'expected_object' }];
  exact(value, SUBMISSION_KEYS, 'submission', issues);
  if (value.id !== resourceId) issues.push({ path: 'submission.id', code: 'id_mismatch' });
  if (!['new', 'handled', 'spam'].includes(String(value.status))) issues.push({ path: 'submission.status', code: 'invalid_option' });
  if (value.source !== 'public') issues.push({ path: 'submission.source', code: 'invalid_option' });
  return issues;
}

/** Media ids referenced anywhere in a settings, page or item payload. */
export function mediaRefs(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => mediaRefs(v, out));
  else if (obj(value)) {
    const keys = Object.keys(value);
    if (keys.length === 2 && 'alt' in value && typeof value.id === 'string') out.push(value.id);
    else Object.values(value).forEach((v) => mediaRefs(v, out));
  }
  return out;
}

/** Intrinsic size of PNG, GIF, WebP and JPEG images from their first bytes; null when unknown. */
export function imageSize(head: Uint8Array): { width: number; height: number } | null {
  const b = head;
  const u16be = (i: number) => (b[i]! << 8) | b[i + 1]!;
  const u16le = (i: number) => b[i]! | (b[i + 1]! << 8);
  const u24le = (i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
  const u32be = (i: number) => ((b[i]! << 24) >>> 0) + ((b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!);
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') return { width: u32be(16), height: u32be(20) };
  if (b.length >= 10 && ascii(0, 4) === 'GIF8') return { width: u16le(6), height: u16le(8) };
  if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') return { width: u24le(24) + 1, height: u24le(27) + 1 };
    if (chunk === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = u16be(i + 2);
      const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (sof) return { height: u16be(i + 5), width: u16be(i + 7) };
      i += 2 + length;
    }
  }
  return null;
}
