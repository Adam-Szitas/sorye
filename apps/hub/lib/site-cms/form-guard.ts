import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SiteFormField } from '@sorye/site-sdk';
import { createPublicRateLimiter, publicClientKey } from '@/lib/forms/public-rate-limit';

/**
 * Edge protection for public Site contact forms, applied before Rodrigo is called:
 * a hidden honeypot field, a signed issue time (minimum fill time, maximum age) and
 * per-client plus per-site fixed-window limits. No third-party CAPTCHA.
 */
export const SITE_FORM_LIMITS = {
  perClient: { max: 5, windowMs: 60_000 },
  perSite: { max: 120, windowMs: 60_000 },
  minFillMs: 3_000,
  maxAgeMs: 24 * 60 * 60_000,
  maxBodyBytes: 65_536,
} as const;

export const siteFormLimiter = createPublicRateLimiter();

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) throw new Error('AUTH_SECRET is required to sign site form tokens');
  return value;
}

function mac(slug: string, issued: string): string {
  return createHmac('sha256', secret()).update(`site-form\u0000${slug}\u0000${issued}`).digest('base64url');
}

/** Token rendered into every form: issue time plus an HMAC bound to the site slug. */
export function issueFormToken(slug: string, now = Date.now()): string {
  const issued = String(now);
  return `${issued}.${mac(slug, issued)}`;
}

export type GuardFailure = 'bad_token' | 'too_fast' | 'expired' | 'honeypot';

export function checkFormToken(slug: string, token: string, now = Date.now()): GuardFailure | null {
  const match = /^(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return 'bad_token';
  const expected = Buffer.from(mac(slug, match[1]!));
  const given = Buffer.from(match[2]!);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'bad_token';
  const age = now - Number(match[1]);
  if (age < SITE_FORM_LIMITS.minFillMs) return 'too_fast';
  if (age > SITE_FORM_LIMITS.maxAgeMs) return 'expired';
  return null;
}

/** Seconds to wait when over a limit, otherwise 0. */
export function rateLimit(headers: Headers, slug: string, now = Date.now()): number {
  const client = siteFormLimiter.hit(`c:${publicClientKey(headers)}`, SITE_FORM_LIMITS.perClient.max, SITE_FORM_LIMITS.perClient.windowMs, now);
  if (client > 0) return client;
  return siteFormLimiter.hit(`s:${slug}`, SITE_FORM_LIMITS.perSite.max, SITE_FORM_LIMITS.perSite.windowMs, now);
}

/**
 * Turns posted form data into typed answers for the section's fields. Unknown names are
 * ignored; Rodrigo validates every answer against the stored section again.
 */
export function answersFromForm(form: FormData, fields: SiteFormField[]): Record<string, string | number | boolean | string[]> {
  const answers: Record<string, string | number | boolean | string[]> = {};
  for (const field of fields) {
    const name = `f_${field.id}`;
    if (field.kind === 'multiselect') {
      const values = form.getAll(name).filter((v): v is string => typeof v === 'string').slice(0, 50);
      if (values.length > 0) answers[field.id] = values;
      continue;
    }
    const raw = form.get(name);
    if (field.kind === 'checkbox' || field.kind === 'consent') {
      if (raw === 'on') answers[field.id] = true;
      continue;
    }
    if (typeof raw !== 'string') continue;
    const value = raw.replace(/\r\n?/g, '\n').trim();
    if (!value) continue;
    if (field.kind === 'number') {
      const n = Number(value);
      answers[field.id] = Number.isFinite(n) ? n : value;
    } else answers[field.id] = value.slice(0, field.kind === 'textarea' ? 5000 : 500);
  }
  return answers;
}
